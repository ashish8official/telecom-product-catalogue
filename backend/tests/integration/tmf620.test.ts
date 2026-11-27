import { closePool } from '../../db/pool';
import { API, as, buildDraftCatalogue, dropTenant, newTenant, SEED, TMF } from '../helpers';

afterAll(closePool);

const seed = as(SEED.tenant);
const INTERNAL_FIELDS = ['tenant_id', 'offering_code', 'spec_code', 'catalogue_version_id', 'offering_type', 'service_type', 'charge_spec_id', 'amount'];

const noInternalLeak = (body: unknown) => {
    const text = JSON.stringify(body);
    for (const f of INTERNAL_FIELDS) expect(text).not.toContain(`"${f}"`);
};

describe('TMF620 reads (seed data)', () => {
    it('lists only offerings of the released, in-force version, with TMF shape and paging headers', async () => {
        const res = await seed.get(`${TMF}/productOffering`);
        expect(res.status).toBe(200);
        expect(res.headers['x-total-count']).toBe('4');
        expect(res.headers['x-result-count']).toBe('4');
        const names = res.body.map((o: any) => o.name).sort();
        expect(names).toEqual(['M2M Basic Plan', 'M2M Premium Plan', 'Prepaid Voice 30-Day', 'Static IP Add-on']);
        for (const o of res.body) {
            expect(o['@type']).toBe('ProductOffering');
            expect(o.lifecycleStatus).toBe('Launched');
            expect(o.version).toBe('v1');
            expect(o.isSellable).toBe(true);
            expect(o.href).toMatch(new RegExp(`${TMF}/productOffering/${o.id}$`));
            expect(o.productSpecification['@referredType']).toBe('ProductSpecification');
        }
        noInternalLeak(res.body);
    });

    it('returns 206 with paging when the page is partial', async () => {
        const res = await seed.get(`${TMF}/productOffering?limit=2&offset=1`);
        expect(res.status).toBe(206);
        expect(res.headers['x-total-count']).toBe('4');
        expect(res.body).toHaveLength(2);
    });

    it('supports TMF630 attribute selection', async () => {
        const res = await seed.get(`${TMF}/productOffering/${SEED.offerings.base}?fields=name`);
        expect(Object.keys(res.body).sort()).toEqual(['@type', 'href', 'id', 'name']);
    });

    it('exposes prices, relationships and categories on an offering', async () => {
        const res = await seed.get(`${TMF}/productOffering/${SEED.offerings.staticIp}`);
        expect(res.status).toBe(200);
        expect(res.body.productOfferingPrice.length).toBe(3);
        expect(res.body.productOfferingRelationship).toEqual([
            expect.objectContaining({ id: SEED.offerings.base, relationshipType: 'requires', name: 'M2M Basic Plan' }),
        ]);
        expect(res.body.category[0].name).toBe('Add-ons');
    });

    it('reads a draft version only when asked for it explicitly', async () => {
        const res = await seed.get(`${TMF}/productOffering`).set('x-catalogue-version-id', SEED.v2);
        expect(res.body.map((o: any) => o.name).sort()).toEqual(['M2M Basic Plan', 'M2M Unlimited Plan']);
        expect(res.body.every((o: any) => o.lifecycleStatus === 'In design' && o.isSellable === false)).toBe(true);
    });

    it('prices a city from its country rate and applies a city market override', async () => {
        const res = await seed.get(`${TMF}/productOfferingPrice?marketId=${SEED.markets.LAGOS}&productOffering.id=${SEED.offerings.base}`);
        expect(res.status).toBe(200);
        const monthly = res.body.find((p: any) => p.priceType === 'recurring');
        expect(monthly.price).toEqual({ unit: 'NGN', value: 1199 });
        expect(monthly.priceResolution).toEqual({ source: 'MARKET', catalogueValue: 1299 });
        expect(monthly.recurringChargePeriodType).toBe('month');
        expect(monthly.recurringChargePeriodLength).toBe(1);
        const activation = res.body.find((p: any) => p.priceType === 'oneTime');
        expect(activation.price).toEqual({ unit: 'NGN', value: 500 });
        noInternalLeak(res.body);
    });

    it('resolves subscriber > account > market > catalogue on a single price', async () => {
        const url = `${TMF}/productOfferingPrice/${SEED.rates.baseMonthlyNGA}`;
        const plain = await seed.get(url);
        expect(plain.body.price.value).toBe(1299);
        expect(plain.body.priceResolution.source).toBe('CATALOGUE_RATE');

        const sub = await seed.get(`${url}?subscriberId=SUB-NGA-001&accountId=ACC-CORP-01&marketId=${SEED.markets.LAGOS}`);
        expect(sub.body.price.value).toBe(999);
        expect(sub.body.priceResolution.source).toBe('SUBSCRIBER');

        const acc = await seed.get(`${url}?accountId=ACC-CORP-01&marketId=${SEED.markets.LAGOS}`);
        expect(acc.body.priceResolution.source).toBe('ACCOUNT');
        expect(acc.body.price.value).toBe(1150);

        const past = await seed.get(`${url}?subscriberId=SUB-NGA-001&effectiveAt=2000-01-01T00:00:00Z`);
        expect(past.body.priceResolution.source).toBe('CATALOGUE_RATE');
    });

    it('reports percentage charges as a percentage', async () => {
        const res = await seed.get(`${TMF}/productOfferingPrice?productOffering.id=${SEED.offerings.premium}&marketId=${SEED.markets.NGA}`);
        const discount = res.body.find((p: any) => p.percentage !== undefined);
        expect(discount.percentage).toBe(-10);
        expect(discount.price).toBeUndefined();
    });

    it('serves catalog and category resources', async () => {
        const cat = await seed.get(`${TMF}/catalog`);
        expect(cat.body).toEqual([expect.objectContaining({ id: SEED.catalogue, version: 'v1', lifecycleStatus: 'Launched', catalogType: 'productCatalog' })]);
        const categories = await seed.get(`${TMF}/category`);
        const addOns = categories.body.find((c: any) => c.name === 'Add-ons');
        expect(addOns.isRoot).toBe(false);
    });
});

