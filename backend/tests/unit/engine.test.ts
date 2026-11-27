import { formatAmount, parseAmount, percentOf } from '../../domain/money';
import { stackCharges } from '../../services/apply_charge_stacking';
import { MarketMapping, MarketResolver } from '../../services/marketResolver';
import { validatePolicyRule } from '../../services/policyValidator';
import { codeFromName } from '../../services/offeringService';

describe('money (exact NUMERIC(16,6) arithmetic)', () => {
    it('round-trips decimals without float error', () => {
        expect(formatAmount(parseAmount('0.1') + parseAmount('0.2'))).toBe('0.300000');
        expect(formatAmount(parseAmount('1299'))).toBe('1299.000000');
        expect(formatAmount(parseAmount('-10.5'))).toBe('-10.500000');
    });

    it('rounds half away from zero at 6 decimals', () => {
        expect(formatAmount(parseAmount('0.0000005'))).toBe('0.000001');
        expect(formatAmount(percentOf(parseAmount('0.000015'), parseAmount('50')))).toBe('0.000008');
        expect(formatAmount(percentOf(parseAmount('-0.000015'), parseAmount('50')))).toBe('-0.000008');
    });

    it('computes percentages exactly', () => {
        expect(formatAmount(percentOf(parseAmount('2499'), parseAmount('7.5')))).toBe('187.425000');
        expect(formatAmount(percentOf(parseAmount('2499'), parseAmount('-10')))).toBe('-249.900000');
    });

    it('rejects non-numeric input', () => {
        expect(() => parseAmount('12,50')).toThrow();
        expect(() => parseAmount('abc')).toThrow();
    });
});

describe('MarketResolver (no mapping = allowed, only EXCLUDE restricts)', () => {
    const lagos = ['LAGOS', 'NGA', 'AFR'];

    it('allows when there are no mappings', () => {
        expect(MarketResolver.evaluate([], lagos)).toEqual({ allowed: true, decided_by_market_id: null, reason: 'NO_RESTRICTION' });
    });

    it('denies an explicitly excluded market', () => {
        expect(MarketResolver.isMarketAllowed([{ market_id: 'X', restriction: 'EXCLUDE' }], 'X')).toBe(false);
    });

    it('allows a market when only some other market is excluded', () => {
        expect(MarketResolver.isMarketAllowed([{ market_id: 'OTHER', restriction: 'EXCLUDE' }], 'X')).toBe(true);
    });

    it('an INCLUDE row on its own never restricts other markets', () => {
        expect(MarketResolver.isMarketAllowed([{ market_id: 'OTHER', restriction: 'INCLUDE' }], 'X')).toBe(true);
    });

    it('excluding a parent excludes its children', () => {
        const r = MarketResolver.evaluate([{ market_id: 'NGA', restriction: 'EXCLUDE' }], lagos);
        expect(r).toEqual({ allowed: false, decided_by_market_id: 'NGA', reason: 'EXCLUDED' });
    });

    it('INCLUDE on a child carves it out of an excluded ancestor; nearest mapping wins', () => {
        const mappings: MarketMapping[] = [
            { market_id: 'AFR', restriction: 'EXCLUDE' },
            { market_id: 'NGA', restriction: 'INCLUDE' },
        ];
        expect(MarketResolver.evaluate(mappings, lagos).allowed).toBe(true);
        expect(MarketResolver.evaluate(mappings, ['KEN', 'AFR']).allowed).toBe(false);
    });
});

describe('charge stacking', () => {
    const c = (id: string, rule: 'ADDITIVE' | 'OVERRIDE') => ({ id, stacking_rule: rule });

    it('keeps every ADDITIVE charge in order', () => {
        expect(stackCharges([c('a', 'ADDITIVE'), c('b', 'ADDITIVE')]).map((x) => x.id)).toEqual(['a', 'b']);
    });

    it('an OVERRIDE clears everything before it', () => {
        expect(stackCharges([c('a', 'ADDITIVE'), c('b', 'ADDITIVE'), c('o', 'OVERRIDE'), c('d', 'ADDITIVE')]).map((x) => x.id)).toEqual(['o', 'd']);
    });
});

describe('policy validation', () => {
    const schema = { type: 'object', properties: { market_code: { type: 'string' } }, required: ['market_code'], additionalProperties: false };

    it('accepts a conforming rule', () => {
        expect(() => validatePolicyRule({ market_code: 'NGA' }, schema)).not.toThrow();
    });

    it.each([[{ market_code: 1 }], [{}], [{ market_code: 'NGA', extra: true }]])('rejects %j with a 422', (rule) => {
        try {
            validatePolicyRule(rule, schema);
            throw new Error('expected rejection');
        } catch (err: any) {
            expect(err.status).toBe(422);
            expect(err.message).toMatch(/Policy rule validation failed/);
        }
    });

    it('rejects an invalid JSON Schema', () => {
        expect(() => validatePolicyRule({}, { type: 'not-a-type' })).toThrow(/not a valid JSON Schema/);
    });
});

describe('codeFromName', () => {
    it('derives a stable upper-case code', () => {
        expect(codeFromName('Fibre 500 Mbps — Home')).toBe('FIBRE_500_MBPS_HOME');
        expect(codeFromName('  Café plan ')).toBe('CAFE_PLAN');
    });
    it('rejects names without letters or digits', () => {
        expect(() => codeFromName('---')).toThrow();
    });
});
