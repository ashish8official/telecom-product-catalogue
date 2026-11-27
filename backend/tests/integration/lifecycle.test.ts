import { closePool, pool } from '../../db/pool';
import { API, as, buildDraftCatalogue, dropTenant, newTenant, TMF } from '../helpers';

afterAll(closePool);

describe('catalogue version lifecycle', () => {
    const tenant = newTenant();
    let fx: Awaited<ReturnType<typeof buildDraftCatalogue>>;
    beforeAll(async () => {
        fx = await buildDraftCatalogue(tenant);
    });
    afterAll(() => dropTenant(tenant));

    it('blocks approval while a charge has no rate', async () => {
        const offering = fx.ok(await fx.api.post(`${API}/offerings`, {
            catalogue_version_id: fx.version.id, product_specification_id: fx.spec.id, offering_name: 'Unpriced',
        }));
        await fx.api.post(`${API}/offerings/${offering.id}/charges`, { charge_spec_id: fx.charge.id });
        const res = await fx.api.post(`${API}/versions/${fx.version.id}/transition`, { status: 'APPROVED' });
        expect(res.status).toBe(422);
        expect(res.body.error.details).toEqual(['Charge RC_MONTHLY on offering UNPRICED has no rate in any market']);
        expect((await fx.api.delete(`${API}/offerings/${offering.id}`)).status).toBe(204);
    });

    it('rejects skipping a lifecycle step', async () => {
        const res = await fx.api.post(`${API}/versions/${fx.version.id}/transition`, { status: 'RELEASED' });
        expect(res.status).toBe(409);
        expect(res.body.error.details.allowed).toEqual(['APPROVED', 'RETIRED']);
    });

    it('releases, publishes and then freezes the version', async () => {
        expect((await fx.api.post(`${API}/versions/${fx.version.id}/transition`, { status: 'APPROVED' })).status).toBe(200);
        expect((await fx.api.put(`${API}/offerings/${fx.offering.id}/rates`, { charge_spec_id: fx.charge.id, market_id: fx.markets.country.id, amount: '1' })).status).toBe(409);

        const released = await fx.api.post(`${API}/versions/${fx.version.id}/transition`, { status: 'RELEASED' });
        expect(released.status).toBe(200);
        expect(released.body.status).toBe('RELEASED');
        expect(released.body.valid_from).toBeTruthy();

        const published = await fx.api.get(`${TMF}/productOffering`);
        expect(published.body.map((o: any) => o.name)).toEqual(['Fibre 500']);

        expect((await fx.api.delete(`${API}/versions/${fx.version.id}`)).status).toBe(409);
        expect((await fx.api.patch(`${API}/versions/${fx.version.id}`, { version: 'v1-edited' })).status).toBe(409);
        // Even raw SQL cannot re-price a released rate (migration 019).
        await expect(pool.query('UPDATE offering_rate SET amount = 1 WHERE id = $1', [fx.rateId])).rejects.toMatchObject({ code: 'CV001' });
    });

    it('clones a released version into a draft whose edits do not touch the original', async () => {
        const v2 = fx.ok(await fx.api.post(`${API}/versions`, { catalogue_id: fx.catalogue.id, version: 'v2', clone_from_version_id: fx.version.id }));
        expect(v2.cloned_offering_count).toBe(1);
        const [copy] = fx.ok(await fx.api.get(`${API}/versions/${v2.id}/offerings`), 200);
        expect(copy.offering_code).toBe('FIBRE_500');
        expect(copy.rates).toHaveLength(1);

        fx.ok(await fx.api.put(`${API}/offerings/${copy.id}/rates`, { charge_spec_id: fx.charge.id, market_id: fx.markets.country.id, amount: '35.00' }), 200);

        const original = fx.ok(await fx.api.get(`${API}/offerings/${fx.offering.id}`), 200);
        expect(original.rates[0].amount).toBe('30.000000');

        // Publishing v2 supersedes v1 for readers without editing v1.
        await fx.api.post(`${API}/versions/${v2.id}/transition`, { status: 'APPROVED' });
        await fx.api.post(`${API}/versions/${v2.id}/transition`, { status: 'RELEASED' });
        const prices = await fx.api.get(`${TMF}/productOfferingPrice?marketId=${fx.markets.country.id}`);
        expect(prices.body.map((p: any) => p.price.value)).toEqual([35]);
        const asOfV1 = await fx.api.get(`${TMF}/productOfferingPrice`).set('x-catalogue-version-id', fx.version.id);
        expect(asOfV1.body.map((p: any) => p.price.value)).toEqual([30]);
    });

    it('lets a draft be deleted with its content, and retires a released version', async () => {
        const v3 = fx.ok(await fx.api.post(`${API}/versions`, { catalogue_id: fx.catalogue.id, version: 'v3', clone_from_version_id: fx.version.id }));
        expect((await fx.api.delete(`${API}/versions/${v3.id}`)).status).toBe(204);
        expect((await fx.api.get(`${API}/versions/${v3.id}`)).status).toBe(404);

        const retired = await fx.api.post(`${API}/versions/${fx.version.id}/transition`, { status: 'RETIRED' });
        expect(retired.body.status).toBe('RETIRED');
        expect((await fx.api.post(`${API}/versions/${fx.version.id}/transition`, { status: 'RELEASED' })).status).toBe(409);
    });

    it('refuses to clone across catalogues', async () => {
        const other = fx.ok(await fx.api.post(`${API}/catalogues`, { name: 'Other' }));
        const res = await fx.api.post(`${API}/versions`, { catalogue_id: other.id, version: 'v1', clone_from_version_id: fx.version.id });
        expect(res.status).toBe(400);
    });
});

