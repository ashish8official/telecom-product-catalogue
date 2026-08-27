DO $$
DECLARE
    v_tenant_1 UUID := gen_random_uuid();
    v_tenant_2 UUID := gen_random_uuid();

    v_cat UUID;
    v_ver UUID;
    v_spec UUID;
    v_offering_1 UUID;
    v_offering_2 UUID;

    v_schema_1_t1 UUID;
    v_schema_1_t2 UUID;
    
    v_rule_1_t1 UUID;
    v_rule_1_t2 UUID;

    v_json_schema JSONB := '{"type": "object", "properties": {"market_code": {"type": "string"}}}';
    v_json_rule JSONB := '{"market_code": "NIGERIA"}';
BEGIN
    -- Setup core catalogue entities for FK requirements
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_1, 'Cat 1') RETURNING id INTO v_cat;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_1, v_cat, 'v1') RETURNING id INTO v_ver;
    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status) VALUES (v_tenant_1, 'SPEC_1', 'Spec 1', 'ACTIVE') RETURNING id INTO v_spec;
    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_1, v_ver, v_spec, 'OFF_1', 'Off 1', 'BASE', 'PREPAID') RETURNING id INTO v_offering_1;

    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_2, 'Cat 2') RETURNING id INTO v_cat;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_2, v_cat, 'v1') RETURNING id INTO v_ver;
    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status) VALUES (v_tenant_2, 'SPEC_2', 'Spec 2', 'ACTIVE') RETURNING id INTO v_spec;
    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_2, v_ver, v_spec, 'OFF_2', 'Off 2', 'BASE', 'PREPAID') RETURNING id INTO v_offering_2;

    -- TEST 1: Valid policy_schema insertion succeeds
    INSERT INTO policy_schema (tenant_id, schema_name, version, schema_json)
    VALUES (v_tenant_1, 'M2M_ELIGIBILITY', 'v1', v_json_schema) RETURNING id INTO v_schema_1_t1;

    -- TEST 2: Duplicate tenant_id + schema_name + version is rejected
    BEGIN
        INSERT INTO policy_schema (tenant_id, schema_name, version, schema_json)
        VALUES (v_tenant_1, 'M2M_ELIGIBILITY', 'v1', v_json_schema);
        RAISE EXCEPTION 'TEST 2 Failed: Allowed duplicate schema definition';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- TEST 3: Same schema_name + version in different tenants is allowed
    INSERT INTO policy_schema (tenant_id, schema_name, version, schema_json)
    VALUES (v_tenant_2, 'M2M_ELIGIBILITY', 'v1', v_json_schema) RETURNING id INTO v_schema_1_t2;

    -- TEST 4: Valid same-tenant policy_rule reference succeeds structurally
    INSERT INTO policy_rule (tenant_id, schema_id, rule_json)
    VALUES (v_tenant_1, v_schema_1_t1, v_json_rule) RETURNING id INTO v_rule_1_t1;

    INSERT INTO policy_rule (tenant_id, schema_id, rule_json)
    VALUES (v_tenant_2, v_schema_1_t2, v_json_rule) RETURNING id INTO v_rule_1_t2;

    -- TEST 5: Cross-tenant policy_rule -> policy_schema is rejected
    BEGIN
        INSERT INTO policy_rule (tenant_id, schema_id, rule_json)
        VALUES (v_tenant_1, v_schema_1_t2, v_json_rule);
        RAISE EXCEPTION 'TEST 5 Failed: Allowed cross-tenant policy rule to schema';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 6: Valid policy_mapping succeeds
    INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id)
    VALUES (v_tenant_1, v_offering_1, v_rule_1_t1);

    -- TEST 7: Duplicate policy_mapping is rejected
    BEGIN
        INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id)
        VALUES (v_tenant_1, v_offering_1, v_rule_1_t1);
        RAISE EXCEPTION 'TEST 7 Failed: Allowed duplicate policy mapping';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- TEST 8: Cross-tenant policy_mapping -> product_offering is rejected
    BEGIN
        INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id)
        VALUES (v_tenant_1, v_offering_2, v_rule_1_t1);
        RAISE EXCEPTION 'TEST 8 Failed: Allowed cross-tenant policy mapping to offering';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 9: Cross-tenant policy_mapping -> policy_rule is rejected
    BEGIN
        INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id)
        VALUES (v_tenant_1, v_offering_1, v_rule_1_t2);
        RAISE EXCEPTION 'TEST 9 Failed: Allowed cross-tenant policy mapping to rule';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    -- TEST 10: Invalid foreign-key references are rejected
    BEGIN
        INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id)
        VALUES (v_tenant_1, gen_random_uuid(), v_rule_1_t1);
        RAISE EXCEPTION 'TEST 10 Failed: Allowed invalid offering foreign key';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    BEGIN
        INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id)
        VALUES (v_tenant_1, v_offering_1, gen_random_uuid());
        RAISE EXCEPTION 'TEST 10 Failed: Allowed invalid rule foreign key';
    EXCEPTION WHEN foreign_key_violation THEN
        -- Expected
    END;

    RAISE NOTICE 'All tests passed successfully for Prompt 12 Database constraints!';
END $$;
