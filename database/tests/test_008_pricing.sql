-- Tests for 008_pricing_engine
DO $$
DECLARE
    v_tenant_id UUID := gen_random_uuid();
    v_catalogue_id UUID;
    v_version_id UUID;
    v_product_spec_id UUID;
    v_offering_id UUID;
    v_charge_spec_id UUID;
    v_market_id UUID;
    v_market_id_2 UUID;
BEGIN
    -- 1. Setup Data
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_id, 'Pricing Test Cat') RETURNING id INTO v_catalogue_id;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_id, v_catalogue_id, 'v1') RETURNING id INTO v_version_id;
    
    INSERT INTO product_specification (tenant_id, spec_code, spec_name, status) 
    VALUES (v_tenant_id, 'PRICING_SPEC', 'Pricing Spec', 'ACTIVE') RETURNING id INTO v_product_spec_id;

    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant_id, v_version_id, v_product_spec_id, 'PRICING_OFF', 'Pricing Off', 'BASE', 'PREPAID') RETURNING id INTO v_offering_id;

    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, charge_priority, stacking_rule, calculation_type)
    VALUES (v_tenant_id, 'CHARGE_PR', 'Charge PR', 100, 'ADDITIVE', 'FLAT') RETURNING id INTO v_charge_spec_id;

    INSERT INTO currency_master (currency_code, currency_name) VALUES ('USD', 'US Dollar') ON CONFLICT DO NOTHING;

    INSERT INTO market_master (tenant_id, market_code, market_name, timezone, default_currency_code)
    VALUES (v_tenant_id, 'MKT_1', 'Market 1', 'America/New_York', 'USD') RETURNING id INTO v_market_id;

    INSERT INTO market_master (tenant_id, market_code, market_name, timezone, default_currency_code)
    VALUES (v_tenant_id, 'MKT_2', 'Market 2', 'America/New_York', 'USD') RETURNING id INTO v_market_id_2;


    -- 2. Test offering_rate (Unique rate-per-market enforced)
    INSERT INTO offering_rate (tenant_id, charge_spec_id, market_id, currency_code, amount)
    VALUES (v_tenant_id, v_charge_spec_id, v_market_id, 'USD', 0.001500);

    BEGIN
        INSERT INTO offering_rate (tenant_id, charge_spec_id, market_id, currency_code, amount)
        VALUES (v_tenant_id, v_charge_spec_id, v_market_id, 'USD', 0.002000);
        RAISE EXCEPTION 'TEST FAILED: Allowed duplicate rate for the same market';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- Valid for a different market
    INSERT INTO offering_rate (tenant_id, charge_spec_id, market_id, currency_code, amount)
    VALUES (v_tenant_id, v_charge_spec_id, v_market_id_2, 'USD', 0.002000);


    -- 3. Test offering_market_mapping (EXCLUDE restricts, INCLUDE works)
    INSERT INTO offering_market_mapping (tenant_id, offering_id, market_id, restriction)
    VALUES (v_tenant_id, v_offering_id, v_market_id, 'EXCLUDE');

    -- Restriction CHECK test
    BEGIN
        INSERT INTO offering_market_mapping (tenant_id, offering_id, market_id, restriction)
        VALUES (v_tenant_id, v_offering_id, v_market_id_2, 'INVALID');
        RAISE EXCEPTION 'TEST FAILED: Allowed invalid restriction value';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- UNIQUE mapping per offering/market
    BEGIN
        INSERT INTO offering_market_mapping (tenant_id, offering_id, market_id, restriction)
        VALUES (v_tenant_id, v_offering_id, v_market_id, 'INCLUDE');
        RAISE EXCEPTION 'TEST FAILED: Allowed duplicate market mapping for same offering';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    RAISE NOTICE 'All tests for 008 (DB constraints) passed successfully.';
END;
$$;
