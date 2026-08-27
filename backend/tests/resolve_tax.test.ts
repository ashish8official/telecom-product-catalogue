import { Pool } from 'pg';
import { resolve_tax } from '../services/resolve_tax';

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'catalogue_db',
    password: process.env.PGPASSWORD || 'admin',
    port: parseInt(process.env.PGPORT || '5433')
});

const TENANT_ID = '18200000-0000-4000-a000-000000000000';
const CHG_SPEC_ID = '18200000-0000-4000-a000-000000000001';
const MKT_PARENT = '18200000-0000-4000-a000-000000000002';
const MKT_CHILD = '18200000-0000-4000-a000-000000000003';
const MKT_OTHER = '18200000-0000-4000-a000-000000000004';

beforeAll(async () => {
    await pool.query(`DELETE FROM tax_mapping WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM tax_configuration WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM market_master WHERE tenant_id = $1`, [TENANT_ID]);

    await pool.query(`INSERT INTO market_master (id, tenant_id, market_code, market_name, timezone, default_currency_code) VALUES ($1, $2, 'PARENT', 'Parent', 'Europe/London', 'USD')`, [MKT_PARENT, TENANT_ID]);
    await pool.query(`INSERT INTO market_master (id, tenant_id, market_code, market_name, timezone, default_currency_code, parent_market_id) VALUES ($1, $2, 'CHILD', 'Child', 'Europe/London', 'USD', $3)`, [MKT_CHILD, TENANT_ID, MKT_PARENT]);
    await pool.query(`INSERT INTO market_master (id, tenant_id, market_code, market_name, timezone, default_currency_code) VALUES ($1, $2, 'OTHER', 'Other', 'Europe/London', 'USD')`, [MKT_OTHER, TENANT_ID]);
    await pool.query(`INSERT INTO charge_specification (id, tenant_id, charge_code, charge_name, charge_priority, stacking_rule, calculation_type) VALUES ($1, $2, 'CHG', 'Charge', 10, 'ADDITIVE', 'FLAT') ON CONFLICT DO NOTHING`, [CHG_SPEC_ID, TENANT_ID]);
});

afterAll(async () => {
    await pool.query(`DELETE FROM tax_mapping WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM tax_configuration WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM market_master WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.end();
});

describe('resolve_tax', () => {
    beforeEach(async () => {
        await pool.query(`DELETE FROM tax_mapping WHERE tenant_id = $1`, [TENANT_ID]);
        await pool.query(`DELETE FROM tax_configuration WHERE tenant_id = $1`, [TENANT_ID]);
    });

    it('should return empty array if no tax mapped', async () => {
        const res = await resolve_tax(pool, TENANT_ID, CHG_SPEC_ID, MKT_CHILD);
        expect(res.length).toBe(0);
    });

    it('should return specific market tax', async () => {
        const tcId = '18200000-0000-4000-a000-000000000005';
        await pool.query(`INSERT INTO tax_configuration (id, tenant_id, tax_name, tax_rate, market_master_id) VALUES ($1, $2, 'Child Tax', 5.0, $3)`, [tcId, TENANT_ID, MKT_CHILD]);
        await pool.query(`INSERT INTO tax_mapping (tenant_id, charge_specification_id, tax_configuration_id) VALUES ($1, $2, $3)`, [TENANT_ID, CHG_SPEC_ID, tcId]);

        const res = await resolve_tax(pool, TENANT_ID, CHG_SPEC_ID, MKT_CHILD);
        expect(res.length).toBe(1);
        expect(res[0].fallback_level).toBe('SPECIFIC_MARKET');
        expect(res[0].tax_rate).toBe(5.0);
    });

    it('should fallback to parent market tax if supported', async () => {
        const tcId = '18200000-0000-4000-a000-000000000006';
        await pool.query(`INSERT INTO tax_configuration (id, tenant_id, tax_name, tax_rate, market_master_id) VALUES ($1, $2, 'Parent Tax', 10.0, $3)`, [tcId, TENANT_ID, MKT_PARENT]);
        await pool.query(`INSERT INTO tax_mapping (tenant_id, charge_specification_id, tax_configuration_id) VALUES ($1, $2, $3)`, [TENANT_ID, CHG_SPEC_ID, tcId]);

        // Requesting for CHILD, but only PARENT has a tax
        const res = await resolve_tax(pool, TENANT_ID, CHG_SPEC_ID, MKT_CHILD);
        expect(res.length).toBe(1);
        expect(res[0].fallback_level).toBe('PARENT_MARKET');
        expect(res[0].tax_rate).toBe(10.0);
    });

    it('should fallback to generic tax (no market)', async () => {
        const tcId = '18200000-0000-4000-a000-000000000007';
        await pool.query(`INSERT INTO tax_configuration (id, tenant_id, tax_name, tax_rate) VALUES ($1, $2, 'Generic Tax', 15.0)`, [tcId, TENANT_ID]);
        await pool.query(`INSERT INTO tax_mapping (tenant_id, charge_specification_id, tax_configuration_id) VALUES ($1, $2, $3)`, [TENANT_ID, CHG_SPEC_ID, tcId]);

        const res = await resolve_tax(pool, TENANT_ID, CHG_SPEC_ID, MKT_CHILD);
        expect(res.length).toBe(1);
        expect(res[0].fallback_level).toBe('GENERIC');
        expect(res[0].tax_rate).toBe(15.0);
    });

    it('should not return tax if market is explicitly different and no parent/generic matches', async () => {
        const tcId = '18200000-0000-4000-a000-000000000008';
        await pool.query(`INSERT INTO tax_configuration (id, tenant_id, tax_name, tax_rate, market_master_id) VALUES ($1, $2, 'Other Tax', 20.0, $3)`, [tcId, TENANT_ID, MKT_OTHER]);
        await pool.query(`INSERT INTO tax_mapping (tenant_id, charge_specification_id, tax_configuration_id) VALUES ($1, $2, $3)`, [TENANT_ID, CHG_SPEC_ID, tcId]);

        const res = await resolve_tax(pool, TENANT_ID, CHG_SPEC_ID, MKT_CHILD);
        expect(res.length).toBe(0);
    });
});
