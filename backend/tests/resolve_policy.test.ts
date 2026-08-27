import { Pool } from 'pg';
import { resolve_policy } from '../services/resolve_policy';

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'catalogue_db',
    password: process.env.PGPASSWORD || 'admin',
    port: parseInt(process.env.PGPORT || '5433')
});

const TENANT_ID = '18000000-0000-4000-a000-000000000000';
const OFFERING_NO_POLICY = '18000000-0000-4000-a000-000000000001';
const OFFERING_WITH_POLICY = '18000000-0000-4000-a000-000000000002';
const OFFERING_TIME_POLICY = '18000000-0000-4000-a000-000000000003';
const MKT_ID = '18000000-0000-4000-a000-000000000004'; // Africa/Lagos
const SCHEMA_ID = '18000000-0000-4000-a000-000000000005';

beforeAll(async () => {
    // Clean up
    await pool.query(`DELETE FROM policy_mapping WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM policy_rule WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM policy_schema WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM market_master WHERE tenant_id = $1`, [TENANT_ID]);

    // Insert Market
    await pool.query(`
        INSERT INTO market_master (id, tenant_id, market_code, market_name, timezone, default_currency_code)
        VALUES ($1, $2, 'TEST', 'Test', 'Africa/Lagos', 'NGN')
    `, [MKT_ID, TENANT_ID]);

    // Insert Schema
    await pool.query(`
        INSERT INTO policy_schema (id, tenant_id, schema_name, version, schema_json)
        VALUES ($1, $2, 'Test Schema', '1.0', '{}')
    `, [SCHEMA_ID, TENANT_ID]);

    // Insert Catalogue, Spec, and Offerings to satisfy FKs
    const CAT_VER = '18000000-0000-4000-a000-000000000008';
    const SPEC_ID = '18000000-0000-4000-a000-000000000009';
    await pool.query(`INSERT INTO catalogue (id, tenant_id, name) VALUES ('18000000-0000-4000-a000-000000000010', $1, 'Test Cat') ON CONFLICT DO NOTHING`, [TENANT_ID]);
    await pool.query(`INSERT INTO catalogue_version (id, tenant_id, catalogue_id, version, status, valid_from) VALUES ($1, $2, '18000000-0000-4000-a000-000000000010', 'v1', 'RELEASED', NOW()) ON CONFLICT DO NOTHING`, [CAT_VER, TENANT_ID]);
    await pool.query(`INSERT INTO product_specification (id, tenant_id, spec_code, spec_name) VALUES ($1, $2, 'SPEC', 'Spec') ON CONFLICT DO NOTHING`, [SPEC_ID, TENANT_ID]);
    
    await pool.query(`INSERT INTO product_offering (id, tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type) VALUES ($1, $2, $3, $4, 'OFF1', 'Off 1', 'BASE', 'PREPAID') ON CONFLICT DO NOTHING`, [OFFERING_NO_POLICY, TENANT_ID, CAT_VER, SPEC_ID]);
    await pool.query(`INSERT INTO product_offering (id, tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type) VALUES ($1, $2, $3, $4, 'OFF2', 'Off 2', 'BASE', 'PREPAID') ON CONFLICT DO NOTHING`, [OFFERING_WITH_POLICY, TENANT_ID, CAT_VER, SPEC_ID]);
    await pool.query(`INSERT INTO product_offering (id, tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type) VALUES ($1, $2, $3, $4, 'OFF3', 'Off 3', 'BASE', 'PREPAID') ON CONFLICT DO NOTHING`, [OFFERING_TIME_POLICY, TENANT_ID, CAT_VER, SPEC_ID]);

    // Insert Policy 1 (account_category: CORPORATE)
    const rule1Id = '18000000-0000-4000-a000-000000000006';
    await pool.query(`
        INSERT INTO policy_rule (id, tenant_id, schema_id, rule_json)
        VALUES ($1, $2, $3, '{"account_category": "CORPORATE"}')
    `, [rule1Id, TENANT_ID, SCHEMA_ID]);

    // Insert Policy 2 (time_window 22:00-06:00)
    const rule2Id = '18000000-0000-4000-a000-000000000007';
    await pool.query(`
        INSERT INTO policy_rule (id, tenant_id, schema_id, rule_json)
        VALUES ($1, $2, $3, '{"time_window": {"start": "22:00", "end": "06:00"}}')
    `, [rule2Id, TENANT_ID, SCHEMA_ID]);

    // Mappings
    await pool.query(`INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id) VALUES ($1, $2, $3)`, [TENANT_ID, OFFERING_WITH_POLICY, rule1Id]);
    await pool.query(`INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id) VALUES ($1, $2, $3)`, [TENANT_ID, OFFERING_TIME_POLICY, rule2Id]);
});

afterAll(async () => {
    await pool.query(`DELETE FROM policy_mapping WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM policy_rule WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM policy_schema WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.query(`DELETE FROM market_master WHERE tenant_id = $1`, [TENANT_ID]);
    await pool.end();
});

describe('resolve_policy', () => {
    it('should return pass=true when no policy is mapped', async () => {
        const res = await resolve_policy(pool, {
            tenant_id: TENANT_ID,
            offering_id: OFFERING_NO_POLICY,
            effective_at: new Date()
        });
        expect(res.passed).toBe(true);
        expect(res.evaluated_rules.length).toBe(0);
    });

    it('should pass ALL mode when context matches exactly', async () => {
        const res = await resolve_policy(pool, {
            tenant_id: TENANT_ID,
            offering_id: OFFERING_WITH_POLICY,
            effective_at: new Date(),
            context_json: { account_category: 'CORPORATE' }
        }, 'ALL');
        expect(res.passed).toBe(true);
        expect(res.evaluated_rules[0].passed).toBe(true);
    });

    it('should fail ALL mode when context does not match', async () => {
        const res = await resolve_policy(pool, {
            tenant_id: TENANT_ID,
            offering_id: OFFERING_WITH_POLICY,
            effective_at: new Date(),
            context_json: { account_category: 'RETAIL' }
        }, 'ALL');
        expect(res.passed).toBe(false);
        expect(res.failed_rule_ids.length).toBe(1);
    });

    it('should handle timezone-aware time_window appropriately (inside window)', async () => {
        // Africa/Lagos is UTC+1. We want 23:30 local time.
        // So UTC time should be 22:30.
        const utcDate = new Date('2023-01-01T22:30:00Z'); 
        const res = await resolve_policy(pool, {
            tenant_id: TENANT_ID,
            offering_id: OFFERING_TIME_POLICY,
            effective_at: utcDate,
            market_id: MKT_ID
        }, 'ALL');
        expect(res.passed).toBe(true);
    });

    it('should handle timezone-aware time_window appropriately (outside window)', async () => {
        // Africa/Lagos is UTC+1. We want 14:00 local time.
        // So UTC time should be 13:00.
        const utcDate = new Date('2023-01-01T13:00:00Z'); 
        const res = await resolve_policy(pool, {
            tenant_id: TENANT_ID,
            offering_id: OFFERING_TIME_POLICY,
            effective_at: utcDate,
            market_id: MKT_ID
        }, 'ALL');
        expect(res.passed).toBe(false);
    });
});