describe('offering configuration rules', () => {
    const tenant = newTenant();
    let fx: Awaited<ReturnType<typeof buildDraftCatalogue>>;
    beforeAll(async () => {
        fx = await buildDraftCatalogue(tenant);
    });
    afterAll(() => dropTenant(tenant));

    it('only prices charges the offering carries, in pricing markets', async () => {
        const other = fx.ok(await fx.api.post(`${API}/charge-specifications`, { charge_code: 'OT_SETUP', charge_name: 'Setup' }));
        const notAttached = await fx.api.put(`${API}/offerings/${fx.offering.id}/rates`, { charge_spec_id: other.id, market_id: fx.markets.country.id, amount: '5' });
        expect(notAttached.status).toBe(422);
        const groupMarket = await fx.api.put(`${API}/offerings/${fx.offering.id}/rates`, { charge_spec_id: fx.charge.id, market_id: fx.markets.region.id, amount: '5' });
        expect(groupMarket.status).toBe(422);
        expect(groupMarket.body.error.message).toMatch(/not a pricing market/);
    });

    it('validates amounts and request bodies', async () => {
        const bad = await fx.api.put(`${API}/offerings/${fx.offering.id}/rates`, { charge_spec_id: fx.charge.id, market_id: fx.markets.country.id, amount: '1.1234567' });
        expect(bad.status).toBe(400);
        expect(bad.body.error.details[0].field).toBe('amount');
        const unknown = await fx.api.post(`${API}/catalogues`, { name: 'X', owner: 'me' });
        expect(unknown.status).toBe(400);
    });

    it('rejects circular REQUIRES chains but allows mutual EXCLUDES', async () => {
        const mk = async (n: string) => fx.ok(await fx.api.post(`${API}/offerings`, { catalogue_version_id: fx.version.id, product_specification_id: fx.spec.id, offering_name: n }));
        const a = await mk('Rel A');
        const b = await mk('Rel B');
        const c = await mk('Rel C');
        fx.ok(await fx.api.post(`${API}/offerings/${a.id}/relationships`, { target_offering_id: b.id, relationship_type: 'REQUIRES' }));
        fx.ok(await fx.api.post(`${API}/offerings/${b.id}/relationships`, { target_offering_id: c.id, relationship_type: 'REQUIRES' }));
        const cycle = await fx.api.post(`${API}/offerings/${c.id}/relationships`, { target_offering_id: a.id, relationship_type: 'REQUIRES' });
        expect(cycle.status).toBe(409);
        expect(cycle.body.error.message).toMatch(/circular/);
        fx.ok(await fx.api.post(`${API}/offerings/${a.id}/relationships`, { target_offering_id: c.id, relationship_type: 'EXCLUDES' }));
        fx.ok(await fx.api.post(`${API}/offerings/${c.id}/relationships`, { target_offering_id: a.id, relationship_type: 'EXCLUDES' }));
        for (const o of [a, b, c]) await fx.api.delete(`${API}/offerings/${o.id}`);
    });

    it('rejects circular market hierarchies and unknown time zones', async () => {
        const res = await fx.api.patch(`${API}/markets/${fx.markets.region.id}`, { parent_market_id: fx.markets.city.id });
        expect(res.status).toBe(409);
        const tz = await fx.api.post(`${API}/markets`, { market_code: 'MARS', market_name: 'Mars', timezone: 'Mars/Olympus_Mons' });
        expect(tz.status).toBe(422);
    });

    it('validates policy rules against their schema', async () => {
        const schema = fx.ok(await fx.api.post(`${API}/policy-schemas`, {
            schema_name: 'SEGMENT', version: '1.0',
            schema_json: { type: 'object', properties: { segment: { enum: ['B2B', 'B2C'] } }, required: ['segment'] },
        }));
        expect((await fx.api.post(`${API}/policy-rules`, { schema_id: schema.id, rule_json: { segment: 'B2X' } })).status).toBe(422);
        fx.ok(await fx.api.post(`${API}/policy-rules`, { schema_id: schema.id, rule_json: { segment: 'B2B' } }));
        expect((await fx.api.post(`${API}/policy-schemas`, { schema_name: 'BAD', version: '1', schema_json: { type: 12 } })).status).toBe(422);
    });
});

