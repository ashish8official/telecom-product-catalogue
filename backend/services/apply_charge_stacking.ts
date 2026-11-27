import type { Db } from '../db/pool';
import { ResolutionContext } from '../domain/ResolutionContext';

export interface ChargeSpecification {
    id: string;
    charge_code: string;
    charge_name: string;
    charge_priority: number;
    stacking_rule: 'ADDITIVE' | 'OVERRIDE';
    calculation_type: 'FLAT' | 'PERCENTAGE';
    charge_type: 'RECURRING' | 'ONE_TIME' | 'USAGE';
    charge_period: string | null;
}

/**
 * Returns the charges of an offering in deterministic evaluation order and applies stacking rules.
 *
 *   order:     charge_priority ASC, then id ASC (tie-breaker)
 *   ADDITIVE:  added to the stack
 *   OVERRIDE:  clears everything accumulated so far (all of which has lower-or-equal priority
 *              because of the ordering) and starts the stack again from this charge
 */
export async function apply_charge_stacking(db: Db, context: Pick<ResolutionContext, 'tenant_id' | 'offering_id'>): Promise<ChargeSpecification[]> {
    const res = await db.query<ChargeSpecification>(
        `SELECT cs.id, cs.charge_code, cs.charge_name, cs.charge_priority, cs.stacking_rule,
                cs.calculation_type, cs.charge_type, cs.charge_period
           FROM offering_charge_component occ
           JOIN charge_specification cs ON cs.tenant_id = occ.tenant_id AND cs.id = occ.charge_spec_id
          WHERE occ.tenant_id = $1 AND occ.offering_id = $2
          ORDER BY cs.charge_priority ASC, cs.id ASC`,
        [context.tenant_id, context.offering_id]
    );
    return stackCharges(res.rows);
}

export function stackCharges<T extends Pick<ChargeSpecification, 'stacking_rule'>>(orderedCharges: T[]): T[] {
    const stack: T[] = [];
    for (const charge of orderedCharges) {
        if (charge.stacking_rule === 'OVERRIDE') stack.length = 0;
        stack.push(charge);
    }
    return stack;
}
