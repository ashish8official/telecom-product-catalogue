-- Tests for 004_service_specification
DO $$
DECLARE
    v_tenant_id UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();
    v_catalogue_id UUID;
    v_version_id UUID;
    v_product_spec_id UUID;
    v_offering_id UUID;
    
    v_service_spec_1 UUID;
    v_service_spec_2 UUID;
BEGIN
    -- Setup base catalogue and product offering
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_id, 'Test Cat') RETURNING id INTO v_catalogue_id;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_id, v_catalogue_id, 'v1') RETURNING id INTO v_version_id;
    
    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status) 
    VALUES (v_tenant_id, 'PROD_SPEC_1', 'Product Spec', 'ACTIVE') RETURNING id INTO v_product_spec_id;

    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_id, v_version_id, v_product_spec_id, 'OFF_1', 'Off 1', 'BASE', 'PREPAID') RETURNING id INTO v_offering_id;

    -- Test 1: NULL characteristics accepted
    INSERT INTO service_specification (tenant_id, spec_code, spec_name, characteristics) 
    VALUES (v_tenant_id, 'SVC_1', 'Service 1', NULL) RETURNING id INTO v_service_spec_1;
    
    INSERT INTO service_specification (tenant_id, spec_code, spec_name, characteristics) 
    VALUES (v_tenant_id, 'SVC_2', 'Service 2', '{"bandwidth": "100Mbps"}') RETURNING id INTO v_service_spec_2;

    -- Valid join
    INSERT INTO offering_service_component (tenant_id, offering_id, service_spec_id)
    VALUES (v_tenant_id, v_offering_id, v_service_spec_1);

    -- Test 2: Join uniqueness enforced
    BEGIN
        INSERT INTO offering_service_component (tenant_id, offering_id, service_spec_id)
        VALUES (v_tenant_id, v_offering_id, v_service_spec_1);
        RAISE EXCEPTION 'Test 2 Failed: Allowed duplicate join for offering and service spec';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- Test 3: FKs enforced (Cross-tenant mapping blocked)
    BEGIN
        INSERT INTO offering_service_component (tenant_id, offering_id, service_spec_id)
        VALUES (v_tenant_2, v_offering_id, v_service_spec_1);
        RAISE EXCEPTION 'Test 3 Failed: Allowed cross-tenant FK mapping in offering_service_component';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    RAISE NOTICE 'All tests for 004 passed successfully.';
END;
$$;