describe('TMF620 errors and isolation', () => {
    it('requires a tenant', async () => {
        const res = await as('').get(`${TMF}/productOffering`).unset('x-tenant-id');
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ '@type': 'Error', code: 'BAD_REQUEST', status: '400' });
    });

    it('rejects malformed ids and dates with 400', async () => {
        expect((await seed.get(`${TMF}/productOffering/not-a-uuid`)).status).toBe(400);
        expect((await seed.get(`${TMF}/productOfferingPrice?effectiveAt=yesterday`)).status).toBe(400);
        expect((await seed.get(`${TMF}/productOffering?limit=0`)).status).toBe(400);
    });

    it('returns TMF 404 for unknown resources and paths', async () => {
        const res = await seed.get(`${TMF}/productOffering/00000000-0000-4000-a000-000000000000`);
        expect(res.status).toBe(404);
        expect(res.body['@type']).toBe('Error');
        expect((await seed.get(`${TMF}/serviceSpecification`)).status).toBe(404);
    });

    it('never shows one tenant another tenant\'s data', async () => {
        const b = as(SEED.tenantB);
        expect((await b.get(`${TMF}/productOffering/${SEED.offerings.base}`)).status).toBe(404);
        expect((await b.get(`${TMF}/productOfferingPrice/${SEED.rates.baseMonthlyNGA}`)).status).toBe(404);
        const list = await b.get(`${TMF}/productOffering`);
        expect(list.body.map((o: any) => o.name)).toEqual(['Unlimited 5G']);
    });

    it('refuses edits to released content with 409', async () => {
        const res = await seed.patch(`${TMF}/productOffering/${SEED.offerings.base}`, { name: 'Hacked' });
        expect(res.status).toBe(409);
        expect(res.body.reason).toMatch(/only DRAFT versions can be edited/);
    });
});

