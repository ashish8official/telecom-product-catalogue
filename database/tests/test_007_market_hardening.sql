-- Tests for 007_market_hardening
DO $$
DECLARE
    v_tenant_1 UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();
    
    v_africa UUID;
    v_nigeria UUID;
    v_lagos UUID;
    v_cycle_check BOOLEAN;
BEGIN
    -- Setup Currencies
    INSERT INTO currency_master (currency_code, currency_name) VALUES ('NGN', 'Nigerian Naira') ON CONFLICT DO NOTHING;
    INSERT INTO currency_master (currency_code, currency_name) VALUES ('USD', 'US Dollar') ON CONFLICT DO NOTHING;

    -- TEST 1: Valid market can be created (Grouping market with NULL timezone/currency)
    INSERT INTO market_master (tenant_id, market_code, market_name, market_type, is_pricing_market, timezone, default_currency_code)
    VALUES (v_tenant_1, 'AFRICA', 'Africa', 'GROUP', FALSE, NULL, NULL) RETURNING id INTO v_africa;

    -- TEST 10 & 11 implicitly proven above (NULL timezone and NULL currency allowed)

    -- TEST 2: Duplicate market_code within same tenant is rejected
    BEGIN
        INSERT INTO market_master (tenant_id, market_code, market_name)
        VALUES (v_tenant_1, 'AFRICA', 'Duplicate Africa');
        RAISE EXCEPTION 'TEST 2 Failed: Allowed duplicate market_code within same tenant';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- TEST 3: Same market_code across different tenants is allowed
    INSERT INTO market_master (tenant_id, market_code, market_name, market_type, is_pricing_market)
    VALUES (v_tenant_2, 'AFRICA', 'Africa T2', 'GROUP', FALSE);

    -- TEST 6: Valid hierarchical parent-child relationship is allowed
    INSERT INTO market_master (tenant_id, market_code, market_name, parent_market_id, market_type, is_pricing_market, timezone, default_currency_code)
    VALUES (v_tenant_1, 'NIGERIA', 'Nigeria', v_africa, 'COUNTRY', TRUE, 'Africa/Lagos', 'NGN') RETURNING id INTO v_nigeria;

    -- TEST 4: Cross-tenant parent_market_id is rejected
    BEGIN
        INSERT INTO market_master (tenant_id, market_code, market_name, parent_market_id)
        VALUES (v_tenant_2, 'NIGERIA_T2', 'Nigeria T2', v_africa); -- v_africa belongs to tenant_1
        RAISE EXCEPTION 'TEST 4 Failed: Allowed cross-tenant parent_market_id';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 5: Self-parent market is rejected (DB CHECK constraint)
    BEGIN
        INSERT INTO market_master (tenant_id, market_code, market_name, parent_market_id)
        VALUES (v_tenant_1, 'SELF_PARENT', 'Self', v_africa) RETURNING id INTO v_lagos;
        
        UPDATE market_master SET parent_market_id = id WHERE id = v_lagos;
        RAISE EXCEPTION 'TEST 5 Failed: Allowed self-parent market';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- TEST 7: Invalid circular hierarchy is detected/rejected through existing cycle check
    -- NIGERIA -> AFRICA -> NIGERIA
    SELECT check_market_cycle(v_nigeria, v_africa) INTO v_cycle_check;
    IF v_cycle_check THEN
        RAISE EXCEPTION 'Cycle check failed: falsely detected cycle for valid structure';
    END IF;
    
    SELECT check_market_cycle(v_africa, v_nigeria) INTO v_cycle_check;
    IF NOT v_cycle_check THEN
        RAISE EXCEPTION 'TEST 7 Failed: Did not detect circular hierarchy (AFRICA -> NIGERIA -> AFRICA)';
    END IF;

    -- TEST 8: Valid IANA-format timezone accepted
    INSERT INTO market_master (tenant_id, market_code, market_name, timezone, default_currency_code)
    VALUES (v_tenant_1, 'LAGOS', 'Lagos', 'Africa/Lagos', 'NGN') RETURNING id INTO v_lagos;

    -- TEST 9: Timezone abbreviation rejected
    BEGIN
        INSERT INTO market_master (tenant_id, market_code, market_name, timezone)
        VALUES (v_tenant_1, 'BAD_TZ', 'Bad TZ', 'IST');
        RAISE EXCEPTION 'TEST 9 Failed: Allowed invalid timezone abbreviation';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- TEST 12: Valid currency codes accepted (Proven by inserting NGN above)
    
    -- TEST 13: Invalid currency format rejected
    BEGIN
        INSERT INTO currency_master (currency_code, currency_name) VALUES ('NG', 'Invalid');
        RAISE EXCEPTION 'TEST 13 Failed: Allowed 2-letter currency code';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- TEST 14: Invalid/nonexistent currency FK rejected
    BEGIN
        INSERT INTO market_master (tenant_id, market_code, market_name, default_currency_code)
        VALUES (v_tenant_1, 'BAD_CURR', 'Bad Curr', 'XYZ');
        RAISE EXCEPTION 'TEST 14 Failed: Allowed nonexistent currency FK';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 15: Market effective date validation works
    BEGIN
        INSERT INTO market_master (tenant_id, market_code, market_name, effective_from, effective_to)
        VALUES (v_tenant_1, 'BAD_DATE', 'Bad Date', NOW(), NOW() - INTERVAL '1 day');
        RAISE EXCEPTION 'TEST 15 Failed: Allowed effective_to < effective_from';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    RAISE NOTICE 'All tests for 007 passed successfully.';
END;
$$;
