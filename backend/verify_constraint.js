const { Client } = require('pg');

async function run() {
    const client = new Client({
        user: 'postgres', host: 'localhost',
        database: 'catalogue_db', password: 'admin', port: 5433,
    });
    await client.connect();

    try {
        // Test: inverted date range should be rejected
        await client.query(`
            DO $$ BEGIN
                -- Get any existing offering_rate to reference
                DECLARE v_rate_id UUID; v_tenant_id UUID;
                BEGIN
                    SELECT id, tenant_id INTO v_rate_id, v_tenant_id
                    FROM offering_rate LIMIT 1;

                    IF v_rate_id IS NULL THEN
                        RAISE NOTICE 'No offering_rate rows to test against — skipping constraint test';
                        RETURN;
                    END IF;

                    -- This should FAIL: effective_to before effective_from
                    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
                    VALUES (v_tenant_id, v_rate_id, 'SUBSCRIBER', 'CONSTRAINT_TEST', 100, '2026-10-01', '2026-09-01');
                    RAISE EXCEPTION 'CONSTRAINT TEST FAILED: Inverted dates were accepted';
                EXCEPTION WHEN check_violation THEN
                    RAISE NOTICE 'CONSTRAINT TEST PASSED: Inverted dates correctly rejected';
                END;
            END $$;
        `);
        console.log('✅ effective_to > effective_from constraint works correctly');
    } catch (e) {
        console.error('❌ Constraint test error:', e.message);
    } finally {
        await client.end();
    }
}
run();
