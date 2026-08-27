DO $$
DECLARE
    v_tenant_1 UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();
    
    v_spec UUID;
    
    v_off_A UUID;
    v_off_B UUID;
    v_off_C UUID;
    
    v_off_B_t2 UUID;

    v_cycle_detected BOOLEAN;
BEGIN
    -- Setup Product Specification
    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status)
    VALUES (v_tenant_1, 'SPEC_1', 'Spec 1', 'ACTIVE') RETURNING id INTO v_spec;

    -- Create Offerings for Tenant 1
    INSERT INTO product_offering (tenant_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_1, v_spec, 'OFF_A', 'Offering A', 'BASE', 'PREPAID') RETURNING id INTO v_off_A;

    INSERT INTO product_offering (tenant_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_1, v_spec, 'OFF_B', 'Offering B', 'ADDON', 'PREPAID') RETURNING id INTO v_off_B;

    INSERT INTO product_offering (tenant_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_1, v_spec, 'OFF_C', 'Offering C', 'ADDON', 'PREPAID') RETURNING id INTO v_off_C;

    -- Setup Tenant 2
    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status)
    VALUES (v_tenant_2, 'SPEC_1', 'Spec 1', 'ACTIVE') RETURNING id INTO v_spec;

    INSERT INTO product_offering (tenant_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_2, v_spec, 'OFF_B_T2', 'Offering B T2', 'ADDON', 'PREPAID') RETURNING id INTO v_off_B_t2;

    -- TEST 1: Valid REQUIRES relationship accepted
    INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
    VALUES (v_tenant_1, v_off_A, v_off_B, 'REQUIRES');

    -- TEST 2: Valid UPGRADE relationship accepted
    INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
    VALUES (v_tenant_1, v_off_B, v_off_C, 'UPGRADE');

    -- TEST 3: Valid EXCLUDES relationship accepted
    INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
    VALUES (v_tenant_1, v_off_A, v_off_C, 'EXCLUDES');

    -- TEST 4: Self relationship rejected
    BEGIN
        INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
        VALUES (v_tenant_1, v_off_A, v_off_A, 'REQUIRES');
        RAISE EXCEPTION 'Self relationship was not rejected';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- TEST 5: Duplicate relationship rejected
    BEGIN
        INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
        VALUES (v_tenant_1, v_off_A, v_off_B, 'REQUIRES');
        RAISE EXCEPTION 'Duplicate relationship was not rejected';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- TEST 6: Cross-tenant source rejected (Implicitly prevented by FK using same tenant_id)
    BEGIN
        INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
        VALUES (v_tenant_1, v_off_B_t2, v_off_B, 'REQUIRES');
        RAISE EXCEPTION 'Cross-tenant source was not rejected';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 7: Cross-tenant target rejected (Implicitly prevented by FK using same tenant_id)
    BEGIN
        INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
        VALUES (v_tenant_1, v_off_A, v_off_B_t2, 'REQUIRES');
        RAISE EXCEPTION 'Cross-tenant target was not rejected';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 8: Valid chain A -> REQUIRES -> B -> REQUIRES -> C accepted
    -- A->REQUIRES->B is already inserted. Let's insert B->REQUIRES->C
    INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
    VALUES (v_tenant_1, v_off_B, v_off_C, 'REQUIRES');

    -- TEST 9: Three-node cycle rejected
    -- C -> REQUIRES -> A
    v_cycle_detected := check_offering_relationship_cycle(v_tenant_1, v_off_C, v_off_A);
    IF NOT v_cycle_detected THEN
        RAISE EXCEPTION 'Three-node cycle was not detected';
    END IF;

    -- TEST 10: UPGRADE cycle rejected
    -- A->UPGRADE->B, B->UPGRADE->C (already done in Test 2), let's check C->UPGRADE->A
    INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
    VALUES (v_tenant_1, v_off_A, v_off_B, 'UPGRADE');
    
    v_cycle_detected := check_offering_relationship_cycle(v_tenant_1, v_off_C, v_off_A);
    IF NOT v_cycle_detected THEN
        RAISE EXCEPTION 'UPGRADE cycle was not detected';
    END IF;

    -- TEST 11: Mutual EXCLUDES allowed
    -- We already have A->EXCLUDES->C. Let's check if C->EXCLUDES->A creates a cycle
    v_cycle_detected := check_offering_relationship_cycle(v_tenant_1, v_off_C, v_off_A);
    -- Wait, check_offering_relationship_cycle only looks at REQUIRES and UPGRADE.
    -- So for EXCLUDES, it shouldn't detect a cycle even if A->EXCLUDES->C exists.
    -- Actually A->UPGRADE->B and B->UPGRADE->C exists, so C->A is a cycle regardless of relationship.
    -- Let's test EXCLUDES independently.
    
    -- New clean tenant for EXCLUDES
    DECLARE
        v_tenant_3 UUID := gen_random_uuid();
        v_off_X UUID;
        v_off_Y UUID;
    BEGIN
        INSERT INTO product_specification (tenant_id, spec_code, spec_name, status)
        VALUES (v_tenant_3, 'SPEC_2', 'Spec 2', 'ACTIVE') RETURNING id INTO v_spec;

        INSERT INTO product_offering (tenant_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
        VALUES (v_tenant_3, v_spec, 'OFF_X', 'Offering X', 'BASE', 'PREPAID') RETURNING id INTO v_off_X;

        INSERT INTO product_offering (tenant_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
        VALUES (v_tenant_3, v_spec, 'OFF_Y', 'Offering Y', 'BASE', 'PREPAID') RETURNING id INTO v_off_Y;

        INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
        VALUES (v_tenant_3, v_off_X, v_off_Y, 'EXCLUDES');

        v_cycle_detected := check_offering_relationship_cycle(v_tenant_3, v_off_Y, v_off_X);
        IF v_cycle_detected THEN
            RAISE EXCEPTION 'Mutual EXCLUDES should not be considered a cycle';
        END IF;

        INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
        VALUES (v_tenant_3, v_off_Y, v_off_X, 'EXCLUDES');
    END;

    RAISE NOTICE 'All tests passed successfully for Prompt 10!';
END $$;
