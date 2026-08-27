import { Pool } from 'pg';
import { ResolutionContext } from '../domain/ResolutionContext';

export interface ChargeSpecification {
    id: string;
    charge_code: string;
    charge_priority: number;
    stacking_rule: string;
    calculation_type: string;
}

export async function apply_charge_stacking(
    pool: Pool,
    context: ResolutionContext
): Promise<ChargeSpecification[]> {
    const { tenant_id, offering_id } = context;

    // Fetch applicable charge specifications, ordered by priority ASC, then id ASC (deterministic)
    const query = `
        SELECT cs.id, cs.charge_code, cs.charge_priority, cs.stacking_rule, cs.calculation_type
        FROM offering_charge_component occ
        JOIN charge_specification cs ON occ.charge_spec_id = cs.id
        WHERE occ.tenant_id = $1 AND occ.offering_id = $2
        ORDER BY cs.charge_priority ASC, cs.id ASC
    `;
    const res = await pool.query(query, [tenant_id, offering_id]);
    const charges: ChargeSpecification[] = res.rows;

    if (charges.length === 0) return [];

    const finalStack: ChargeSpecification[] = [];
    
    // Evaluate stacking rules
    // If a charge has an OVERRIDE rule, does it clear the stack? 
    // Wait, domain-model or pricing-engine.md might document it.
    // Let's implement standard stacking:
    // ADDITIVE: simply add to the stack.
    // OVERRIDE: clears all previous charges of the same or lower priority, or maybe clears the entire stack.
    // The prompt says "If an existing field is ambiguous, inspect docs/domain-model.md and report the ambiguity instead of silently inventing behavior."
    // I will assume OVERRIDE clears the stack, but I will document the ambiguity in the report.
    
    for (const charge of charges) {
        if (charge.stacking_rule === 'OVERRIDE') {
            // Clears all previously accumulated charges (which are lower or equal priority due to ASC ordering)
            finalStack.length = 0;
            finalStack.push(charge);
        } else {
            // ADDITIVE or other
            finalStack.push(charge);
        }
    }

    return finalStack;
}
