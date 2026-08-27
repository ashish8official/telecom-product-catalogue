import { MarketResolver, MarketMapping } from '../services/marketResolver';

describe('MarketResolver', () => {
    const TARGET_MARKET = 'mkt_123';
    const OTHER_MARKET = 'mkt_999';

    it('should ALLOW the market when no mapping rows exist (absence = allowed)', () => {
        const mappings: MarketMapping[] = [];
        const result = MarketResolver.isMarketAllowed(mappings, TARGET_MARKET);
        expect(result).toBe(true);
    });

    it('should DENY the market when explicitly marked as EXCLUDE', () => {
        const mappings: MarketMapping[] = [
            { market_id: TARGET_MARKET, restriction: 'EXCLUDE' }
        ];
        const result = MarketResolver.isMarketAllowed(mappings, TARGET_MARKET);
        expect(result).toBe(false);
    });

    it('should ALLOW the market when it is absent, but another market is EXCLUDED', () => {
        // "I want to exclude NY, but everywhere else is fine" -> Target Market is fine
        const mappings: MarketMapping[] = [
            { market_id: OTHER_MARKET, restriction: 'EXCLUDE' }
        ];
        const result = MarketResolver.isMarketAllowed(mappings, TARGET_MARKET);
        expect(result).toBe(true);
    });

    it('should ALLOW the market when explicitly marked as INCLUDE', () => {
        const mappings: MarketMapping[] = [
            { market_id: TARGET_MARKET, restriction: 'INCLUDE' }
        ];
        const result = MarketResolver.isMarketAllowed(mappings, TARGET_MARKET);
        expect(result).toBe(true);
    });

    it('should DENY the market when it is absent, but another market is INCLUDED', () => {
        // "I want to explicitly include ONLY NY" -> Target Market is denied
        const mappings: MarketMapping[] = [
            { market_id: OTHER_MARKET, restriction: 'INCLUDE' }
        ];
        const result = MarketResolver.isMarketAllowed(mappings, TARGET_MARKET);
        expect(result).toBe(false);
    });
});
