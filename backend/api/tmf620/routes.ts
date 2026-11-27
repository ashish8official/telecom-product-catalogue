import { Request, Response, Router } from 'express';
import { config } from '../../config';
import { pool } from '../../db/pool';
import { badRequest, conflict, notFound } from '../../http/errors';
import { asyncHandler, ctx } from '../../http/middleware';
import { optionalDate, optionalString, pagination, parseId } from '../../http/validate';
import { catalogueRepository } from '../../repositories/catalogueRepository';
import { offeringRepository, OfferingView } from '../../repositories/offeringRepository';
import { categories, productSpecifications } from '../../repositories/referenceRepository';
import { catalogueService } from '../../services/catalogueService';
import { codeFromName, offeringService } from '../../services/offeringService';
import { listResolvedRates } from '../../services/pricingService';
import { referenceDataService } from '../../services/referenceDataService';
import { TMF620Adapter } from './adapter';

/**
 * TMF620 Product Catalog Management v5: the only surface external CRM / OM / BSS systems use.
 *
 * Reads default to what is commercially live: offerings of the catalogue version that is RELEASED
 * and in force at `effectiveAt` (default now). A specific version (e.g. a draft under test) can be
 * read by sending its id in the x-catalogue-version-id header. Writes to offerings go to a DRAFT
 * version named by that header.
 */
export const tmf620Router = Router();

const t = (req: Request) => ctx(req).tenantId;
const adapter = (req: Request) => new TMF620Adapter(config.publicBaseUrl ?? `${req.protocol}://${req.get('host')}`);

/** x-catalogue-version-id, validated, or undefined. */
function versionHeader(req: Request): string | undefined {
    const v = req.header('x-catalogue-version-id');
    return v === undefined ? undefined : parseId(v, 'x-catalogue-version-id');
}

/** TMF630 attribute selection: ?fields=name,lifecycleStatus (id, href and @type are always kept). */
function project<T extends Record<string, unknown>>(req: Request, resource: T): Partial<T> {
    const fields = typeof req.query.fields === 'string' ? req.query.fields : undefined;
    if (!fields) return resource;
    const keep = new Set(['id', 'href', '@type', ...fields.split(',').map((f) => f.trim()).filter(Boolean)]);
    return Object.fromEntries(Object.entries(resource).filter(([k]) => keep.has(k))) as Partial<T>;
}

function sendList(req: Request, res: Response, items: Record<string, unknown>[], total: number): void {
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('X-Result-Count', String(items.length));
    res.status(items.length < total ? 206 : 200).json(items.map((i) => project(req, i)));
}

function priceContext(req: Request) {
    const marketId = req.query.marketId === undefined ? undefined : parseId(req.query.marketId, 'marketId');
    return {
        subscriberId: optionalString(req.query.subscriberId, 'subscriberId'),
        accountId: optionalString(req.query.accountId, 'accountId'),
        marketId,
        effectiveAt: optionalDate(req.query.effectiveAt, 'effectiveAt'),
    };
}

async function offeringExtras(tenantId: string, rows: OfferingView[]) {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return () => ({});
    const [rates, relationships, cats] = await Promise.all([
        offeringRepository.rates(pool, tenantId, ids),
        offeringRepository.relationships(pool, tenantId, ids),
        offeringRepository.categories(pool, tenantId, ids),
    ]);
    return (id: string) => ({
        priceIds: rates.filter((r) => r.offering_id === id).map((r) => ({ id: r.id, name: `${r.charge_code} (${r.market_code})` })),
        relationships: relationships.filter((r) => r.source_offering_id === id),
        categories: cats.filter((c) => c.offering_id === id),
    });
}

// ---- ProductSpecification ------------------------------------------------------------------------------

tmf620Router.get('/productSpecification', asyncHandler(async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const status = optionalString(req.query.lifecycleStatus, 'lifecycleStatus');
    const nameFilter = optionalString(req.query.name, 'name')?.toLowerCase();
    const a = adapter(req);
    const all = (await productSpecifications.list(pool, t(req)))
        .map((row) => a.toProductSpecification(row))
        .filter((s) => (!status || s.lifecycleStatus.toLowerCase() === status.toLowerCase()) && (!nameFilter || s.name.toLowerCase().includes(nameFilter)));
    sendList(req, res, all.slice(offset, offset + limit) as any[], all.length);
}));

tmf620Router.get('/productSpecification/:id', asyncHandler(async (req, res) => {
    const row = await productSpecifications.get(pool, t(req), parseId(req.params.id));
    if (!row) throw notFound('ProductSpecification', req.params.id as string);
    res.json(project(req, adapter(req).toProductSpecification(row) as any));
}));

tmf620Router.post('/productSpecification', asyncHandler(async (req, res) => {
    const input = TMF620Adapter.fromProductSpecification(req.body, 'create');
    const created = await referenceDataService.createProductSpecification(t(req), {
        ...input,
        spec_code: codeFromName(input.spec_name!),
        status: input.status ?? 'ACTIVE',
    });
    const body = adapter(req).toProductSpecification(created);
    res.status(201).location(body.href).json(body);
}));

tmf620Router.patch('/productSpecification/:id', asyncHandler(async (req, res) => {
    const input = TMF620Adapter.fromProductSpecification(req.body, 'patch');
    const updated = await referenceDataService.updateProductSpecification(t(req), parseId(req.params.id), input);
    res.json(adapter(req).toProductSpecification(updated));
}));

