import type { Db } from '../db/pool';
import { loadMarketAncestry } from './marketResolver';

export interface TaxResult {
    tax_config_id: string;
    tax_name: string;
    tax_rate: number;
    market_id: string | null;
    fallback_level: 'SPECIFIC_MARKET' | 'PARENT_MARKET' | 'GENERIC';
}

/**
 * Taxes that apply to a charge in a market.
 *
 * A tax configured for the exact market applies (SPECIFIC_MARKET); a tax configured for an
 * ancestor applies to every market beneath it (PARENT_MARKET); a tax with no market applies
 * everywhere (GENERIC). Multiple matching taxes all apply (e.g. federal + state). The market tree
 * is walked with market_ancestry(), which is a single cycle-safe query.
 */
export async function resolve_tax(db: Db, tenant_id: string, charge_spec_id: string, market_id?: string): Promise<TaxResult[]> {
    const res = await db.query(
        `SELECT tc.id, tc.tax_name, tc.tax_rate, tc.market_master_id
           FROM tax_mapping tm
           JOIN tax_configuration tc ON tc.tenant_id = tm.tenant_id AND tc.id = tm.tax_configuration_id
          WHERE tm.tenant_id = $1 AND tm.charge_specification_id = $2
          ORDER BY tc.tax_name, tc.id`,
        [tenant_id, charge_spec_id]
    );
    if (res.rows.length === 0) return [];

    const ancestry = market_id ? await loadMarketAncestry(db, tenant_id, market_id) : [];

    const taxes: TaxResult[] = [];
    for (const row of res.rows) {
        const base = {
            tax_config_id: row.id,
            tax_name: row.tax_name,
            tax_rate: Number(row.tax_rate),
            market_id: row.market_master_id,
        };
        if (!row.market_master_id) {
            taxes.push({ ...base, fallback_level: 'GENERIC' });
            continue;
        }
        const depth = ancestry.indexOf(row.market_master_id);
        if (depth === 0) taxes.push({ ...base, fallback_level: 'SPECIFIC_MARKET' });
        else if (depth > 0) taxes.push({ ...base, fallback_level: 'PARENT_MARKET' });
    }
    return taxes;
}
