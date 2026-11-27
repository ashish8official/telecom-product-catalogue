-- Tests for 019_released_version_immutability
DO $$
DECLARE
    v_tenant UUID := gen_random_uuid();
    v_cat UUID;
    v_ver UUID;
    v_draft UUID;
    v_spec UUID;
    v_off UUID;
    v_off_draft UUID;
    v_other UUID;
    v_charge UUID;
    v_service UUID;
    v_market UUID;
    v_rate UUID;
    v_schema UUID;
    v_rule UUID;
BEGIN
    INSERT INTO currency_master (currency_code, currency_name) VALUES ('USD', 'US Dollar') ON CONFLICT DO NOTHING;

    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant, 'Immutability Cat') RETURNING id INTO v_cat;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant, v_cat, 'v1') RETURNING id INTO v_ver;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant, v_cat, 'v2') RETURNING id INTO v_draft;

    INSERT INTO product_specification (tenant_id, spec_code, spec_name) VALUES (v_tenant, 'IMM_SPEC', 'Immutable Spec') RETURNING id INTO v_spec;
    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type)
    VALUES (v_tenant, 'IMM_CHG', 'Immutable Charge', 'ADDITIVE', 'FLAT') RETURNING id INTO v_charge;
    INSERT INTO service_specification (tenant_id, spec_code, spec_name) VALUES (v_tenant, 'IMM_SVC', 'Immutable Service') RETURNING id INTO v_service;
    INSERT INTO market_master (tenant_id, market_code, market_name, timezone, default_currency_code)
    VALUES (v_tenant, 'IMM_MKT', 'Immutable Market', 'Europe/London', 'USD') RETURNING id INTO v_market;
    INSERT INTO policy_schema (tenant_id, schema_name, version, schema_json)
    VALUES (v_tenant, 'IMM_SCHEMA', '1.0', '{"type":"object"}') RETURNING id INTO v_schema;
    INSERT INTO policy_rule (tenant_id, schema_id, rule_json) VALUES (v_tenant, v_schema, '{"segment":"B2B"}') RETURNING id INTO v_rule;

    -- Content is editable while the version is DRAFT
    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant, v_ver, v_spec, 'IMM_OFF', 'Immutable Offering', 'BASE', 'PREPAID') RETURNING id INTO v_off;
    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant, v_ver, v_spec, 'IMM_OTHER', 'Other Offering', 'ADDON', 'PREPAID') RETURNING id INTO v_other;
    INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES (v_tenant, v_off, v_charge);
    INSERT INTO offering_service_component (tenant_id, offering_id, service_spec_id) VALUES (v_tenant, v_off, v_service);
    INSERT INTO offering_rate (tenant_id, offering_id, charge_spec_id, market_id, currency_code, amount)
    VALUES (v_tenant, v_off, v_charge, v_market, 'USD', 10) RETURNING id INTO v_rate;
    INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id) VALUES (v_tenant, v_off, v_rule);
    UPDATE product_offering SET offering_name = 'Renamed While Draft' WHERE id = v_off;
    UPDATE offering_rate SET amount = 12 WHERE id = v_rate;
    UPDATE charge_specification SET charge_priority = 5 WHERE id = v_charge;

    -- TEST 1: an offering cannot be moved between versions
    BEGIN
        UPDATE product_offering SET catalogue_version_id = v_draft WHERE id = v_off;
        RAISE EXCEPTION 'TEST 1 Failed: Allowed moving an offering to another version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;

    UPDATE catalogue_version SET status = 'APPROVED' WHERE id = v_ver;

    -- TEST 2: content freezes at approval
    BEGIN
        UPDATE product_offering SET offering_name = 'Edited After Approval' WHERE id = v_off;
        RAISE EXCEPTION 'TEST 2 Failed: Allowed editing an offering in an APPROVED version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;

    UPDATE catalogue_version SET status = 'RELEASED' WHERE id = v_ver;

    -- TEST 3: offering insert / update / delete rejected in a RELEASED version
    BEGIN
        INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
        VALUES (v_tenant, v_ver, v_spec, 'LATE_OFF', 'Late Offering', 'BASE', 'PREPAID');
        RAISE EXCEPTION 'TEST 3a Failed: Allowed inserting into a RELEASED version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        UPDATE product_offering SET offering_name = 'Edited After Release' WHERE id = v_off;
        RAISE EXCEPTION 'TEST 3b Failed: Allowed updating an offering in a RELEASED version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        DELETE FROM product_offering WHERE id = v_off;
        RAISE EXCEPTION 'TEST 3c Failed: Allowed deleting an offering from a RELEASED version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;

    -- TEST 4: released rates cannot be re-priced or removed
    BEGIN
        UPDATE offering_rate SET amount = 99 WHERE id = v_rate;
        RAISE EXCEPTION 'TEST 4a Failed: Allowed re-pricing a released rate';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        DELETE FROM offering_rate WHERE id = v_rate;
        RAISE EXCEPTION 'TEST 4b Failed: Allowed deleting a released rate';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;

    -- TEST 5: other children of a released offering are frozen
    BEGIN
        DELETE FROM offering_charge_component WHERE tenant_id = v_tenant AND offering_id = v_off;
        RAISE EXCEPTION 'TEST 5a Failed: Allowed detaching a charge from a released offering';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        UPDATE offering_service_component SET max_qty = 5 WHERE tenant_id = v_tenant AND offering_id = v_off;
        RAISE EXCEPTION 'TEST 5b Failed: Allowed editing a service component of a released offering';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        INSERT INTO offering_market_mapping (tenant_id, offering_id, market_id, restriction) VALUES (v_tenant, v_off, v_market, 'EXCLUDE');
        RAISE EXCEPTION 'TEST 5c Failed: Allowed restricting a released offering';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type) VALUES (v_tenant, v_other, v_off, 'REQUIRES');
        RAISE EXCEPTION 'TEST 5d Failed: Allowed adding a relationship to a released offering';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        DELETE FROM policy_mapping WHERE tenant_id = v_tenant AND product_offering_id = v_off;
        RAISE EXCEPTION 'TEST 5e Failed: Allowed removing a policy from a released offering';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;

    -- TEST 6: definitions a released offering depends on are frozen
    BEGIN
        UPDATE product_specification SET spec_name = 'Renamed Spec' WHERE id = v_spec;
        RAISE EXCEPTION 'TEST 6a Failed: Allowed renaming a product specification used by a released version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        UPDATE charge_specification SET charge_priority = 1 WHERE id = v_charge;
        RAISE EXCEPTION 'TEST 6b Failed: Allowed re-prioritising a charge used by a released version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        UPDATE service_specification SET characteristics = '{"apn":"changed"}' WHERE id = v_service;
        RAISE EXCEPTION 'TEST 6c Failed: Allowed changing a service specification used by a released version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        UPDATE policy_rule SET rule_json = '{"segment":"B2C"}' WHERE id = v_rule;
        RAISE EXCEPTION 'TEST 6d Failed: Allowed rewriting a policy rule mapped to a released version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        UPDATE policy_schema SET schema_json = '{"type":"array"}' WHERE id = v_schema;
        RAISE EXCEPTION 'TEST 6e Failed: Allowed changing a policy schema that has rules bound to it';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    BEGIN
        DELETE FROM policy_rule WHERE id = v_rule;
        RAISE EXCEPTION 'TEST 6f Failed: Allowed deleting a policy rule mapped to a released version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;

    -- TEST 7: lifecycle fields of a frozen definition stay editable
    UPDATE product_specification SET status = 'RETIRED', effective_to = NOW() + INTERVAL '1 day' WHERE id = v_spec;

    -- TEST 8: overrides are still accepted against a released rate and do not mutate it
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from)
    VALUES (v_tenant, v_rate, 'SUBSCRIBER', 'SUB-1', 8, NOW() - INTERVAL '1 day');
    IF (SELECT amount FROM offering_rate WHERE id = v_rate) <> 12 THEN
        RAISE EXCEPTION 'TEST 8 Failed: the override mutated the released rate';
    END IF;

    -- TEST 9: a DRAFT version of the same catalogue is unaffected
    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant, v_draft, v_spec, 'IMM_OFF', 'Draft Copy', 'BASE', 'PREPAID') RETURNING id INTO v_off_draft;
    INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES (v_tenant, v_off_draft, v_charge);
    INSERT INTO offering_rate (tenant_id, offering_id, charge_spec_id, market_id, currency_code, amount)
    VALUES (v_tenant, v_off_draft, v_charge, v_market, 'USD', 15);
    IF (SELECT amount FROM offering_rate WHERE id = v_rate) <> 12 THEN
        RAISE EXCEPTION 'TEST 9 Failed: pricing the draft changed the released price';
    END IF;

    -- TEST 10: a released version cannot be deleted on its own; a draft can
    BEGIN
        DELETE FROM catalogue_version WHERE id = v_ver;
        RAISE EXCEPTION 'TEST 10a Failed: Allowed deleting a RELEASED version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;
    DELETE FROM catalogue_version WHERE id = v_draft;
    IF EXISTS (SELECT 1 FROM product_offering WHERE id = v_off_draft) THEN
        RAISE EXCEPTION 'TEST 10b Failed: deleting a draft version left its offerings behind';
    END IF;

    -- TEST 11: retiring keeps the content frozen
    UPDATE catalogue_version SET status = 'RETIRED' WHERE id = v_ver;
    BEGIN
        UPDATE offering_rate SET amount = 1 WHERE id = v_rate;
        RAISE EXCEPTION 'TEST 11 Failed: Allowed re-pricing a RETIRED version';
    EXCEPTION WHEN SQLSTATE 'CV001' THEN NULL;
    END;

    -- TEST 12: deleting the whole catalogue still cascades
    DELETE FROM catalogue WHERE id = v_cat;
    IF EXISTS (SELECT 1 FROM product_offering WHERE tenant_id = v_tenant)
       OR EXISTS (SELECT 1 FROM offering_rate WHERE tenant_id = v_tenant)
       OR EXISTS (SELECT 1 FROM policy_mapping WHERE tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'TEST 12 Failed: catalogue delete did not cascade through released content';
    END IF;

    RAISE NOTICE 'All tests for 019 passed successfully.';
END;
$$;
