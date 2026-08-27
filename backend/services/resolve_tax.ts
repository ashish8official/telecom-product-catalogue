import { Pool } from 'pg';

export interface TaxResult {
    tax_config_id: string;
    tax_name: string;
    tax_rate: number;
    fallback_level: string;
}

export async function resolve_tax(
    pool: Pool,
    tenant_id: string,
    charge_spec_id: string,
    market_id?: string
): Promise<TaxResult[]> {
    // 1. Fetch mapped taxes for this charge spec
    const query = `
        SELECT tc.id, tc.tax_name, tc.tax_rate, tc.market_master_id
        FROM tax_mapping tm
        JOIN tax_configuration tc ON tm.tax_configuration_id = tc.id
        WHERE tm.tenant_id = $1 AND tm.charge_specification_id = $2
    `;
    const res = await pool.query(query, [tenant_id, charge_spec_id]);
    const mappings = res.rows;

    if (mappings.length === 0) {
        return [];
    }

    // 2. We need the market hierarchy if a market_id is provided
    let hierarchy: string[] = [];
    if (market_id) {
        let current_market_id: string | null = market_id;
        while (current_market_id) {
            hierarchy.push(current_market_id);
            const parentResult: any = await pool.query(`SELECT parent_market_id FROM market_master WHERE id = $1 AND tenant_id = $2`, [current_market_id, tenant_id]);
            if (parentResult.rows.length > 0 && parentResult.rows[0].parent_market_id) {
                current_market_id = parentResult.rows[0].parent_market_id;
            } else {
                current_market_id = null;
            }
        }
    }

    const finalTaxes: TaxResult[] = [];

    // 3. For each mapped tax, determine if it applies
    for (const mapping of mappings) {
        if (!mapping.market_master_id) {
            // Generic/Default Tax (applies to all markets)
            finalTaxes.push({
                tax_config_id: mapping.id,
                tax_name: mapping.tax_name,
                tax_rate: parseFloat(mapping.tax_rate),
                fallback_level: 'GENERIC'
            });
            continue;
        }

        if (market_id && hierarchy.length > 0) {
            // Find if mapping's market is in our hierarchy
            const idx = hierarchy.indexOf(mapping.market_master_id);
            if (idx !== -1) {
                finalTaxes.push({
                    tax_config_id: mapping.id,
                    tax_name: mapping.tax_name,
                    tax_rate: parseFloat(mapping.tax_rate),
                    fallback_level: idx === 0 ? 'SPECIFIC_MARKET' : 'PARENT_MARKET'
                });
            }
        }
    }

    return finalTaxes;
}
