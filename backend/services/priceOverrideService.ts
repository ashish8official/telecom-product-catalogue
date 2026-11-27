import type { PoolClient } from 'pg';
import { conflict, notFound } from '../http/errors';

export interface PriceOverride {
    tenant_id: string;
    offering_rate_id: string;
    scope_type: 'SUBSCRIBER' | 'ACCOUNT' | 'MARKET';
    scope_reference_id: string;
    /** Decimal string (preferred, exact) or number. */
    override_amount: string | number;
    effective_from: Date;
    effective_to: Date | null;
}

/**
 * Creates a price override. Must be called inside a transaction (see withTransaction).
 *
 * The target offering_rate row is locked FOR UPDATE, which serialises every override written
 * against the same rate, so two concurrent requests cannot both pass the overlap check.
 * Overrides never touch offering_rate itself.
 */
export async function createPriceOverride(tx: PoolClient, override: PriceOverride): Promise<string> {
    const lock = await tx.query(
        'SELECT id FROM offering_rate WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [override.tenant_id, override.offering_rate_id]
    );
    if (lock.rowCount === 0) throw notFound('Offering rate', override.offering_rate_id);

    const overlap = await tx.query(
        `SELECT id FROM price_override
          WHERE tenant_id = $1
            AND offering_rate_id = $2
            AND scope_type = $3
            AND scope_reference_id = $4
            AND (effective_to IS NULL OR effective_to > $5)
            AND ($6::timestamptz IS NULL OR effective_from < $6::timestamptz)
          LIMIT 1`,
        [
            override.tenant_id,
            override.offering_rate_id,
            override.scope_type,
            override.scope_reference_id,
            override.effective_from,
            override.effective_to,
        ]
    );
    if (overlap.rowCount && overlap.rowCount > 0) {
        throw conflict('Overlapping price override detected for scope', { conflictingOverrideId: overlap.rows[0].id });
    }

    const inserted = await tx.query(
        `INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id,
                                     override_amount, effective_from, effective_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
            override.tenant_id,
            override.offering_rate_id,
            override.scope_type,
            override.scope_reference_id,
            override.override_amount,
            override.effective_from,
            override.effective_to,
        ]
    );
    return inserted.rows[0].id;
}
