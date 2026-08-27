import { Pool } from 'pg';
import { apply_charge_stacking } from '../services/apply_charge_stacking';

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'catalogue_db',
    password: process.env.PGPASSWORD || 'admin',
    port: parseInt(process.env.PGPORT || '5433')
});

const TENANT_ID = '18100000-0000-4000-a000-000000000000';
const OFFERING_STACK_ID = '18100000-0000-4000-a000-000000000001';

beforeAll(async () => {
    await pool.query(`DELETE FROM offering_charge_component WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM charge_specification WHERE tenant_id = $1`, [TENANT_ID]);

    const CAT_VER = '18100000-0000-4000-a000-000000000008';
    const SPEC_ID = '18100000-0000-4000-a000-000000000009';
    await pool.query(`INSERT INTO catalogue (id, tenant_id, name) VALUES ('18100000-0000-4000-a000-000000000010', $1, 'Test Cat') ON CONFLICT DO NOTHING`, [TENANT_ID]);
    await pool.query(`INSERT INTO catalogue_version (id, tenant_id, catalogue_id, version, status, valid_from) VALUES ($1, $2, '18100000-0000-4000-a000-000000000010', 'v1', 'RELEASED', NOW()) ON CONFLICT DO NOTHING`, [CAT_VER, TENANT_ID]);
    await pool.query(`INSERT INTO product_specification (id, tenant_id, spec_code, spec_name) VALUES ($1, $2, 'SPEC', 'Spec') ON CONFLICT DO NOTHING`, [SPEC_ID, TENANT_ID]);
    await pool.query(`INSERT INTO product_offering (id, tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type) VALUES ($1, $2, $3, $4, 'OFF_STACK', 'Off Stack', 'BASE', 'PREPAID') ON CONFLICT DO NOTHING`, [OFFERING_STACK_ID, TENANT_ID, CAT_VER, SPEC_ID]);

    const charges = [
        { id: '18100000-0000-4000-a000-000000000002', code: 'C_LOW', prio: 50, rule: 'ADDITIVE' },
        { id: '18100000-0000-4000-a000-000000000003', code: 'C_HIGH', prio: 10, rule: 'ADDITIVE' },
        { id: '18100000-0000-4000-a000-000000000004', code: 'C_TIE_1', prio: 30, rule: 'ADDITIVE' },
        { id: '18100000-0000-4000-a000-000000000005', code: 'C_TIE_2', prio: 30, rule: 'ADDITIVE' },
        { id: '18100000-0000-4000-a000-000000000006', code: 'C_OVERRIDE', prio: 40, rule: 'OVERRIDE' },
    ];

    for (const c of charges) {
        await pool.query(`
            INSERT INTO charge_specification (id, tenant_id, charge_code, charge_name, charge_priority, stacking_rule, calculation_type)
            VALUES ($1, $2, $3, $4, $5, $6, 'FLAT')
        `, [c.id, TENANT_ID, c.code, c.code, c.prio, c.rule]);
    }
});

afterAll(async () => {
    await pool.query(`DELETE FROM offering_charge_component WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM charge_specification WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.end();
});

describe('apply_charge_stacking', () => {
    beforeEach(async () => {
        await pool.query(`DELETE FROM offering_charge_component WHERE tenant_id = $1`, [TENANT_ID]);
    });

    it('should sort charges by priority ASC', async () => {
        await pool.query(`INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES ($1, $2, '18100000-0000-4000-a000-000000000002')`, [TENANT_ID, OFFERING_STACK_ID]); // 50
        await pool.query(`INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES ($1, $2, '18100000-0000-4000-a000-000000000003')`, [TENANT_ID, OFFERING_STACK_ID]); // 10

        const res = await apply_charge_stacking(pool, { tenant_id: TENANT_ID, offering_id: OFFERING_STACK_ID, effective_at: new Date() });
        expect(res.length).toBe(2);
        expect(res[0].charge_code).toBe('C_HIGH'); // Priority 10
        expect(res[1].charge_code).toBe('C_LOW'); // Priority 50
    });

    it('should deterministically tie-break using charge_specification_id ASC', async () => {
        // C_TIE_1 and C_TIE_2 both have priority 30.
        // ID 00000004 vs 00000005. 0004 should be first.
        await pool.query(`INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES ($1, $2, '18100000-0000-4000-a000-000000000005')`, [TENANT_ID, OFFERING_STACK_ID]);
        await pool.query(`INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES ($1, $2, '18100000-0000-4000-a000-000000000004')`, [TENANT_ID, OFFERING_STACK_ID]);

        const res = await apply_charge_stacking(pool, { tenant_id: TENANT_ID, offering_id: OFFERING_STACK_ID, effective_at: new Date() });
        expect(res.length).toBe(2);
        expect(res[0].charge_code).toBe('C_TIE_1');
        expect(res[1].charge_code).toBe('C_TIE_2');
    });

    it('should clear stack if an OVERRIDE charge is encountered', async () => {
        // C_HIGH (10), C_OVERRIDE (40), C_LOW (50)
        // Output should just be C_OVERRIDE and C_LOW, because OVERRIDE clears anything processed before it (lower priority number).
        await pool.query(`INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES ($1, $2, '18100000-0000-4000-a000-000000000002')`, [TENANT_ID, OFFERING_STACK_ID]);
        await pool.query(`INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES ($1, $2, '18100000-0000-4000-a000-000000000003')`, [TENANT_ID, OFFERING_STACK_ID]);
        await pool.query(`INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES ($1, $2, '18100000-0000-4000-a000-000000000006')`, [TENANT_ID, OFFERING_STACK_ID]);

        const res = await apply_charge_stacking(pool, { tenant_id: TENANT_ID, offering_id: OFFERING_STACK_ID, effective_at: new Date() });
        expect(res.length).toBe(2);
        expect(res[0].charge_code).toBe('C_OVERRIDE');
        expect(res[1].charge_code).toBe('C_LOW');
    });
});
