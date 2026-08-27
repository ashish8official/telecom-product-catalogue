import { Client } from 'pg';

export interface PriceOverride {
    tenant_id: string;
    offering_rate_id: string;
    scope_type: 'SUBSCRIBER' | 'ACCOUNT' | 'MARKET';
    scope_reference_id: string;
    override_amount: number;
    effective_from: Date;
    effective_to: Date | null;
}

export async function createPriceOverride(client: Client, override: PriceOverride): Promise<string> {
    try {
        await client.query('BEGIN');

        // 1. Transaction Safety: Row-level lock on offering_rate
        // This serializes all overrides targeting the same offering_rate,
        // preventing concurrent requests from generating overlapping periods
        // without causing table-level lock contention.
        const lockRes = await client.query(
            `SELECT id FROM offering_rate 
             WHERE tenant_id = $1 AND id = $2 
             FOR UPDATE`,
            [override.tenant_id, override.offering_rate_id]
        );

        if (lockRes.rowCount === 0) {
            throw new Error('Offering rate not found or cross-tenant violation');
        }

        // 2. Required Service-Layer Validation: Overlap Check
        // Ensures no active overrides exist for the exact same entity within the overlapping time frame.
        const overlapRes = await client.query(
            `SELECT 1 FROM price_override
             WHERE tenant_id = $1
               AND offering_rate_id = $2
               AND scope_type = $3
               AND scope_reference_id = $4
               AND (effective_to IS NULL OR effective_to > $5)
               AND ($6::timestamptz IS NULL OR effective_from < $6::timestamptz)`,
            [
                override.tenant_id,
                override.offering_rate_id,
                override.scope_type,
                override.scope_reference_id,
                override.effective_from,
                override.effective_to
            ]
        );

        if (overlapRes.rowCount && overlapRes.rowCount > 0) {
            throw new Error('Overlapping price override detected for scope');
        }

        // 3. Persistence
        const insertRes = await client.query(
            `INSERT INTO price_override (
                tenant_id, offering_rate_id, scope_type, scope_reference_id,
                override_amount, effective_from, effective_to
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
                override.tenant_id,
                override.offering_rate_id,
                override.scope_type,
                override.scope_reference_id,
                override.override_amount,
                override.effective_from,
                override.effective_to
            ]
        );

        await client.query('COMMIT');
        return insertRes.rows[0].id;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
}
