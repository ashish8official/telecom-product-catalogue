import { Pool } from 'pg';
import { resolve_journal } from '../services/resolve_journal';

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'catalogue_db',
    password: process.env.PGPASSWORD || 'admin',
    port: parseInt(process.env.PGPORT || '5433')
});

const TENANT_ID = '18300000-0000-4000-a000-000000000000';
const CHG_SPEC_ID = '18300000-0000-4000-a000-000000000001';

beforeAll(async () => {
    await pool.query(`DELETE FROM journal_mapping WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM journal_configuration WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`INSERT INTO charge_specification (id, tenant_id, charge_code, charge_name, charge_priority, stacking_rule, calculation_type) VALUES ($1, $2, 'CHG', 'Charge', 10, 'ADDITIVE', 'FLAT') ON CONFLICT DO NOTHING`, [CHG_SPEC_ID, TENANT_ID]);
});

afterAll(async () => {
    await pool.query(`DELETE FROM journal_mapping WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM journal_configuration WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.end();
});

describe('resolve_journal', () => {
    beforeEach(async () => {
        await pool.query(`DELETE FROM journal_mapping WHERE tenant_id = $1`, [TENANT_ID]);
        await pool.query(`DELETE FROM journal_configuration WHERE tenant_id = $1`, [TENANT_ID]);
    });

    it('should return empty array if no GL mapped', async () => {
        const res = await resolve_journal(pool, TENANT_ID, CHG_SPEC_ID);
        expect(res.length).toBe(0);
    });

    it('should return mapped GL', async () => {
        const jcId = '18300000-0000-4000-a000-000000000002';
        await pool.query(`INSERT INTO journal_configuration (id, tenant_id, gl_code, gl_description) VALUES ($1, $2, '4000', 'Revenue')`, [jcId, TENANT_ID]);
        await pool.query(`INSERT INTO journal_mapping (tenant_id, charge_specification_id, journal_configuration_id) VALUES ($1, $2, $3)`, [TENANT_ID, CHG_SPEC_ID, jcId]);

        const res = await resolve_journal(pool, TENANT_ID, CHG_SPEC_ID);
        expect(res.length).toBe(1);
        expect(res[0].gl_code).toBe('4000');
    });

    it('should return multiple mapped GLs if configured', async () => {
        const jc1Id = '18300000-0000-4000-a000-000000000003';
        const jc2Id = '18300000-0000-4000-a000-000000000004';
        await pool.query(`INSERT INTO journal_configuration (id, tenant_id, gl_code, gl_description) VALUES ($1, $2, '4000', 'Rev')`, [jc1Id, TENANT_ID]);
        await pool.query(`INSERT INTO journal_configuration (id, tenant_id, gl_code, gl_description) VALUES ($1, $2, '4001', 'Def Rev')`, [jc2Id, TENANT_ID]);
        await pool.query(`INSERT INTO journal_mapping (tenant_id, charge_specification_id, journal_configuration_id) VALUES ($1, $2, $3)`, [TENANT_ID, CHG_SPEC_ID, jc1Id]);
        await pool.query(`INSERT INTO journal_mapping (tenant_id, charge_specification_id, journal_configuration_id) VALUES ($1, $2, $3)`, [TENANT_ID, CHG_SPEC_ID, jc2Id]);

        const res = await resolve_journal(pool, TENANT_ID, CHG_SPEC_ID);
        expect(res.length).toBe(2);
        const codes = res.map(r => r.gl_code).sort();
        expect(codes).toEqual(['4000', '4001']);
    });
});
