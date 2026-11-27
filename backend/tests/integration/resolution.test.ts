import { closePool, pool } from '../../db/pool';
import { quoteOffering } from '../../services/pricingService';
import { resolve_journal } from '../../services/resolve_journal';
import { resolve_policy } from '../../services/resolve_policy';
import { resolve_tax } from '../../services/resolve_tax';
import { apply_charge_stacking } from '../../services/apply_charge_stacking';
import { resolve_market_eligibility } from '../../services/marketResolver';
import { API, as, SEED } from '../helpers';

afterAll(closePool);

const t = SEED.tenant;
const M = SEED.markets;
const corporate = { account_category: 'CORPORATE' };

describe('quote: full resolution against the seed', () => {
    it('prices M2M Basic in Nigeria with activation, VAT and GL codes', async () => {
        const q = await quoteOffering(pool, { tenantId: t, offeringId: SEED.offerings.base, marketId: M.NGA, context: corporate });
        expect(q.sellable).toBe(true);
        expect(q.lines.map((l) => [l.charge_code, l.net_amount, l.tax_amount])).toEqual([
            ['RC_M2M_MONTHLY', '1299.000000', '97.425000'],
            ['OT_ACTIVATION', '500.000000', '37.500000'],
        ]);
        expect(q.lines[0].journals).toEqual([{ gl_code: '4000-REV-M2M', gl_description: 'M2M Revenue' }]);
        expect(q.totals).toEqual(
            expect.arrayContaining([
                { currency_code: 'NGN', charge_type: 'RECURRING', charge_period: 'MONTH', net: '1299.000000', tax: '97.425000', gross: '1396.425000' },
                { currency_code: 'NGN', charge_type: 'ONE_TIME', charge_period: null, net: '500.000000', tax: '37.500000', gross: '537.500000' },
            ])
        );
    });

    it('a city inherits the country rate and tax, and its own market override applies', async () => {
        const q = await quoteOffering(pool, { tenantId: t, offeringId: SEED.offerings.base, marketId: M.LAGOS, context: corporate });
        const monthly = q.lines[0];
        expect(monthly.rate_market_id).toBe(M.NGA);
        expect(monthly.resolution_source).toBe('MARKET');
        expect(monthly.net_amount).toBe('1199.000000');
        expect(monthly.taxes[0]).toMatchObject({ tax_name: 'Nigeria VAT', fallback_level: 'PARENT_MARKET' });
    });

    it('subscriber override beats account and market overrides', async () => {
        const q = await quoteOffering(pool, {
            tenantId: t, offeringId: SEED.offerings.base, marketId: M.LAGOS, subscriberId: 'SUB-NGA-001', accountId: 'ACC-CORP-01', context: corporate,
        });
        expect(q.lines[0]).toMatchObject({ resolution_source: 'SUBSCRIBER', net_amount: '999.000000', catalogue_amount: '1299.000000' });
    });

    it('applies a percentage discount to the subtotal before it, sharing the monthly charge with another offering', async () => {
        const q = await quoteOffering(pool, { tenantId: t, offeringId: SEED.offerings.premium, marketId: M.NGA, context: corporate });
        expect(q.lines.map((l) => [l.charge_code, l.catalogue_amount, l.percentage_base, l.net_amount])).toEqual([
            ['RC_M2M_MONTHLY', '2499.000000', null, '2499.000000'],
            ['DISC_LAUNCH', '-10.000000', '2499.000000', '-249.900000'],
        ]);
        expect(q.totals[0]).toMatchObject({ net: '2249.100000', tax: '168.682500', gross: '2417.782500' });
    });

    it('is not sellable where the offering is excluded, or when policy fails', async () => {
        const excluded = await quoteOffering(pool, { tenantId: t, offeringId: SEED.offerings.staticIp, marketId: M.ZAF });
        expect(excluded.sellable).toBe(false);
        expect(excluded.eligibility).toEqual({ allowed: false, decided_by_market_id: M.ZAF, reason: 'EXCLUDED' });
        expect(excluded.warnings[0]).toMatch(/no rate for market ZAF/);

        const consumer = await quoteOffering(pool, { tenantId: t, offeringId: SEED.offerings.base, marketId: M.NGA, context: { account_category: 'CONSUMER' } });
        expect(consumer.sellable).toBe(false);
        expect(consumer.policy.passed).toBe(false);
    });

    it('lists relationships for order validation', async () => {
        const q = await quoteOffering(pool, { tenantId: t, offeringId: SEED.offerings.staticIp, marketId: M.NGA });
        expect(q.relationships).toEqual([{ type: 'REQUIRES', target_offering_id: SEED.offerings.base, target_code: 'M2M_BASE' }]);
    });

    it('flags provisional prices from a draft version', async () => {
        const q = await quoteOffering(pool, { tenantId: t, offeringId: SEED.offerings.v2Base, marketId: M.NGA, context: corporate });
        expect(q.lines[0].net_amount).toBe('1399.000000');
        expect(q.warnings[0]).toMatch(/DRAFT catalogue version/);
    });

    it('is exposed over the internal API with validation', async () => {
        const api = as(t);
        const ok = await api.post(`${API}/quote`, { offering_id: SEED.offerings.voice, market_id: M.KEN });
        expect(ok.status).toBe(200);
        expect(ok.body.totals[0]).toMatchObject({ currency_code: 'KES', net: '300.000000', tax: '48.000000' });
        expect((await api.post(`${API}/quote`, { offering_id: SEED.offerings.voice })).status).toBe(400);
        expect((await as(SEED.tenantB).post(`${API}/quote`, { offering_id: SEED.offerings.voice, market_id: M.KEN })).status).toBe(404);
    });
});

describe('individual resolvers', () => {
    it('apply_charge_stacking orders by priority', async () => {
        const charges = await apply_charge_stacking(pool, { tenant_id: t, offering_id: SEED.offerings.base });
        expect(charges.map((c) => c.charge_code)).toEqual(['RC_M2M_MONTHLY', 'OT_ACTIVATION']);
    });

    it('resolve_market_eligibility walks the hierarchy', async () => {
        expect((await resolve_market_eligibility(pool, t, SEED.offerings.staticIp, M.NGA)).allowed).toBe(true);
        expect((await resolve_market_eligibility(pool, t, SEED.offerings.staticIp, M.ZAF)).allowed).toBe(false);
    });

    it('resolve_tax returns nothing outside the taxed market tree', async () => {
        expect(await resolve_tax(pool, t, SEED.charges.monthly, M.AFR)).toEqual([]);
        const lagos = await resolve_tax(pool, t, SEED.charges.monthly, M.LAGOS);
        expect(lagos.map((x) => [x.tax_name, x.fallback_level])).toEqual([['Nigeria VAT', 'PARENT_MARKET']]);
    });

    it('resolve_journal returns mapped GL codes', async () => {
        expect((await resolve_journal(pool, t, SEED.charges.activation)).map((j) => j.gl_code)).toEqual(['4200-REV-ACTIVATION']);
    });

    it('resolve_policy evaluates against the market time zone', async () => {
        const r = await resolve_policy(pool, { tenant_id: t, offering_id: SEED.offerings.base, market_id: M.NGA, effective_at: new Date(), context_json: corporate });
        expect(r.passed).toBe(true);
    });
});
