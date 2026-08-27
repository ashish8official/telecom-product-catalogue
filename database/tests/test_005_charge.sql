-- Tests for 005_charge_specification
DO $$
DECLARE
    v_tenant_id UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();
    v_catalogue_id UUID;
    v_version_id UUID;
    v_product_spec_id UUID;
    v_offering_id UUID;
    
    v_charge_spec_1 UUID;
    v_charge_spec_2 UUID;
BEGIN
    -- Setup base catalogue and product offering
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_id, 'Test Cat') RETURNING id INTO v_catalogue_id;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_id, v_catalogue_id, 'v1') RETURNING id INTO v_version_id;
    
    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status) 
    VALUES (v_tenant_id, 'PROD_SPEC_1', 'Product Spec', 'ACTIVE') RETURNING id INTO v_product_spec_id;

    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_id, v_version_id, v_product_spec_id, 'OFF_1', 'Off 1', 'BASE', 'PREPAID') RETURNING id INTO v_offering_id;

    -- Setup charge specifications
    -- Test 1: charge_priority ties allowed (Both have priority 100)
    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, charge_priority, stacking_rule, calculation_type) 
    VALUES (v_tenant_id, 'CHARGE_1', 'Charge 1', 100, 'ADDITIVE', 'FLAT') RETURNING id INTO v_charge_spec_1;
    
    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, charge_priority, stacking_rule, calculation_type) 
    VALUES (v_tenant_id, 'CHARGE_2', 'Charge 2', 100, 'OVERRIDE', 'PERCENTAGE') RETURNING id INTO v_charge_spec_2;

    -- Valid joins
    INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id)
    VALUES (v_tenant_id, v_offering_id, v_charge_spec_1);

    -- Test 2: Join uniqueness enforced
    BEGIN
        INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id)
        VALUES (v_tenant_id, v_offering_id, v_charge_spec_1);
        RAISE EXCEPTION 'Test 2 Failed: Allowed duplicate join for offering and charge spec';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- Test 3: FKs enforced (Cross-tenant mapping blocked)
    BEGIN
        INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id)
        VALUES (v_tenant_2, v_offering_id, v_charge_spec_1);
        RAISE EXCEPTION 'Test 3 Failed: Allowed cross-tenant FK mapping in offering_charge_component';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    RAISE NOTICE 'All tests for 005 passed successfully.';
END;
$$;