tmf620Router.delete('/productSpecification/:id', asyncHandler(async (req, res) => {
    await referenceDataService.deleteProductSpecification(t(req), parseId(req.params.id));
    res.status(204).end();
}));

// ---- ProductOffering -----------------------------------------------------------------------------------

tmf620Router.get('/productOffering', asyncHandler(async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const versionId = versionHeader(req);
    const specId = req.query['productSpecification.id'];
    const { rows, total } = await offeringRepository.list(pool, t(req), {
        versionId,
        publishedAt: versionId ? undefined : optionalDate(req.query.effectiveAt, 'effectiveAt') ?? new Date(),
        productSpecificationId: specId === undefined ? undefined : parseId(specId, 'productSpecification.id'),
        name: optionalString(req.query.name, 'name'),
        limit,
        offset,
    });
    const extras = await offeringExtras(t(req), rows);
    const a = adapter(req);
    sendList(req, res, rows.map((r) => a.toProductOffering(r, extras(r.id))) as any[], total);
}));

tmf620Router.get('/productOffering/:id', asyncHandler(async (req, res) => {
    const row = await offeringRepository.get(pool, t(req), parseId(req.params.id));
    if (!row) throw notFound('ProductOffering', req.params.id as string);
    const extras = await offeringExtras(t(req), [row]);
    res.json(project(req, adapter(req).toProductOffering(row, extras(row.id)) as any));
}));

tmf620Router.post('/productOffering', asyncHandler(async (req, res) => {
    const versionId = versionHeader(req);
    if (!versionId) throw badRequest('x-catalogue-version-id header is required to create a ProductOffering');
    const input = TMF620Adapter.fromProductOffering(req.body, 'create');
    const created = await offeringService.create(t(req), {
        catalogue_version_id: versionId,
        product_specification_id: input.product_specification_id!,
        offering_name: input.offering_name!,
        offering_type: input.offering_type,
    });
    const body = adapter(req).toProductOffering(created);
    res.status(201).location(body.href).json(body);
}));

tmf620Router.patch('/productOffering/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const versionId = versionHeader(req);
    const existing = await offeringService.get(t(req), id);
    if (versionId && existing.catalogue_version_id !== versionId) {
        throw conflict(`ProductOffering ${id} does not belong to catalogue version ${versionId}`);
    }
    const updated = await offeringService.update(t(req), id, TMF620Adapter.fromProductOffering(req.body, 'patch'));
    const extras = await offeringExtras(t(req), [updated]);
    res.json(adapter(req).toProductOffering(updated, extras(updated.id)));
}));

tmf620Router.delete('/productOffering/:id', asyncHandler(async (req, res) => {
    await offeringService.remove(t(req), parseId(req.params.id));
    res.status(204).end();
}));

// ---- ProductOfferingPrice ------------------------------------------------------------------------------

tmf620Router.get('/productOfferingPrice', asyncHandler(async (req, res) => {
    const { limit, offset } = pagination(req.query);
    const offeringId = req.query['productOffering.id'];
    const { rows, total } = await listResolvedRates(pool, {
        tenantId: t(req),
        ...priceContext(req),
        offeringId: offeringId === undefined ? undefined : parseId(offeringId, 'productOffering.id'),
        versionId: versionHeader(req),
        limit,
        offset,
    });
    const a = adapter(req);
    sendList(req, res, rows.map((r) => a.toProductOfferingPrice(r)) as any[], total);
}));

tmf620Router.get('/productOfferingPrice/:id', asyncHandler(async (req, res) => {
    // marketId on a single price selects whose market overrides apply; it does not filter.
    const { rows } = await listResolvedRates(pool, { tenantId: t(req), ...priceContext(req), rateId: parseId(req.params.id), filterByMarket: false });
    if (!rows[0]) throw notFound('ProductOfferingPrice', req.params.id as string);
    res.json(project(req, adapter(req).toProductOfferingPrice(rows[0]) as any));
}));

// ---- Catalog & Category (read-only) ----------------------------------------------------------------

tmf620Router.get('/catalog', asyncHandler(async (req, res) => {
    const a = adapter(req);
    const list = await catalogueService.listCatalogues(t(req));
    const items = await Promise.all(
        list.map(async (c) => a.toCatalog(c, c.released_version_id ? await catalogueRepository.getVersion(pool, t(req), c.released_version_id) : null))
    );
    sendList(req, res, items as any[], items.length);
}));

tmf620Router.get('/catalog/:id', asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const list = await catalogueService.listCatalogues(t(req));
    const c = list.find((x) => x.id === id);
    if (!c) throw notFound('Catalog', id);
    const version = c.released_version_id ? await catalogueRepository.getVersion(pool, t(req), c.released_version_id) : null;
    res.json(project(req, adapter(req).toCatalog(c, version) as any));
}));

tmf620Router.get('/category', asyncHandler(async (req, res) => {
    const a = adapter(req);
    const items = (await categories.list(pool, t(req))).map((c) => a.toCategory(c));
    sendList(req, res, items as any[], items.length);
}));

tmf620Router.get('/category/:id', asyncHandler(async (req, res) => {
    const row = await categories.get(pool, t(req), parseId(req.params.id));
    if (!row) throw notFound('Category', req.params.id as string);
    res.json(project(req, adapter(req).toCategory(row) as any));
}));
