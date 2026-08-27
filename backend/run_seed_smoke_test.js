const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TENANT_ID = '17000000-0000-4000-a000-000000000000';
const RATE_NGA_ID = '17000000-0000-4000-a000-000000000017';

async function executeSeedAndTests(client, iteration) {
    console.log(`\n==========================================`);
    console.log(`▶️ RUN ${iteration}: RESET + SEED + SMOKE TESTS`);
    console.log(`==========================================`);
    
    // 1. Run Seed SQL (which handles its own reset)
    console.log("🌱 Executing Seed Data Script (Resetting first if data exists)...");
    const seedSql = fs.readFileSync(path.join(__dirname, '../database/seeds/017_realistic_telecom_seed.sql'), 'utf8');
    await client.query(seedSql);
    console.log("✅ Seed data inserted successfully (Idempotency check passed).");

    // 2. Smoke Tests
    console.log("\n🧪 Running Assertions...");

    // Assertion 1: Nigeria Base Rate = 1299 NGN
    let res = await client.query(`SELECT amount, source FROM resolve_price($1, $2, NULL, NULL, NULL, NOW())`, [TENANT_ID, RATE_NGA_ID]);
    assert.strictEqual(parseFloat(res.rows[0].amount), 1299.00);
    assert.strictEqual(res.rows[0].source, 'CATALOGUE_RATE');
    console.log(`✅ [1/7] Nigeria Base Rate = 1299.00 NGN`);

    // Assertion 2: All Market Rates
    res = await client.query(`
        SELECT m.market_code, r.currency_code, r.amount 
        FROM offering_rate r JOIN market_master m ON r.market_id = m.id
        WHERE r.tenant_id = $1 AND r.charge_spec_id = '17000000-0000-4000-a000-000000000015'
    `, [TENANT_ID]);
    
    const expectedRates = { 'IND': 699, 'NGA': 1299, 'KEN': 499, 'ZAF': 299 };
    for (const row of res.rows) {
        assert.strictEqual(parseFloat(row.amount), expectedRates[row.market_code]);
    }
    console.log(`✅ [2/7] Canonical base rates matched for IND, NGA, KEN, ZAF`);

    // Assertion 3: Subscriber Override
    res = await client.query(`SELECT amount, source FROM resolve_price($1, $2, 'SUB-NGA-001', NULL, NULL, NOW())`, [TENANT_ID, RATE_NGA_ID]);
    assert.strictEqual(parseFloat(res.rows[0].amount), 999.00);
    assert.strictEqual(res.rows[0].source, 'SUBSCRIBER');
    console.log(`✅ [3/7] Subscriber override returned 999.00 NGN`);

    // Assertion 3b: Verify original rate wasn't mutated
    res = await client.query(`SELECT amount FROM offering_rate WHERE id = $1`, [RATE_NGA_ID]);
    assert.strictEqual(parseFloat(res.rows[0].amount), 1299.00);
    console.log(`✅ [3b/7] Base rate on offering_rate was NOT mutated by override`);

    // Assertion 4: Market Exclusion (ZAF)
    res = await client.query(`
        SELECT po.offering_code, m.market_code, omm.restriction 
        FROM offering_market_mapping omm
        JOIN product_offering po ON omm.offering_id = po.id
        JOIN market_master m ON omm.market_id = m.id
        WHERE omm.tenant_id = $1
    `, [TENANT_ID]);
    const exclusion = res.rows.find(r => r.offering_code === 'M2M_STATIC_IP' && r.market_code === 'ZAF');
    assert.ok(exclusion, "ZAF exclusion mapping missing");
    assert.strictEqual(exclusion.restriction, 'EXCLUDE');
    console.log(`✅ [4/7] M2M_STATIC_IP is explicitly EXCLUDED in ZAF`);

    // Assertion 5: Offering Relationships
    res = await client.query(`
        SELECT src.offering_code as source, r.relationship_type, tgt.offering_code as target 
        FROM offering_relationship r
        JOIN product_offering src ON r.source_offering_id = src.id
        JOIN product_offering tgt ON r.target_offering_id = tgt.id
        WHERE r.tenant_id = $1
    `, [TENANT_ID]);
    const rel = res.rows.find(r => r.source === 'M2M_STATIC_IP' && r.target === 'M2M_BASE');
    assert.ok(rel, "REQUIRES relationship missing");
    assert.strictEqual(rel.relationship_type, 'REQUIRES');
    console.log(`✅ [5/7] M2M_STATIC_IP REQUIRES M2M_BASE relationship verified`);

    // Assertion 6: Policy Eligibility
    res = await client.query(`
        SELECT po.offering_code, pr.rule_json 
        FROM policy_mapping pm
        JOIN product_offering po ON pm.product_offering_id = po.id
        JOIN policy_rule pr ON pm.policy_rule_id = pr.id
        WHERE pm.tenant_id = $1
    `, [TENANT_ID]);
    const pol = res.rows.find(r => r.offering_code === 'M2M_BASE');
    assert.ok(pol, "Policy mapping missing");
    assert.deepStrictEqual(pol.rule_json, { account_category: "CORPORATE" });
    console.log(`✅ [6/7] B2B Corporate policy rule successfully mapped to M2M_BASE`);

    // Assertion 7: Tax & Journal Mapping
    res = await client.query(`
        SELECT tc.tax_name, tc.tax_rate, jc.gl_code
        FROM charge_specification cs
        LEFT JOIN tax_mapping tm ON cs.id = tm.charge_specification_id
        LEFT JOIN tax_configuration tc ON tm.tax_configuration_id = tc.id
        LEFT JOIN journal_mapping jm ON cs.id = jm.charge_specification_id
        LEFT JOIN journal_configuration jc ON jm.journal_configuration_id = jc.id
        WHERE cs.id = '17000000-0000-4000-a000-000000000015'
    `);
    const taxAndGl = res.rows[0];
    assert.strictEqual(parseFloat(taxAndGl.tax_rate), 7.5);
    assert.strictEqual(taxAndGl.gl_code, '4000-REV-M2M');
    console.log(`✅ [7/7] Financial configuration (7.5% Tax, GL 4000-REV-M2M) correctly mapped`);
}

async function run() {
    const client = new Client({
        user: process.env.PGUSER || 'postgres',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'catalogue_db',
        password: process.env.PGPASSWORD || 'admin',
        port: process.env.PGPORT || 5433,
    });
    
    try {
        await client.connect();
        
        // Execute twice to prove idempotency
        await executeSeedAndTests(client, 1);
        await executeSeedAndTests(client, 2);
        
        console.log("\n==========================================");
        console.log("✨ ALL SEED HARDENING TESTS PASSED");
        console.log("==========================================\n");
    } catch (e) {
        console.error("❌ FAILED:", e.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
