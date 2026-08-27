export interface MarketMapping {
    market_id: string;
    restriction: 'INCLUDE' | 'EXCLUDE';
}

/**
 * Resolves if a specific market is allowed for an offering based on its mappings.
 * Rule: Absence of a row = allowed. Only write EXCLUDE rows to restrict.
 */
export class MarketResolver {
    public static isMarketAllowed(
        mappings: MarketMapping[], 
        targetMarketId: string
    ): boolean {
        // Absence of any rows = universally allowed
        if (!mappings || mappings.length === 0) {
            return true;
        }

        // Look for the specific market mapping
        const specificMapping = mappings.find(m => m.market_id === targetMarketId);

        if (specificMapping) {
            return specificMapping.restriction === 'INCLUDE';
        }

        // If the market is not explicitly mapped, check the general restriction pattern.
        // If there are ONLY EXCLUDE rows, the absence of this market means it's ALLOWED.
        // (Because EXCLUDE means "allowed everywhere EXCEPT here")
        const hasOnlyExcludes = mappings.every(m => m.restriction === 'EXCLUDE');
        if (hasOnlyExcludes) {
            return true;
        }

        // If there are INCLUDE rows, the absence of this market means it's DENIED.
        // (Because INCLUDE means "denied everywhere EXCEPT here")
        const hasIncludes = mappings.some(m => m.restriction === 'INCLUDE');
        if (hasIncludes) {
            return false;
        }

        // Fallback default
        return true;
    }
}
