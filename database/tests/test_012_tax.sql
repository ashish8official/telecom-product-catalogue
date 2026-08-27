DO $$
DECLARE
    v_tenant_1 UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();
    
    v_market_t1 UUID;
    v_market_t2 UUID;

    v_charge_t1 UUID;
    v_charge_t2 UUID;

    v_tax_1_t1 UUID;
    v_tax_2_t1 UUID;
    v_tax_3_t1 UUID;
    
    v_tax_1_t2 UUID;
BEGIN
    -- Setup Markets
    INSERT INTO market_master (tenant_id, market_code, market_name)
    VALUES (v_tenant_1, 'MKT_1', 'Market 1') RETURNING id INTO v_market_t1;

    INSERT INTO market_master (tenant_id, market_code, market_name)
    VALUES (v_tenant_2, 'MKT_2', 'Market 2') RETURNING id INTO v_market_t2;

    -- Setup Charge Specifications
    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_priority)
    VALUES (v_tenant_1, 'CHG_1', 'Charge 1', 'ADDITIVE', 'FLAT', 1) RETURNING id INTO v_charge_t1;

    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_priority)
    VALUES (v_tenant_2, 'CHG_2', 'Charge 2', 'ADDITIVE', 'FLAT', 1) RETURNING id INTO v_charge_t2;

    -- TEST 1: 0% accepted
    INSERT INTO tax_configuration (tenant_id, tax_name, tax_rate, market_master_id)
    VALUES (v_tenant_1, 'Zero Tax', 0.0, NULL) RETURNING id INTO v_tax_1_t1;

    -- TEST 2: Valid percentage accepted
    INSERT INTO tax_configuration (tenant_id, tax_name, tax_rate, market_master_id)
    VALUES (v_tenant_1, 'Standard Tax', 18.5, NULL) RETURNING id INTO v_tax_2_t1;

    -- TEST 3: Negative rejected
    BEGIN
        INSERT INTO tax_configuration (tenant_id, tax_name, tax_rate, market_master_id)
        VALUES (v_tenant_1, 'Negative Tax', -5.0, NULL);
        RAISE EXCEPTION 'TEST 3 Failed: Allowed negative tax_rate';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- TEST 4: >100 rejected
    BEGIN
        INSERT INTO tax_configuration (tenant_id, tax_name, tax_rate, market_master_id)
        VALUES (v_tenant_1, 'High Tax', 105.0, NULL);
        RAISE EXCEPTION 'TEST 4 Failed: Allowed >100 tax_rate';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- TEST 5: NULL market accepted
    -- Already validated by TEST 1 and TEST 2

    -- TEST 6: Market-specific tax accepted
    INSERT INTO tax_configuration (tenant_id, tax_name, tax_rate, market_master_id)
    VALUES (v_tenant_1, 'Market Tax', 5.0, v_market_t1) RETURNING id INTO v_tax_3_t1;

    -- TEST 7: Cross-tenant market rejected
    BEGIN
        INSERT INTO tax_configuration (tenant_id, tax_name, tax_rate, market_master_id)
        VALUES (v_tenant_1, 'Cross-Tenant Market Tax', 5.0, v_market_t2);
        RAISE EXCEPTION 'TEST 7 Failed: Allowed cross-tenant market_master_id';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- Setup valid tax for T2 for remaining tests
    INSERT INTO tax_configuration (tenant_id, tax_name, tax_rate, market_master_id)
    VALUES (v_tenant_2, 'T2 Tax', 10.0, NULL) RETURNING id INTO v_tax_1_t2;

    -- TEST 8: Cross-tenant charge/tax mapping rejected
    BEGIN
        INSERT INTO tax_mapping (tenant_id, charge_specification_id, tax_configuration_id)
        VALUES (v_tenant_1, v_charge_t2, v_tax_1_t1);
        RAISE EXCEPTION 'TEST 8 Failed: Allowed cross-tenant charge mapping';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    BEGIN
        INSERT INTO tax_mapping (tenant_id, charge_specification_id, tax_configuration_id)
        VALUES (v_tenant_1, v_charge_t1, v_tax_1_t2);
        RAISE EXCEPTION 'TEST 8 Failed: Allowed cross-tenant tax mapping';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- Setup initial valid mapping for Duplicate test
    INSERT INTO tax_mapping (tenant_id, charge_specification_id, tax_configuration_id)
    VALUES (v_tenant_1, v_charge_t1, v_tax_1_t1);

    -- TEST 9: Duplicate mapping rejected
    BEGIN
        INSERT INTO tax_mapping (tenant_id, charge_specification_id, tax_configuration_id)
        VALUES (v_tenant_1, v_charge_t1, v_tax_1_t1);
        RAISE EXCEPTION 'TEST 9 Failed: Allowed duplicate mapping';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    RAISE NOTICE 'All tests passed successfully for Prompt 13!';
END $$;
