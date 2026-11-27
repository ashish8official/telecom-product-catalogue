-- Tests for 018_charge_type_and_audit
DO $$
DECLARE
    v_tenant UUID := gen_random_uuid();
    v_id UUID;
    v_type TEXT;
    v_before TIMESTAMPTZ;
    v_after TIMESTAMPTZ;
BEGIN
    -- TEST 1: insert without charge_type defaults to ONE_TIME with no period
    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type)
    VALUES (v_tenant, 'ACTIVATION', 'Activation Fee', 'ADDITIVE', 'FLAT') RETURNING id, charge_type INTO v_id, v_type;
    IF v_type <> 'ONE_TIME' THEN
        RAISE EXCEPTION 'TEST 1 Failed: default charge_type was %', v_type;
    END IF;

    -- TEST 2: RECURRING requires a period
    BEGIN
        INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_type)
        VALUES (v_tenant, 'RC_NO_PERIOD', 'Recurring without period', 'ADDITIVE', 'FLAT', 'RECURRING');
        RAISE EXCEPTION 'TEST 2 Failed: Allowed RECURRING charge without a period';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- TEST 3: a period is only allowed on a RECURRING charge
    BEGIN
        INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_type, charge_period)
        VALUES (v_tenant, 'OT_WITH_PERIOD', 'One-time with period', 'ADDITIVE', 'FLAT', 'ONE_TIME', 'MONTH');
        RAISE EXCEPTION 'TEST 3 Failed: Allowed a period on a ONE_TIME charge';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- TEST 4: valid recurring charge
    INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_type, charge_period)
    VALUES (v_tenant, 'RC_MONTHLY', 'Monthly Recurring', 'ADDITIVE', 'FLAT', 'RECURRING', 'MONTH');

    -- TEST 5: unknown enum-like values are rejected
    BEGIN
        INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_type)
        VALUES (v_tenant, 'BAD_TYPE', 'Bad', 'ADDITIVE', 'FLAT', 'SOMETIMES');
        RAISE EXCEPTION 'TEST 5a Failed: Allowed unknown charge_type';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_type, charge_period)
        VALUES (v_tenant, 'BAD_PERIOD', 'Bad', 'ADDITIVE', 'FLAT', 'RECURRING', 'FORTNIGHT');
        RAISE EXCEPTION 'TEST 5b Failed: Allowed unknown charge_period';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type)
        VALUES (v_tenant, 'BAD_STACK', 'Bad', 'ADDITVE', 'FLAT');
        RAISE EXCEPTION 'TEST 5c Failed: Allowed misspelled stacking_rule';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type)
        VALUES (v_tenant, 'BAD_CALC', 'Bad', 'ADDITIVE', 'PERCENT');
        RAISE EXCEPTION 'TEST 5d Failed: Allowed unknown calculation_type';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- TEST 6: updated_at is maintained by the database, not the caller
    UPDATE charge_specification SET updated_at = '2000-01-01T00:00:00Z' WHERE id = v_id;
    SELECT updated_at INTO v_before FROM charge_specification WHERE id = v_id;
    IF v_before < NOW() - INTERVAL '1 minute' THEN
        RAISE EXCEPTION 'TEST 6 Failed: caller was able to backdate updated_at to %', v_before;
    END IF;
    UPDATE charge_specification SET charge_name = 'Activation Fee (renamed)' WHERE id = v_id;
    SELECT updated_at INTO v_after FROM charge_specification WHERE id = v_id;
    IF v_after IS NULL OR v_after < v_before THEN
        RAISE EXCEPTION 'TEST 6 Failed: updated_at did not advance on update';
    END IF;

    RAISE NOTICE 'All tests for 018 passed successfully.';
END;
$$;
