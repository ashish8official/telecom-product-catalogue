import { Request, Response, Router } from 'express';
import { pool } from '../../db/pool';
import { asyncHandler, ctx } from '../../http/middleware';
import {
    amount,
    code,
    currencyCode,
    isoDate,
    name,
    nullableIsoDate,
    optionalDate,
    parse,
    parseId,
    uuid,
    z,
} from '../../http/validate';
import { catalogueService } from '../../services/catalogueService';
import { offeringService } from '../../services/offeringService';
import { quoteOffering } from '../../services/pricingService';
import { referenceDataService as ref } from '../../services/referenceDataService';

/**
 * Internal administration API used by the catalogue admin UI. It speaks the engine's own model
 * (snake_case, internal codes); it is NOT the integration surface for external systems, which is
 * TMF620 only.
 */
export const internalRouter = Router();

const t = (req: Request) => ctx(req).tenantId;
const id = (req: Request, param = 'id') => parseId(req.params[param], param);
const get = (path: string, fn: (req: Request) => Promise<unknown>) =>
    internalRouter.get(path, asyncHandler(async (req, res) => void res.json(await fn(req))));
const post = (path: string, fn: (req: Request) => Promise<unknown>, status = 201) =>
    internalRouter.post(path, asyncHandler(async (req, res) => void res.status(status).json((await fn(req)) ?? { ok: true })));
const put = (path: string, fn: (req: Request) => Promise<unknown>) =>
    internalRouter.put(path, asyncHandler(async (req, res) => void res.json((await fn(req)) ?? { ok: true })));
const patch = (path: string, fn: (req: Request) => Promise<unknown>) =>
    internalRouter.patch(path, asyncHandler(async (req, res) => void res.json(await fn(req))));
const del = (path: string, fn: (req: Request) => Promise<unknown>) =>
    internalRouter.delete(path, asyncHandler(async (req, res: Response) => {
        await fn(req);
        res.status(204).end();
    }));

// ---- session ----------------------------------------------------------------------------------------
get('/me', async (req) => ({ tenantId: t(req), role: ctx(req).role, authMode: ctx(req).authMode }));

// ---- catalogues & versions -------------------------------------------------------------------------
const catalogueInput = z.object({ name, description: z.string().max(4000).nullable().optional() }).strict();
const versionLabel = z.string().trim().min(1).max(50);

get('/catalogues', (req) => catalogueService.listCatalogues(t(req)));
post('/catalogues', (req) => catalogueService.createCatalogue(t(req), parse(catalogueInput, req.body)));
get('/catalogues/:id', (req) => catalogueService.getCatalogue(t(req), id(req)));
patch('/catalogues/:id', (req) => catalogueService.updateCatalogue(t(req), id(req), parse(catalogueInput.partial(), req.body)));
get('/catalogues/:id/versions', (req) => catalogueService.listVersions(t(req), id(req)));

get('/versions', (req) => catalogueService.listVersions(t(req), req.query.catalogueId ? parseId(req.query.catalogueId, 'catalogueId') : undefined));
post('/versions', (req) =>
    catalogueService.createVersion(
        t(req),
        parse(
            z
                .object({
                    catalogue_id: uuid,
                    version: versionLabel,
                    valid_from: nullableIsoDate.optional(),
                    valid_to: nullableIsoDate.optional(),
                    clone_from_version_id: uuid.optional(),
                })
                .strict(),
            req.body
        )
    )
);
get('/versions/:id', (req) => catalogueService.getVersion(t(req), id(req)));
patch('/versions/:id', (req) =>
    catalogueService.updateVersion(
        t(req),
        id(req),
        parse(z.object({ version: versionLabel, valid_from: nullableIsoDate, valid_to: nullableIsoDate }).partial().strict(), req.body)
    )
);
post(
    '/versions/:id/transition',
    (req) => catalogueService.transition(t(req), id(req), parse(z.object({ status: z.enum(['APPROVED', 'RELEASED', 'RETIRED']) }).strict(), req.body).status),
    200
);
del('/versions/:id', (req) => catalogueService.deleteVersion(t(req), id(req)));
get('/versions/:id/offerings', async (req) => (await offeringService.listDetailed(t(req), { versionId: id(req) })).rows);