describe('price overrides', () => {
    const tenant = newTenant();
    let fx: Awaited<ReturnType<typeof buildDraftCatalogue>>;
    beforeAll(async () => {
        fx = await buildDraftCatalogue(tenant);
    });
    afterAll(() => dropTenant(tenant));

    const override = (from: string, to: string | null, ref = 'SUB-1', amount = '10') => ({
        scope_type: 'SUBSCRIBER', scope_reference_id: ref, override_amount: amount, effective_from: from, effective_to: to,
    });

    it('accepts non-overlapping periods and rejects overlapping ones', async () => {
        const url = `${API}/rates/${fx.rateId}/overrides`;
        fx.ok(await fx.api.post(url, override('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')));
        fx.ok(await fx.api.post(url, override('2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z')));
        expect((await fx.api.post(url, override('2026-01-15T00:00:00Z', null))).status).toBe(409);
        fx.ok(await fx.api.post(url, override('2026-01-15T00:00:00Z', null, 'SUB-2')));
        expect((await fx.api.post(url, override('2026-04-01T00:00:00Z', '2026-03-01T00:00:00Z', 'SUB-3'))).status).toBe(422);
        expect((await fx.api.post(url, override('2026-04-01T00:00:00Z', null, 'SUB-3', '-1'))).status).toBe(400);
    });

    it('lets only one of two concurrent conflicting overrides through', async () => {
        const url = `${API}/rates/${fx.rateId}/overrides`;
        const results = await Promise.all(
            Array.from({ length: 5 }, () => fx.api.post(url, override('2027-01-01T00:00:00Z', null, 'SUB-RACE')))
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    });

    it('never changes the catalogue rate and can be ended', async () => {
        const rate = await pool.query('SELECT amount::text FROM offering_rate WHERE id = $1', [fx.rateId]);
        expect(rate.rows[0].amount).toBe('30.000000');
        const list = fx.ok(await fx.api.get(`${API}/rates/${fx.rateId}/overrides`), 200);
        const open = list.find((o: any) => o.scope_reference_id === 'SUB-2');
        expect((await fx.api.post(`${API}/overrides/${open.id}/end`, {})).status).toBe(200);
        const after = fx.ok(await fx.api.get(`${API}/rates/${fx.rateId}/overrides`), 200);
        expect(after.find((o: any) => o.id === open.id).effective_to).not.toBeNull();
    });
});
