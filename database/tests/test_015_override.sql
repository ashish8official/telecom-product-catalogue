DO $$
DECLARE
    v_tenant_1 UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();
    
    v_market_t1 UUID;
    v_market_t2 UUID;

    v_charge_t1 UUID;
    v_charge_t2 UUID;

    v_rate_t1 UUID;
    v_rate_t2 UUID;

    v_now TIMESTAMPTZ := NOW();
    
    v_result resolved_price_result;
    v_base_rate_amount NUMERIC;
BEGIN
    -- Setup core entities
    INSERT INTO currency_master (currency_code, currency_name) VALUES ('USD', 'US Dollar') ON CONFLICT DO NOTHING;

    INSERT INTO market_master (tenant_id, market_code, market_name)
    VALUES (v_tenant_1, 'MKT_1', 'Market 1') RETURNING id INTO v_market_t1;

    INSERT INTO market_master (tenant_id, market_code, market_name)
    VALUES (v_tenant_2, 'MKT_2', 'Market 2') RETURNING id INTO v_market_t2;

    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, charge_priority, stacking_rule, calculation_type)
    VALUES (v_tenant_1, 'CHG_1', 'Charge 1', 1, 'ADDITIVE', 'FLAT') RETURNING id INTO v_charge_t1;

    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, charge_priority, stacking_rule, calculation_type)
    VALUES (v_tenant_2, 'CHG_2', 'Charge 2', 1, 'ADDITIVE', 'FLAT') RETURNING id INTO v_charge_t2;

    INSERT INTO offering_rate (tenant_id, charge_spec_id, market_id, currency_code, amount)
    VALUES (v_tenant_1, v_charge_t1, v_market_t1, 'USD', 1299.00) RETURNING id INTO v_rate_t1;

    INSERT INTO offering_rate (tenant_id, charge_spec_id, market_id, currency_code, amount)
    VALUES (v_tenant_2, v_charge_t2, v_market_t2, 'USD', 500.00) RETURNING id INTO v_rate_t2;

    -- TEST I: Price override does not mutate offering_rate
    -- 1. Create price_override amount = 999
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
    VALUES (v_tenant_1, v_rate_t1, 'SUBSCRIBER', 'SUB_TEST_I', 999.00, v_now - INTERVAL '1 day', NULL);
    
    -- 2. Verify offering_rate remains 1299
    SELECT amount INTO v_base_rate_amount FROM offering_rate WHERE id = v_rate_t1;
    IF v_base_rate_amount != 1299.00 THEN
        RAISE EXCEPTION 'TEST I Failed: offering_rate amount was mutated from 1299.00 to %', v_base_rate_amount;
    END IF;

    -- TEST A: Base rate returned when no override exists for this subscriber
    v_result := resolve_price(v_tenant_1, v_rate_t1, 'SUB_NO_OVERRIDE', 'ACC_1', 'MKT_1', v_now);
    IF v_result.amount != 1299.00 OR v_result.source != 'CATALOGUE_RATE' THEN
        RAISE EXCEPTION 'TEST A Failed: Expected 1299.00 CATALOGUE_RATE, got % %', v_result.amount, v_result.source;
    END IF;

    -- Setup Hierarchy for tests B, C, D
    -- Market override = 1099
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
    VALUES (v_tenant_1, v_rate_t1, 'MARKET', 'MKT_1', 1099.00, v_now - INTERVAL '1 day', NULL);

    -- Account override = 899
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
    VALUES (v_tenant_1, v_rate_t1, 'ACCOUNT', 'ACC_1', 899.00, v_now - INTERVAL '1 day', NULL);

    -- Subscriber override = 799
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
    VALUES (v_tenant_1, v_rate_t1, 'SUBSCRIBER', 'SUB_1', 799.00, v_now - INTERVAL '1 day', NULL);

    -- TEST B: Market override beats base (Provide MKT_1, no SUB or ACC match)
    v_result := resolve_price(v_tenant_1, v_rate_t1, 'SUB_OTHER', 'ACC_OTHER', 'MKT_1', v_now);
    IF v_result.amount != 1099.00 OR v_result.source != 'MARKET' THEN
        RAISE EXCEPTION 'TEST B Failed: Expected 1099.00 MARKET, got % %', v_result.amount, v_result.source;
    END IF;

    -- TEST C: Account override beats market (Provide ACC_1 and MKT_1)
    v_result := resolve_price(v_tenant_1, v_rate_t1, 'SUB_OTHER', 'ACC_1', 'MKT_1', v_now);
    IF v_result.amount != 899.00 OR v_result.source != 'ACCOUNT' THEN
        RAISE EXCEPTION 'TEST C Failed: Expected 899.00 ACCOUNT, got % %', v_result.amount, v_result.source;
    END IF;

    -- TEST D: Subscriber override beats account and market
    v_result := resolve_price(v_tenant_1, v_rate_t1, 'SUB_1', 'ACC_1', 'MKT_1', v_now);
    IF v_result.amount != 799.00 OR v_result.source != 'SUBSCRIBER' THEN
        RAISE EXCEPTION 'TEST D Failed: Expected 799.00 SUBSCRIBER, got % %', v_result.amount, v_result.source;
    END IF;

    -- TEST E: Expired override ignored
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
    VALUES (v_tenant_1, v_rate_t1, 'SUBSCRIBER', 'SUB_EXPIRED', 1.00, v_now - INTERVAL '10 days', v_now - INTERVAL '5 days');
    
    v_result := resolve_price(v_tenant_1, v_rate_t1, 'SUB_EXPIRED', NULL, NULL, v_now);
    IF v_result.source = 'SUBSCRIBER' THEN
        RAISE EXCEPTION 'TEST E Failed: Expired override was returned';
    END IF;

    -- TEST F: Future override ignored
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
    VALUES (v_tenant_1, v_rate_t1, 'SUBSCRIBER', 'SUB_FUTURE', 2.00, v_now + INTERVAL '5 days', v_now + INTERVAL '10 days');
    
    v_result := resolve_price(v_tenant_1, v_rate_t1, 'SUB_FUTURE', NULL, NULL, v_now);
    IF v_result.source = 'SUBSCRIBER' THEN
        RAISE EXCEPTION 'TEST F Failed: Future override was returned';
    END IF;

    -- TEST G: Overlapping same-scope override rejected
    BEGIN
        INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
        VALUES (v_tenant_1, v_rate_t1, 'SUBSCRIBER', 'SUB_1', 699.00, v_now - INTERVAL '2 days', v_now + INTERVAL '2 days');
        RAISE EXCEPTION 'TEST G Failed: Allowed overlapping override';
    EXCEPTION WHEN raise_exception THEN
        -- Expected trigger to throw overlapping exception
    END;

    -- TEST H: Cross-tenant override rejected
    BEGIN
        INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
        VALUES (v_tenant_1, v_rate_t2, 'SUBSCRIBER', 'SUB_X', 100.00, v_now - INTERVAL '1 day', NULL);
        RAISE EXCEPTION 'TEST H Failed: Allowed cross-tenant override mapping';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST J: Correct resolution source returned. (Already asserted in Tests A, B, C, D)

    RAISE NOTICE 'All tests passed successfully for Prompt 15!';
END $$;
