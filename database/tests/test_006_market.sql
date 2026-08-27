-- Tests for 006_market_master
DO $$
DECLARE
    v_tenant_id UUID := gen_random_uuid();
    v_top_market UUID;
    v_mid_market UUID;
    v_leaf_market UUID;
    v_cycle_check BOOLEAN;
BEGIN
    -- Setup Currencies
    INSERT INTO currency_master (currency_code, currency_name) VALUES ('USD', 'US Dollar') ON CONFLICT DO NOTHING;
    INSERT INTO currency_master (currency_code, currency_name) VALUES ('EUR', 'Euro') ON CONFLICT DO NOTHING;

    -- Test 1: currency FK enforced & ISO code CHECK
    BEGIN
        INSERT INTO market_master (tenant_id, market_code, market_name, timezone, default_currency_code)
        VALUES (v_tenant_id, 'INVALID_CURR', 'Invalid Curr Market', 'America/New_York', 'XXX');
        RAISE EXCEPTION 'Test 1a Failed: Allowed invalid currency FK';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    BEGIN
        INSERT INTO currency_master (currency_code, currency_name) VALUES ('us', 'Invalid format');
        RAISE EXCEPTION 'Test 1b Failed: Allowed invalid ISO format';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- Test 2: timezone CHECK rejects 'IST'
    BEGIN
        INSERT INTO market_master (tenant_id, market_code, market_name, timezone, default_currency_code)
        VALUES (v_tenant_id, 'BAD_TZ', 'Bad TZ Market', 'IST', 'USD');
        RAISE EXCEPTION 'Test 2 Failed: Allowed invalid timezone format';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- Test 3: Depth isn't hardcoded (0 levels and 2 levels)
    -- Top level (0 levels of children right now)
    INSERT INTO market_master (tenant_id, market_code, market_name, timezone, default_currency_code)
    VALUES (v_tenant_id, 'GLOBAL', 'Global Market', 'Europe/London', 'USD') RETURNING id INTO v_top_market;

    -- Mid level (1 level down)
    INSERT INTO market_master (tenant_id, market_code, market_name, parent_market_id, timezone, default_currency_code)
    VALUES (v_tenant_id, 'NA', 'North America', v_top_market, 'America/New_York', 'USD') RETURNING id INTO v_mid_market;

    -- Leaf level (2 levels down)
    INSERT INTO market_master (tenant_id, market_code, market_name, parent_market_id, timezone, default_currency_code)
    VALUES (v_tenant_id, 'NY', 'New York', v_mid_market, 'America/New_York', 'USD') RETURNING id INTO v_leaf_market;

    -- Top market is valid with zero children, Leaf is valid at depth 3.

    -- Test 4: Hierarchy cycle check function
    -- a) Market cannot be its own parent
    SELECT check_market_cycle(v_top_market, v_top_market) INTO v_cycle_check;
    IF NOT v_cycle_check THEN
        RAISE EXCEPTION 'Test 4a Failed: Cycle check failed to catch self-reference';
    END IF;

    -- b) Top market cannot have Leaf market as parent (creates cycle)
    SELECT check_market_cycle(v_top_market, v_leaf_market) INTO v_cycle_check;
    IF NOT v_cycle_check THEN
        RAISE EXCEPTION 'Test 4b Failed: Cycle check failed to catch multi-level cycle';
    END IF;

    -- c) Safe assignment returns false
    SELECT check_market_cycle(v_leaf_market, v_top_market) INTO v_cycle_check;
    IF v_cycle_check THEN
        RAISE EXCEPTION 'Test 4c Failed: Cycle check incorrectly flagged valid assignment';
    END IF;

    RAISE NOTICE 'All tests for 006 passed successfully.';
END;
$$;
