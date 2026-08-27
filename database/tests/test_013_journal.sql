DO $$
DECLARE
    v_tenant_1 UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();
    
    v_gl_1_t1 UUID;
    v_gl_1_t2 UUID;

    v_charge_t1 UUID;
    v_charge_t2 UUID;
BEGIN
    -- Setup Charge Specifications
    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_priority)
    VALUES (v_tenant_1, 'CHG_1', 'Charge 1', 'ADDITIVE', 'FLAT', 1) RETURNING id INTO v_charge_t1;

    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_priority)
    VALUES (v_tenant_2, 'CHG_2', 'Charge 2', 'ADDITIVE', 'FLAT', 1) RETURNING id INTO v_charge_t2;

    -- TEST 1: Valid GL configuration
    INSERT INTO journal_configuration (tenant_id, gl_code, gl_description)
    VALUES (v_tenant_1, 'GL_1001', 'Primary Revenue') RETURNING id INTO v_gl_1_t1;

    -- TEST 2: Duplicate GL code within tenant rejected
    BEGIN
        INSERT INTO journal_configuration (tenant_id, gl_code, gl_description)
        VALUES (v_tenant_1, 'GL_1001', 'Duplicate Primary Revenue');
        RAISE EXCEPTION 'TEST 2 Failed: Allowed duplicate gl_code in same tenant';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- TEST 3: Same GL code in different tenants allowed
    INSERT INTO journal_configuration (tenant_id, gl_code, gl_description)
    VALUES (v_tenant_2, 'GL_1001', 'Primary Revenue T2') RETURNING id INTO v_gl_1_t2;

    -- TEST 4: Valid mapping accepted
    INSERT INTO journal_mapping (tenant_id, charge_specification_id, journal_configuration_id)
    VALUES (v_tenant_1, v_charge_t1, v_gl_1_t1);

    -- TEST 5: Cross-tenant mapping rejected
    -- Attempting to map Tenant 1 charge to Tenant 2 GL config
    BEGIN
        INSERT INTO journal_mapping (tenant_id, charge_specification_id, journal_configuration_id)
        VALUES (v_tenant_1, v_charge_t1, v_gl_1_t2);
        RAISE EXCEPTION 'TEST 5 Failed: Allowed cross-tenant mapping (GL Config)';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- Attempting to map Tenant 2 charge to Tenant 1 GL config using Tenant 1 namespace
    BEGIN
        INSERT INTO journal_mapping (tenant_id, charge_specification_id, journal_configuration_id)
        VALUES (v_tenant_1, v_charge_t2, v_gl_1_t1);
        RAISE EXCEPTION 'TEST 5 Failed: Allowed cross-tenant mapping (Charge)';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 6: Duplicate mapping rejected
    BEGIN
        INSERT INTO journal_mapping (tenant_id, charge_specification_id, journal_configuration_id)
        VALUES (v_tenant_1, v_charge_t1, v_gl_1_t1);
        RAISE EXCEPTION 'TEST 6 Failed: Allowed duplicate mapping';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    RAISE NOTICE 'All tests passed successfully for Prompt 14!';
END $$;
