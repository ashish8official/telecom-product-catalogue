DO $$
DECLARE
    v_tenant_1 UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();
    
    v_cat_1 UUID;
    v_cat_2 UUID;
    v_ver_1 UUID;
    v_ver_2 UUID;
    v_spec UUID;
    v_off_A UUID;
    v_off_B UUID;
    v_off_t2 UUID;

    v_cat_root UUID;
    v_cat_child UUID;
    v_cat_grandchild UUID;
    v_cat_t2 UUID;
    
    v_cycle_detected BOOLEAN;
BEGIN
    -- Setup basic infrastructure
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_1, 'Cat 1') RETURNING id INTO v_cat_1;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_1, v_cat_1, 'v1') RETURNING id INTO v_ver_1;

    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status)
    VALUES (v_tenant_1, 'SPEC_1', 'Spec 1', 'ACTIVE') RETURNING id INTO v_spec;

    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_1, v_ver_1, v_spec, 'OFF_A', 'Offering A', 'BASE', 'PREPAID') RETURNING id INTO v_off_A;

    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_1, v_ver_1, v_spec, 'OFF_B', 'Offering B', 'BASE', 'PREPAID') RETURNING id INTO v_off_B;

    -- Setup Tenant 2
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_2, 'Cat 2') RETURNING id INTO v_cat_2;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_2, v_cat_2, 'v1') RETURNING id INTO v_ver_2;

    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status)
    VALUES (v_tenant_2, 'SPEC_2', 'Spec 2', 'ACTIVE') RETURNING id INTO v_spec;

    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_2, v_ver_2, v_spec, 'OFF_T2', 'Offering T2', 'BASE', 'PREPAID') RETURNING id INTO v_off_t2;

    -- TEST 1: Root category accepted
    INSERT INTO offering_category (tenant_id, name, parent_category_id)
    VALUES (v_tenant_1, 'M2M PLANS', NULL) RETURNING id INTO v_cat_root;

    -- TEST 2: Child category accepted
    INSERT INTO offering_category (tenant_id, name, parent_category_id)
    VALUES (v_tenant_1, 'PREPAID M2M', v_cat_root) RETURNING id INTO v_cat_child;

    -- TEST 3: Nested category accepted
    INSERT INTO offering_category (tenant_id, name, parent_category_id)
    VALUES (v_tenant_1, 'M2M BASIC', v_cat_child) RETURNING id INTO v_cat_grandchild;

    -- TEST 4: Self-parent rejected
    BEGIN
        INSERT INTO offering_category (tenant_id, id, name, parent_category_id)
        VALUES (v_tenant_1, v_cat_root, 'Self Parent', v_cat_root);
        RAISE EXCEPTION 'Self-parent was not rejected';
    EXCEPTION WHEN check_violation OR unique_violation THEN
        -- Expected
    END;

    -- TEST 5: Circular category hierarchy rejected
    -- Attempt: A(root) -> C(grandchild) creating C->B->A->C cycle
    v_cycle_detected := check_category_cycle(v_tenant_1, v_cat_root, v_cat_grandchild);
    IF NOT v_cycle_detected THEN
        RAISE EXCEPTION 'Circular category hierarchy was not detected';
    END IF;

    -- TEST 6: Cross-tenant parent rejected
    INSERT INTO offering_category (tenant_id, name, parent_category_id)
    VALUES (v_tenant_2, 'T2 Root', NULL) RETURNING id INTO v_cat_t2;

    BEGIN
        INSERT INTO offering_category (tenant_id, name, parent_category_id)
        VALUES (v_tenant_1, 'Cross-tenant child', v_cat_t2);
        RAISE EXCEPTION 'Cross-tenant parent was not rejected';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 7: Cross-tenant mapping rejected
    BEGIN
        INSERT INTO offering_category_mapping (tenant_id, product_offering_id, category_id)
        VALUES (v_tenant_1, v_off_t2, v_cat_root);
        RAISE EXCEPTION 'Cross-tenant mapping (offering) was not rejected';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    BEGIN
        INSERT INTO offering_category_mapping (tenant_id, product_offering_id, category_id)
        VALUES (v_tenant_1, v_off_A, v_cat_t2);
        RAISE EXCEPTION 'Cross-tenant mapping (category) was not rejected';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 8: Duplicate mapping rejected
    INSERT INTO offering_category_mapping (tenant_id, product_offering_id, category_id)
    VALUES (v_tenant_1, v_off_A, v_cat_root);
    
    BEGIN
        INSERT INTO offering_category_mapping (tenant_id, product_offering_id, category_id)
        VALUES (v_tenant_1, v_off_A, v_cat_root);
        RAISE EXCEPTION 'Duplicate mapping was not rejected';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- TEST 9: Same offering can belong to two categories
    INSERT INTO offering_category_mapping (tenant_id, product_offering_id, category_id)
    VALUES (v_tenant_1, v_off_A, v_cat_child);
    
    -- And category can contain multiple offerings
    INSERT INTO offering_category_mapping (tenant_id, product_offering_id, category_id)
    VALUES (v_tenant_1, v_off_B, v_cat_child);

    RAISE NOTICE 'All tests passed successfully for Prompt 11!';
END $$;
