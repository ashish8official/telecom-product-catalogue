-- Tests for 003_cross_tenant_integrity
DO $$
DECLARE
    v_tenant_1 UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();
    v_catalogue_1 UUID;
    v_catalogue_2 UUID;
    v_version_1 UUID;
    v_version_2 UUID;
    v_spec_1 UUID;
    v_spec_2 UUID;
BEGIN
    -- Setup baseline
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_1, 'Cat 1') RETURNING id INTO v_catalogue_1;
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_2, 'Cat 2') RETURNING id INTO v_catalogue_2;
    
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_1, v_catalogue_1, 'v1') RETURNING id INTO v_version_1;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_2, v_catalogue_2, 'v1') RETURNING id INTO v_version_2;

    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status) VALUES (v_tenant_1, 'SPEC1', 'Spec 1', 'ACTIVE') RETURNING id INTO v_spec_1;
    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status) VALUES (v_tenant_2, 'SPEC2', 'Spec 2', 'ACTIVE') RETURNING id INTO v_spec_2;

    -- Test 1: catalogue_version with mismatched tenant_id rejected
    BEGIN
        INSERT INTO catalogue_version (tenant_id, catalogue_id, version) 
        VALUES (v_tenant_2, v_catalogue_1, 'v2');
        RAISE EXCEPTION 'Test 1 Failed: Allowed mismatched tenant_id on catalogue_version';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'Test 1 passed (mismatched tenant rejected).';
    END;

    -- Test 2: product_offering referencing catalogue_version from different tenant rejected
    BEGIN
        INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
        VALUES (v_tenant_1, v_version_2, v_spec_1, 'OFF1', 'Off 1', 'BASE', 'PREPAID');
        RAISE EXCEPTION 'Test 2 Failed: Allowed product_offering -> catalogue_version tenant mismatch';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'Test 2 passed (catalogue_version mismatch rejected).';
    END;

    -- Test 3: product_offering referencing product_specification from different tenant rejected
    BEGIN
        INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
        VALUES (v_tenant_1, v_version_1, v_spec_2, 'OFF2', 'Off 2', 'BASE', 'PREPAID');
        RAISE EXCEPTION 'Test 3 Failed: Allowed product_offering -> product_specification tenant mismatch';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'Test 3 passed (product_specification mismatch rejected).';
    END;

    -- Test 4: invalid product_specification.status rejected
    BEGIN
        INSERT INTO product_specification (tenant_id, spec_code, spec_name, status) 
        VALUES (v_tenant_1, 'SPEC3', 'Spec 3', 'UNKNOWN_STATUS');
        RAISE EXCEPTION 'Test 4 Failed: Allowed invalid product_specification status';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'Test 4 passed (invalid status rejected).';
    END;

    RAISE NOTICE 'All integrity tests passed successfully.';
END;
$$;