// ---- offerings ----------------------------------------------------------------------------------------
const offeringType = z.enum(['BASE', 'ADDON', 'BUNDLE', 'STANDALONE']);
const serviceType = z.enum(['PREPAID', 'POSTPAID', 'BOTH']);

post('/offerings', (req) =>
    offeringService.create(
        t(req),
        parse(
            z
                .object({
                    catalogue_version_id: uuid,
                    product_specification_id: uuid,
                    offering_name: name,
                    offering_code: code.optional(),
                    offering_type: offeringType.optional(),
                    service_type: serviceType.optional(),
                })
                .strict(),
            req.body
        )
    )
);
get('/offerings/:id', (req) => offeringService.getDetailed(t(req), id(req)));
patch('/offerings/:id', (req) =>
    offeringService.update(
        t(req),
        id(req),
        parse(
            z.object({ product_specification_id: uuid, offering_name: name, offering_type: offeringType, service_type: serviceType }).partial().strict(),
            req.body
        )
    )
);
del('/offerings/:id', (req) => offeringService.remove(t(req), id(req)));

post('/offerings/:id/charges', (req) => offeringService.addCharge(t(req), id(req), parse(z.object({ charge_spec_id: uuid }).strict(), req.body).charge_spec_id));
del('/offerings/:id/charges/:chargeSpecId', (req) => offeringService.removeCharge(t(req), id(req), id(req, 'chargeSpecId')));

put('/offerings/:id/services', (req) =>
    offeringService.upsertService(
        t(req),
        id(req),
        parse(
            z
                .object({
                    service_spec_id: uuid,
                    mandatory_flag: z.boolean().default(true),
                    min_qty: z.number().int().min(0).default(1),
                    max_qty: z.number().int().min(0).default(1),
                })
                .strict(),
            req.body
        )
    )
);
del('/offerings/:id/services/:serviceSpecId', (req) => offeringService.removeService(t(req), id(req), id(req, 'serviceSpecId')));

put('/offerings/:id/rates', async (req) => ({
    id: await offeringService.upsertRate(
        t(req),
        id(req),
        parse(z.object({ charge_spec_id: uuid, market_id: uuid, currency_code: currencyCode.optional(), amount }).strict(), req.body)
    ),
}));
del('/offerings/:id/rates/:rateId', (req) => offeringService.removeRate(t(req), id(req), id(req, 'rateId')));

put('/offerings/:id/markets', (req) => {
    const body = parse(z.object({ market_id: uuid, restriction: z.enum(['INCLUDE', 'EXCLUDE']) }).strict(), req.body);
    return offeringService.setMarketRestriction(t(req), id(req), body.market_id, body.restriction);
});
del('/offerings/:id/markets/:marketId', (req) => offeringService.removeMarketRestriction(t(req), id(req), id(req, 'marketId')));

post('/offerings/:id/relationships', async (req) => {
    const body = parse(z.object({ target_offering_id: uuid, relationship_type: z.enum(['REQUIRES', 'EXCLUDES', 'UPGRADE']) }).strict(), req.body);
    return { id: await offeringService.addRelationship(t(req), id(req), body.target_offering_id, body.relationship_type) };
});
del('/offerings/:id/relationships/:relationshipId', (req) => offeringService.removeRelationship(t(req), id(req), id(req, 'relationshipId')));

post('/offerings/:id/policies', (req) => offeringService.addPolicy(t(req), id(req), parse(z.object({ policy_rule_id: uuid }).strict(), req.body).policy_rule_id));
del('/offerings/:id/policies/:ruleId', (req) => offeringService.removePolicy(t(req), id(req), id(req, 'ruleId')));

post('/offerings/:id/categories', (req) => offeringService.addCategory(t(req), id(req), parse(z.object({ category_id: uuid }).strict(), req.body).category_id));
del('/offerings/:id/categories/:categoryId', (req) => offeringService.removeCategory(t(req), id(req), id(req, 'categoryId')));

