-- Tests for 002_product_specification_and_offering
DO $$
DECLARE
    v_tenant_id UUID := gen_random_uuid();
    v_catalogue_id UUID;
    v_version_id UUID;
    v_spec_id UUID;
    v_offering_id UUID;
BEGIN
    -- Setup base data
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_id, 'Test Cat') RETURNING id INTO v_catalogue_id;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_id, v_catalogue_id, 'v1') RETURNING id INTO v_version_id;
    
    INSERT INTO product_specification (tenant_id, spec_code, spec_name) 
    VALUES (v_tenant_id, 'SPEC_1', 'Spec 1') RETURNING id INTO v_spec_id;

    -- Test 1: effective_to < effective_from rejected on product_specification
    BEGIN
        INSERT INTO product_specification (tenant_id, spec_code, spec_name, effective_from, effective_to)
        VALUES (v_tenant_id, 'SPEC_FAIL', 'Fail Spec', NOW(), NOW() - INTERVAL '1 day');
        RAISE EXCEPTION 'Test 1 Failed: Allowed effective_to < effective_from';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- Test 2: duplicate spec_code within tenant rejected
    BEGIN
        INSERT INTO product_specification (tenant_id, spec_code, spec_name)
        VALUES (v_tenant_id, 'SPEC_1', 'Spec 1 Duplicate');
        RAISE EXCEPTION 'Test 2 Failed: Allowed duplicate spec_code';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- Test 3: product_offering without a product_specification_id rejected
    BEGIN
        -- postgres will throw not_null_violation for omitted column if no default
        INSERT INTO product_offering (tenant_id, catalogue_version_id, offering_code, offering_name, offering_type, service_type)
        VALUES (v_tenant_id, v_version_id, 'OFF_1', 'Off 1', 'BASE', 'PREPAID');
        RAISE EXCEPTION 'Test 3 Failed: Allowed insert without product_specification_id';
    EXCEPTION WHEN not_null_violation THEN
        -- Expected
    END;

    -- Test 4: offering_type CHECK violation rejected
    BEGIN
        INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
        VALUES (v_tenant_id, v_version_id, v_spec_id, 'OFF_2', 'Off 2', 'INVALID_TYPE', 'PREPAID');
        RAISE EXCEPTION 'Test 4 Failed: Allowed invalid offering_type';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- Test 5: service_type CHECK violation rejected
    BEGIN
        INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
        VALUES (v_tenant_id, v_version_id, v_spec_id, 'OFF_3', 'Off 3', 'BASE', 'INVALID_SVC');
        RAISE EXCEPTION 'Test 5 Failed: Allowed invalid service_type';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- Test 6: duplicate offering_code within tenant+version rejected
    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_id, v_version_id, v_spec_id, 'OFF_VALID', 'Off Valid', 'BASE', 'PREPAID');
    
    BEGIN
        INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
        VALUES (v_tenant_id, v_version_id, v_spec_id, 'OFF_VALID', 'Off Valid Dup', 'BASE', 'PREPAID');
        RAISE EXCEPTION 'Test 6 Failed: Allowed duplicate offering_code in same version';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    RAISE NOTICE 'All tests for 002 passed successfully.';
END;
$$;
