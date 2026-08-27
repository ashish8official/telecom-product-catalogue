-- Tests for 001_initial_catalogue

DO $$
DECLARE
    v_catalogue_id UUID;
    v_version_id UUID;
    v_tenant_id UUID := gen_random_uuid();
BEGIN
    -- Setup
    INSERT INTO catalogue (tenant_id, name) VALUES (v_tenant_id, 'Test Catalogue') RETURNING id INTO v_catalogue_id;
    INSERT INTO catalogue_version (tenant_id, catalogue_id, version) VALUES (v_tenant_id, v_catalogue_id, 'v1.0') RETURNING id INTO v_version_id;

    -- Test 1: tenant_id enforced (Cannot insert without tenant_id)
    BEGIN
        INSERT INTO catalogue (name) VALUES ('No Tenant Catalogue');
        RAISE EXCEPTION 'Test 1 Failed: Allowed insert without tenant_id';
    EXCEPTION WHEN not_null_violation THEN
        -- Expected
    END;

    -- Test 2: Status only moves forward (DRAFT -> RELEASED directly should fail)
    BEGIN
        UPDATE catalogue_version SET status = 'RELEASED' WHERE id = v_version_id;
        RAISE EXCEPTION 'Test 2 Failed: Allowed invalid transition DRAFT -> RELEASED';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM != 'Invalid status transition from DRAFT' THEN
            RAISE;
        END IF;
    END;

    -- Test 3: Status moves forward (DRAFT -> APPROVED works)
    UPDATE catalogue_version SET status = 'APPROVED' WHERE id = v_version_id;
    
    -- Test 4: Status moves forward (APPROVED -> RELEASED works)
    UPDATE catalogue_version SET status = 'RELEASED' WHERE id = v_version_id;

    -- Test 5: Released version rejects edits to data fields (status remains RELEASED)
    BEGIN
        UPDATE catalogue_version SET version = 'v1.1' WHERE id = v_version_id;
        RAISE EXCEPTION 'Test 5 Failed: Allowed editing data of RELEASED version';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM != 'Cannot edit a RELEASED catalogue version except to RETIRE it' THEN
            RAISE;
        END IF;
    END;

    -- Test 6: Released version rejects edits to status other than RETIRED
    BEGIN
        UPDATE catalogue_version SET status = 'DRAFT' WHERE id = v_version_id;
        RAISE EXCEPTION 'Test 6 Failed: Allowed invalid transition from RELEASED';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM != 'Cannot edit a RELEASED catalogue version except to RETIRE it' THEN
            RAISE;
        END IF;
    END;

    -- Test 7: Released version allows transition to RETIRED
    UPDATE catalogue_version SET status = 'RETIRED' WHERE id = v_version_id;

    -- Test 8: Retired version rejects all edits
    BEGIN
        UPDATE catalogue_version SET status = 'RELEASED' WHERE id = v_version_id;
        RAISE EXCEPTION 'Test 8 Failed: Allowed editing RETIRED version';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM != 'Cannot edit a RETIRED catalogue version' THEN
            RAISE;
        END IF;
    END;

    RAISE NOTICE 'All tests passed successfully.';
END;
$$;