// ---- price overrides ----------------------------------------------------------------------------------
get('/rates/:id/overrides', (req) => ref.listOverrides(t(req), id(req)));
post('/rates/:id/overrides', async (req) => {
    const body = parse(
        z
            .object({
                scope_type: z.enum(['SUBSCRIBER', 'ACCOUNT', 'MARKET']),
                scope_reference_id: z.string().trim().min(1).max(255),
                override_amount: amount.refine((v) => !v.startsWith('-'), 'must not be negative'),
                effective_from: isoDate,
                effective_to: nullableIsoDate.optional(),
            })
            .strict(),
        req.body
    );
    return {
        id: await ref.createOverride(t(req), {
            offering_rate_id: id(req),
            scope_type: body.scope_type,
            scope_reference_id: body.scope_reference_id,
            override_amount: body.override_amount,
            effective_from: body.effective_from,
            effective_to: body.effective_to ?? null,
        }),
    };
});
post('/overrides/:id/end', (req) => ref.endOverride(t(req), id(req), optionalDate(req.body?.effective_to, 'effective_to') ?? new Date()), 200);
del('/overrides/:id', (req) => ref.deleteOverride(t(req), id(req)));

// ---- quote (full resolution) ------------------------------------------------------------------------
post(
    '/quote',
    (req) => {
        const body = parse(
            z
                .object({
                    offering_id: uuid,
                    market_id: uuid,
                    subscriber_id: z.string().trim().min(1).max(255).optional(),
                    account_id: z.string().trim().min(1).max(255).optional(),
                    effective_at: isoDate.optional(),
                    context: z.record(z.unknown()).optional(),
                })
                .strict(),
            req.body
        );
        return quoteOffering(pool, {
            tenantId: t(req),
            offeringId: body.offering_id,
            marketId: body.market_id,
            subscriberId: body.subscriber_id,
            accountId: body.account_id,
            effectiveAt: body.effective_at,
            context: body.context,
        });
    },
    200
);

// ---- specifications ---------------------------------------------------------------------------------
const lifecycle = z.enum(['DRAFT', 'ACTIVE', 'RETIRED', 'OBSOLETE']);
const productSpecInput = z
    .object({ spec_code: code, spec_name: name, status: lifecycle.default('ACTIVE'), effective_from: isoDate.optional(), effective_to: nullableIsoDate.optional() })
    .strict();
get('/product-specifications', (req) => ref.listProductSpecifications(t(req)));
post('/product-specifications', (req) => ref.createProductSpecification(t(req), parse(productSpecInput, req.body)));
patch('/product-specifications/:id', (req) =>
    ref.updateProductSpecification(t(req), id(req), parse(productSpecInput.omit({ spec_code: true }).partial().strict(), req.body))
);