describe('TMF620 writes', () => {
    const tenant = newTenant();
    let fx: Awaited<ReturnType<typeof buildDraftCatalogue>>;
    beforeAll(async () => {
        fx = await buildDraftCatalogue(tenant);
    });
    afterAll(() => dropTenant(tenant));

    it('creates, patches and deletes a ProductSpecification', async () => {
        const created = await fx.api.post(`${TMF}/productSpecification`, { name: 'Mobile Data', lifecycleStatus: 'In design' });
        expect(created.status).toBe(201);
        expect(created.headers.location).toBe(created.body.href);
        expect(created.body).toMatchObject({ name: 'Mobile Data', lifecycleStatus: 'In design', '@type': 'ProductSpecification' });

        const dup = await fx.api.post(`${TMF}/productSpecification`, { name: 'Mobile Data' });
        expect(dup.status).toBe(409);

        const patched = await fx.api.patch(`${TMF}/productSpecification/${created.body.id}`, { lifecycleStatus: 'Active', validFor: { endDateTime: '2099-01-01T00:00:00Z' } });
        expect(patched.status).toBe(200);
        expect(patched.body.lifecycleStatus).toBe('Active');
        expect(patched.body.validFor.endDateTime).toBe('2099-01-01T00:00:00.000Z');

        expect((await fx.api.patch(`${TMF}/productSpecification/${created.body.id}`, { lifecycleStatus: 'Sleeping' })).status).toBe(400);
        expect((await fx.api.delete(`${TMF}/productSpecification/${created.body.id}`)).status).toBe(204);
    });

    it('will not delete a specification that offerings use', async () => {
        const res = await fx.api.delete(`${TMF}/productSpecification/${fx.spec.id}`);
        expect(res.status).toBe(409);
    });

    it('creates an offering in the draft named by the header', async () => {
        const missing = await fx.api.post(`${TMF}/productOffering`, { name: 'Fibre 1G', productSpecification: { id: fx.spec.id } });
        expect(missing.status).toBe(400);

        const res = await fx.api
            .post(`${TMF}/productOffering`, { name: 'Fibre 1G', isBundle: false, productSpecification: { id: fx.spec.id } })
            .set('x-catalogue-version-id', fx.version.id);
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ name: 'Fibre 1G', lifecycleStatus: 'In design', isBundle: false });

        const renamed = await fx.api.patch(`${TMF}/productOffering/${res.body.id}`, { name: 'Fibre 1 Gbps' });
        expect(renamed.body.name).toBe('Fibre 1 Gbps');

        const wrongVersion = await fx.api.patch(`${TMF}/productOffering/${res.body.id}`, { name: 'x' }).set('x-catalogue-version-id', SEED.v1);
        expect(wrongVersion.status).toBe(409);

        expect((await fx.api.delete(`${TMF}/productOffering/${res.body.id}`)).status).toBe(204);
    });

    it('rejects a product specification from another tenant', async () => {
        const res = await fx.api
            .post(`${TMF}/productOffering`, { name: 'Sneaky', productSpecification: { id: SEED.specs.m2m } })
            .set('x-catalogue-version-id', fx.version.id);
        expect(res.status).toBe(422);
    });

    it('rejects writes into a released version', async () => {
        await fx.api.post(`${API}/versions/${fx.version.id}/transition`, { status: 'APPROVED' });
        await fx.api.post(`${API}/versions/${fx.version.id}/transition`, { status: 'RELEASED' });
        const res = await fx.api
            .post(`${TMF}/productOffering`, { name: 'Too Late', productSpecification: { id: fx.spec.id } })
            .set('x-catalogue-version-id', fx.version.id);
        expect(res.status).toBe(409);
        const published = await fx.api.get(`${TMF}/productOffering`);
        expect(published.body.map((o: any) => o.name)).toEqual(['Fibre 500']);
    });
});
