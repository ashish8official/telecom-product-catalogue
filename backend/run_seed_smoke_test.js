const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const TENANT_ID = '17000000-0000-4000-a000-000000000000';
const RATE_NGA_ID = '17000000-0000-4000-a000-000000000017';

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
        console.log("==========================================");
        console.log("🔌 Connected to PostgreSQL DB");
        
        // 1. Run Seed SQL
        console.log("🌱 Executing Seed Data Script...");
        const seedSql = fs.readFileSync(path.join(__dirname, '../database/seeds/017_realistic_telecom_seed.sql'), 'utf8');
        await client.query(seedSql);
        console.log("✅ Seed data inserted successfully.\n");
        
        console.log("==========================================");
        console.log("🧪 SMOKE TESTS RESULTS");
        console.log("==========================================\n");

        // Smoke Test 1: Base Rate (Nigeria)
        let res = await client.query(`SELECT amount, source FROM resolve_price($1, $2, NULL, NULL, NULL, NOW())`, [TENANT_ID, RATE_NGA_ID]);
        console.log(`1. 🇳🇬 Base Rate (Nigeria):\n   Result: ${res.rows[0].amount} NGN (Source: ${res.rows[0].source})`);
        
        // Smoke Test 2: Market-specific rates for the charge specification
        console.log(`\n2. 🌍 Market-Specific Rates for Charge 'RC_M2M_MONTHLY':`);
        res = await client.query(`
            SELECT m.market_code, r.currency_code, r.amount 
            FROM offering_rate r
            JOIN market_master m ON r.market_id = m.id
            WHERE r.tenant_id = $1 AND r.charge_spec_id = '17000000-0000-4000-a000-000000000015'
            ORDER BY r.amount DESC
        `, [TENANT_ID]);
        res.rows.forEach(r => console.log(`   - ${r.market_code}: ${r.amount} ${r.currency_code}`));

        // Smoke Test 3: Subscriber Override
        res = await client.query(`SELECT amount, source FROM resolve_price($1, $2, 'SUB-NGA-001', NULL, NULL, NOW())`, [TENANT_ID, RATE_NGA_ID]);
        console.log(`\n3. 👤 Subscriber Override (SUB-NGA-001):\n   Result: ${res.rows[0].amount} NGN (Source: ${res.rows[0].source})`);

        // Smoke Test 4: Market exclusion
        console.log(`\n4. 🚫 Market Exclusion:`);
        res = await client.query(`
            SELECT po.offering_code, m.market_name, omm.restriction 
            FROM offering_market_mapping omm
            JOIN product_offering po ON omm.offering_id = po.id
            JOIN market_master m ON omm.market_id = m.id
            WHERE omm.tenant_id = $1
        `, [TENANT_ID]);
        res.rows.forEach(r => console.log(`   - ${r.offering_code} is ${r.restriction}D in ${r.market_name}`));

        // Smoke Test 5: Offering Relationship
        console.log(`\n5. 🔗 Offering Relationships:`);
        res = await client.query(`
            SELECT src.offering_code as source, r.relationship_type, tgt.offering_code as target 
            FROM offering_relationship r
            JOIN product_offering src ON r.source_offering_id = src.id
            JOIN product_offering tgt ON r.target_offering_id = tgt.id
            WHERE r.tenant_id = $1
        `, [TENANT_ID]);
        res.rows.forEach(r => console.log(`   - ${r.source} ${r.relationship_type} ${r.target}`));

        // Smoke Test 6: Policy Eligibility
        console.log(`\n6. 🛡️ Policy Eligibility:`);
        res = await client.query(`
            SELECT po.offering_code, pr.rule_json 
            FROM policy_mapping pm
            JOIN product_offering po ON pm.product_offering_id = po.id
            JOIN policy_rule pr ON pm.policy_rule_id = pr.id
            WHERE pm.tenant_id = $1
        `, [TENANT_ID]);
        res.rows.forEach(r => console.log(`   - ${r.offering_code} constrained by rule: ${JSON.stringify(r.rule_json)}`));

        // Additional: Tax & Journal output
        console.log(`\n7. 🧾 Tax & GL Configuration:`);
        res = await client.query(`
            SELECT cs.charge_code, tc.tax_name, tc.tax_rate, jc.gl_code
            FROM charge_specification cs
            LEFT JOIN tax_mapping tm ON cs.id = tm.charge_specification_id
            LEFT JOIN tax_configuration tc ON tm.tax_configuration_id = tc.id
            LEFT JOIN journal_mapping jm ON cs.id = jm.charge_specification_id
            LEFT JOIN journal_configuration jc ON jm.journal_configuration_id = jc.id
            WHERE cs.tenant_id = $1
        `, [TENANT_ID]);
        res.rows.forEach(r => console.log(`   - ${r.charge_code} mapped to Tax: ${r.tax_name} (${r.tax_rate}%) and GL: ${r.gl_code}`));

        console.log("\n==========================================");
        console.log("✨ ALL SMOKE TESTS COMPLETED SUCCESSFULLY");
        console.log("==========================================\n");
    } catch (e) {
        console.error("❌ Error:", e.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