const chargeInput = z
    .object({
        charge_code: code,
        charge_name: name,
        charge_priority: z.number().int().min(0).max(100000).default(100),
        stacking_rule: z.enum(['ADDITIVE', 'OVERRIDE']).default('ADDITIVE'),
        calculation_type: z.enum(['FLAT', 'PERCENTAGE']).default('FLAT'),
        charge_type: z.enum(['RECURRING', 'ONE_TIME', 'USAGE']).default('ONE_TIME'),
        charge_period: z.enum(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']).nullable().optional(),
    })
    .strict();
get('/charge-specifications', (req) => ref.listChargeSpecifications(t(req)));
post('/charge-specifications', (req) => ref.createChargeSpecification(t(req), parse(chargeInput, req.body)));
patch('/charge-specifications/:id', (req) =>
    ref.updateChargeSpecification(t(req), id(req), parse(chargeInput.omit({ charge_code: true }).partial().strict(), req.body))
);

const serviceInput = z.object({ spec_code: code, spec_name: name, characteristics: z.record(z.unknown()).nullable().optional() }).strict();
get('/service-specifications', (req) => ref.listServiceSpecifications(t(req)));
post('/service-specifications', (req) => ref.createServiceSpecification(t(req), parse(serviceInput, req.body)));
patch('/service-specifications/:id', (req) =>
    ref.updateServiceSpecification(t(req), id(req), parse(serviceInput.omit({ spec_code: true }).partial().strict(), req.body))
);

// ---- markets & currencies ---------------------------------------------------------------------------
const marketInput = z
    .object({
        market_code: code,
        market_name: name,
        parent_market_id: uuid.nullable().optional(),
        market_type: z.enum(['GROUP', 'COUNTRY', 'REGION', 'CITY', 'ZONE']).default('COUNTRY'),
        is_pricing_market: z.boolean().default(true),
        timezone: z.string().max(100).nullable().optional(),
        default_currency_code: currencyCode.nullable().optional(),
        status: lifecycle.default('ACTIVE'),
    })
    .strict();
get('/markets', (req) => ref.listMarkets(t(req)));
post('/markets', (req) => ref.createMarket(t(req), parse(marketInput, req.body)));
patch('/markets/:id', (req) => ref.updateMarket(t(req), id(req), parse(marketInput.omit({ market_code: true }).partial().strict(), req.body)));
get('/currencies', () => ref.currencies());
put('/currencies/:code', (req) =>
    ref.upsertCurrency(parse(currencyCode, req.params.code), parse(z.object({ currency_name: name }).strict(), req.body).currency_name)
);

// ---- categories -------------------------------------------------------------------------------------
get('/categories', (req) => ref.listCategories(t(req)));
post('/categories', (req) => ref.createCategory(t(req), parse(z.object({ name, parent_category_id: uuid.nullable().optional() }).strict(), req.body)));
patch('/categories/:id', (req) =>
    ref.updateCategory(t(req), id(req), parse(z.object({ name, parent_category_id: uuid.nullable() }).partial().strict(), req.body))
);

// ---- policies -----------------------------------------------------------------------------------------
get('/policy-schemas', (req) => ref.listPolicySchemas(t(req)));
post('/policy-schemas', (req) =>
    ref.createPolicySchema(t(req), parse(z.object({ schema_name: name, version: versionLabel, schema_json: z.record(z.unknown()) }).strict(), req.body))
);
get('/policy-rules', (req) => ref.listPolicyRules(t(req)));
post('/policy-rules', (req) => ref.createPolicyRule(t(req), parse(z.object({ schema_id: uuid, rule_json: z.record(z.unknown()) }).strict(), req.body)));
patch('/policy-rules/:id', (req) => ref.updatePolicyRule(t(req), id(req), parse(z.object({ rule_json: z.record(z.unknown()) }).strict(), req.body)));

// ---- tax & journal ------------------------------------------------------------------------------------
get('/tax-configurations', (req) => ref.listTaxConfigurations(t(req)));
post('/tax-configurations', (req) =>
    ref.createTaxConfiguration(
        t(req),
        parse(
            z
                .object({
                    tax_name: name,
                    tax_rate: amount.refine((v) => Number(v) >= 0 && Number(v) <= 100, 'must be between 0 and 100'),
                    market_master_id: uuid.nullable().optional(),
                })
                .strict(),
            req.body
        )
    )
);
get('/journal-configurations', (req) => ref.listJournalConfigurations(t(req)));
post('/journal-configurations', (req) =>
    ref.createJournalConfiguration(t(req), parse(z.object({ gl_code: z.string().trim().min(1).max(255), gl_description: z.string().max(255).nullable().optional() }).strict(), req.body))
);
get('/charge-financials', (req) => ref.chargeFinancials(t(req)));
post('/charge-specifications/:id/taxes', (req) => ref.mapTax(t(req), id(req), parse(z.object({ tax_configuration_id: uuid }).strict(), req.body).tax_configuration_id));
del('/charge-specifications/:id/taxes/:taxId', (req) => ref.unmapTax(t(req), id(req), id(req, 'taxId')));
post('/charge-specifications/:id/journals', (req) =>
    ref.mapJournal(t(req), id(req), parse(z.object({ journal_configuration_id: uuid }).strict(), req.body).journal_configuration_id)
);
del('/charge-specifications/:id/journals/:journalId', (req) => ref.unmapJournal(t(req), id(req), id(req, 'journalId')));
