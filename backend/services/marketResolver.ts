import type { Db } from '../db/pool';

export type MarketRestriction = 'INCLUDE' | 'EXCLUDE';

export interface MarketMapping {
    market_id: string;
    restriction: MarketRestriction;
}

export interface MarketEligibility {
    allowed: boolean;
    /** The market whose mapping decided the outcome, when one did. */
    decided_by_market_id: string | null;
    reason: 'NO_RESTRICTION' | 'EXCLUDED' | 'INCLUDED_EXCEPTION';
}

/**
 * Market eligibility, per the resolved default in AGENTS.md:
 *   "no mapping row = allowed. Only EXCLUDE rows restrict."
 *
 * Markets are hierarchical, so an EXCLUDE on a market also excludes every market beneath it
 * (excluding South Africa excludes Johannesburg). An INCLUDE row never restricts anything on its
 * own; it is a carve-out that re-allows a market below an excluded ancestor
 * (exclude AFRICA, include KENYA). The mapping nearest to the target market wins.
 *
 * `ancestry` is the target market followed by its ancestors, nearest first.
 */
export class MarketResolver {
    public static evaluate(mappings: MarketMapping[], ancestry: string[]): MarketEligibility {
        if (!mappings || mappings.length === 0 || ancestry.length === 0) {
            return { allowed: true, decided_by_market_id: null, reason: 'NO_RESTRICTION' };
        }
        const byMarket = new Map(mappings.map((m) => [m.market_id, m.restriction]));
        for (const marketId of ancestry) {
            const restriction = byMarket.get(marketId);
            if (restriction === 'EXCLUDE') return { allowed: false, decided_by_market_id: marketId, reason: 'EXCLUDED' };
            if (restriction === 'INCLUDE') return { allowed: true, decided_by_market_id: marketId, reason: 'INCLUDED_EXCEPTION' };
        }
        return { allowed: true, decided_by_market_id: null, reason: 'NO_RESTRICTION' };
    }

    /** Single-market convenience form (no hierarchy). */
    public static isMarketAllowed(mappings: MarketMapping[], targetMarketId: string): boolean {
        return MarketResolver.evaluate(mappings, [targetMarketId]).allowed;
    }
}

/** The market followed by its ancestors, nearest first. Cycle-safe (see migration 020). */
export async function loadMarketAncestry(db: Db, tenantId: string, marketId: string): Promise<string[]> {
    const res = await db.query<{ market_id: string }>(
        'SELECT market_id FROM market_ancestry($1, $2) ORDER BY depth',
        [tenantId, marketId]
    );
    return res.rows.map((r) => r.market_id);
}

export async function resolve_market_eligibility(
    db: Db,
    tenantId: string,
    offeringId: string,
    marketId: string
): Promise<MarketEligibility> {
    const [mappings, ancestry] = await Promise.all([
        db.query<MarketMapping>(
            'SELECT market_id, restriction FROM offering_market_mapping WHERE tenant_id = $1 AND offering_id = $2',
            [tenantId, offeringId]
        ),
        loadMarketAncestry(db, tenantId, marketId),
    ]);
    return MarketResolver.evaluate(mappings.rows, ancestry);
}
