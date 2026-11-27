-- Tests for 020_market_hierarchy_resolution
DO $$
DECLARE
    v_tenant UUID := gen_random_uuid();
    v_africa UUID;
    v_nigeria UUID;
    v_lagos UUID;
    v_kenya UUID;
    v_cat UUID;
    v_ver UUID;
    v_spec UUID;
    v_off UUID;
    v_charge UUID;
    v_rate UUID;
    v_depths INTEGER[];
    v_ids UUID[];
    v_result resolved_price_result;
BEGIN
    INSERT INTO currency_master (currency_code, currency_name) VALUES ('NGN', 'Nigerian Naira') ON CONFLICT DO NOTHING;

    INSERT INTO market_master (tenant_id, market_code, market_name, market_type, is_pricing_market)
    VALUES (v_tenant, 'AFR', 'Africa', 'GROUP', FALSE) RETURNING id INTO v_africa;
    INSERT INTO market_master (tenant_id, market_code, market_name, parent_market_id, timezone, default_currency_code)
    VALUES (v_tenant, 'NGA', 'Nigeria', v_africa, 'Africa/Lagos', 'NGN') RETURNING id INTO v_nigeria;
    INSERT INTO market_master (tenant_id, market_code, market_name, parent_market_id, market_type, timezone, default_currency_code)
    VALUES (v_tenant, 'LAGOS', 'Lagos', v_nigeria, 'CITY', 'Africa/Lagos', 'NGN') RETURNING id INTO v_lagos;
    INSERT INTO market_master (tenant_id, market_code, market_name, parent_market_id, timezone, default_currency_code)
    VALUES (v_tenant, 'KEN', 'Kenya', v_africa, 'Africa/Nairobi', 'NGN') RETURNING id INTO v_kenya;

    -- TEST 1: ancestry is nearest-first and stops at the root
    SELECT array_agg(market_id ORDER BY depth), array_agg(depth ORDER BY depth)
      INTO v_ids, v_depths
      FROM market_ancestry(v_tenant, v_lagos);
    IF v_ids <> ARRAY[v_lagos, v_nigeria, v_africa] OR v_depths <> ARRAY[0, 1, 2] THEN
        RAISE EXCEPTION 'TEST 1 Failed: unexpected ancestry % / %', v_ids, v_depths;
    END IF;

    -- TEST 2: unknown market and other tenants return nothing
    IF EXISTS (SELECT 1 FROM market_ancestry(v_tenant, gen_random_uuid()))
       OR EXISTS (SELECT 1 FROM market_ancestry(gen_random_uuid(), v_lagos)) THEN
        RAISE EXCEPTION 'TEST 2 Failed: ancestry leaked across tenants or invented a market';
    END IF;

    -- TEST 3: a corrupt cycle terminates instead of looping forever
    UPDATE market_master SET parent_market_id = v_lagos WHERE id = v_africa;
    IF (SELECT count(*) FROM market_ancestry(v_tenant, v_lagos)) <> 3 THEN
        RAISE EXCEPTION 'TEST 3 Failed: cyclic hierarchy was not cut off';
    END IF;
    UPDATE market_master SET parent_market_id = NULL WHERE id = v_africa;

    -- Pricing fixture
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant, 'Hierarchy Cat') RETURNING id INTO v_cat;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant, v_cat, 'v1') RETURNING id INTO v_ver;
    INSERT INTO product_specification (tenant_id, spec_code, spec_name) VALUES (v_tenant, 'H_SPEC', 'Hierarchy Spec') RETURNING id INTO v_spec;
    INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
    VALUES (v_tenant, v_ver, v_spec, 'H_OFF', 'Hierarchy Offering', 'BASE', 'POSTPAID') RETURNING id INTO v_off;
    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type)
    VALUES (v_tenant, 'H_CHG', 'Hierarchy Charge', 'ADDITIVE', 'FLAT') RETURNING id INTO v_charge;
    INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES (v_tenant, v_off, v_charge);
    INSERT INTO offering_rate (tenant_id, offering_id, charge_spec_id, market_id, currency_code, amount)
    VALUES (v_tenant, v_off, v_charge, v_nigeria, 'NGN', 1299) RETURNING id INTO v_rate;

    -- Override written for the country
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from)
    VALUES (v_tenant, v_rate, 'MARKET', v_nigeria::text, 1099, NOW() - INTERVAL '1 day');

    -- TEST 4: a city inherits its country's market override
    v_result := resolve_price(v_tenant, v_rate, NULL, NULL, v_lagos::text, NOW());
    IF v_result.amount <> 1099 OR v_result.source <> 'MARKET' THEN
        RAISE EXCEPTION 'TEST 4 Failed: expected inherited 1099 MARKET, got % %', v_result.amount, v_result.source;
    END IF;

    -- TEST 5: the nearest market wins over an ancestor
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from)
    VALUES (v_tenant, v_rate, 'MARKET', v_lagos::text, 999, NOW() - INTERVAL '1 day');
    v_result := resolve_price(v_tenant, v_rate, NULL, NULL, v_lagos::text, NOW());
    IF v_result.amount <> 999 THEN
        RAISE EXCEPTION 'TEST 5 Failed: expected Lagos override 999, got %', v_result.amount;
    END IF;

    -- TEST 6: a sibling market does not inherit
    v_result := resolve_price(v_tenant, v_rate, NULL, NULL, v_kenya::text, NOW());
    IF v_result.source <> 'CATALOGUE_RATE' THEN
        RAISE EXCEPTION 'TEST 6 Failed: Kenya picked up a Nigerian override (%)', v_result.source;
    END IF;

    -- TEST 7: non-UUID opaque market references still match exactly
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from)
    VALUES (v_tenant, v_rate, 'MARKET', 'LEGACY-NG', 777, NOW() - INTERVAL '1 day');
    v_result := resolve_price(v_tenant, v_rate, NULL, NULL, 'LEGACY-NG', NOW());
    IF v_result.amount <> 777 THEN
        RAISE EXCEPTION 'TEST 7 Failed: opaque market reference not matched, got %', v_result.amount;
    END IF;

    -- TEST 8: precedence is unchanged; subscriber still beats market
    INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from)
    VALUES (v_tenant, v_rate, 'SUBSCRIBER', 'SUB-1', 500, NOW() - INTERVAL '1 day');
    v_result := resolve_price(v_tenant, v_rate, 'SUB-1', NULL, v_lagos::text, NOW());
    IF v_result.amount <> 500 OR v_result.source <> 'SUBSCRIBER' THEN
        RAISE EXCEPTION 'TEST 8 Failed: expected 500 SUBSCRIBER, got % %', v_result.amount, v_result.source;
    END IF;

    RAISE NOTICE 'All tests for 020 passed successfully.';
END;
$$;
