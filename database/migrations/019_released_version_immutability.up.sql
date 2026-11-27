-- 019_released_version_immutability.up.sql
--
-- WHY: "Catalogue version is immutable after release" was only enforced on the catalogue_version
-- row itself (migration 001) and, for two endpoints, in the service layer. Nothing stopped an
-- offering, rate, component or mapping that belongs to an APPROVED/RELEASED/RETIRED version from
-- being changed, and nothing stopped a tenant-level definition (product/charge/service
-- specification, policy rule) that a released offering depends on from being rewritten underneath
-- it. These triggers make the invariant hold for every writer, exactly like the status trigger from
-- migration 001 already does for the version row. The service layer still checks first so callers
-- get a friendly error; this is the backstop.
--
-- Rules:
--   * Version content (offerings and everything hanging off an offering) is writable only while
--     its catalogue version is DRAFT.
--   * A definition referenced by an offering in a non-DRAFT version cannot have its meaning changed.
--     Lifecycle fields (status, effective dates) stay editable.
--   * Deleting a whole catalogue still cascades (tenant off-boarding, test clean-up); deleting a
--     RELEASED/RETIRED version on its own is refused.
--   * price_override is deliberately NOT guarded: overrides are runtime commercial terms that are
--     added against released rates. offering_category_mapping is not guarded either: category is
--     presentation only.
--
-- All violations raise SQLSTATE 'CV001' so the API can map them to HTTP 409.

CREATE OR REPLACE FUNCTION assert_catalogue_version_writable(
    p_tenant_id UUID,
    p_version_id UUID,
    p_table TEXT,
    p_op TEXT
) RETURNS VOID AS $$
DECLARE
    v_status catalogue_status;
BEGIN
    SELECT status INTO v_status
      FROM catalogue_version
     WHERE tenant_id = p_tenant_id AND id = p_version_id;

    -- No row: the version is being deleted in this statement (cascade) or does not exist yet,
    -- in which case the foreign key reports the real problem.
    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Catalogue version is %: % on % is not allowed. Only DRAFT versions can be edited; create a new version instead.',
            v_status, p_op, p_table
            USING ERRCODE = 'CV001';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_offering_writable(
    p_tenant_id UUID,
    p_offering_id UUID,
    p_table TEXT,
    p_op TEXT
) RETURNS VOID AS $$
DECLARE
    v_version_id UUID;
BEGIN
    SELECT catalogue_version_id INTO v_version_id
      FROM product_offering
     WHERE tenant_id = p_tenant_id AND id = p_offering_id;

    IF NOT FOUND THEN
        RETURN; -- parent offering already removed by the same cascade
    END IF;

    PERFORM assert_catalogue_version_writable(p_tenant_id, v_version_id, p_table, p_op);
END;
$$ LANGUAGE plpgsql;

-- product_offering ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_product_offering_write()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.tenant_id <> OLD.tenant_id THEN
            RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = 'CV001';
        END IF;
        IF NEW.catalogue_version_id <> OLD.catalogue_version_id THEN
            RAISE EXCEPTION 'An offering cannot be moved to another catalogue version' USING ERRCODE = 'CV001';
        END IF;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM assert_catalogue_version_writable(OLD.tenant_id, OLD.catalogue_version_id, TG_TABLE_NAME, TG_OP);
    END IF;
    IF TG_OP = 'INSERT' THEN
        PERFORM assert_catalogue_version_writable(NEW.tenant_id, NEW.catalogue_version_id, TG_TABLE_NAME, TG_OP);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_product_offering_guard
BEFORE INSERT OR UPDATE OR DELETE ON product_offering
FOR EACH ROW EXECUTE FUNCTION guard_product_offering_write();

-- everything that hangs off an offering -----------------------------------------------------------
-- TG_ARGV[0] is the name of the column holding the owning offering id.
CREATE OR REPLACE FUNCTION guard_offering_child_write()
RETURNS TRIGGER AS $$
DECLARE
    v_col TEXT := TG_ARGV[0];
    v_old JSONB;
    v_new JSONB;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old := to_jsonb(OLD);
        PERFORM assert_offering_writable((v_old->>'tenant_id')::uuid, (v_old->>v_col)::uuid, TG_TABLE_NAME, TG_OP);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new := to_jsonb(NEW);
        PERFORM assert_offering_writable((v_new->>'tenant_id')::uuid, (v_new->>v_col)::uuid, TG_TABLE_NAME, TG_OP);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offering_service_component_guard
BEFORE INSERT OR UPDATE OR DELETE ON offering_service_component
FOR EACH ROW EXECUTE FUNCTION guard_offering_child_write('offering_id');

CREATE TRIGGER trg_offering_charge_component_guard
BEFORE INSERT OR UPDATE OR DELETE ON offering_charge_component
FOR EACH ROW EXECUTE FUNCTION guard_offering_child_write('offering_id');

CREATE TRIGGER trg_offering_rate_guard
BEFORE INSERT OR UPDATE OR DELETE ON offering_rate
FOR EACH ROW EXECUTE FUNCTION guard_offering_child_write('offering_id');

CREATE TRIGGER trg_offering_market_mapping_guard
BEFORE INSERT OR UPDATE OR DELETE ON offering_market_mapping
FOR EACH ROW EXECUTE FUNCTION guard_offering_child_write('offering_id');

CREATE TRIGGER trg_offering_relationship_guard
BEFORE INSERT OR UPDATE OR DELETE ON offering_relationship
FOR EACH ROW EXECUTE FUNCTION guard_offering_child_write('source_offering_id');

CREATE TRIGGER trg_policy_mapping_guard
BEFORE INSERT OR UPDATE OR DELETE ON policy_mapping
FOR EACH ROW EXECUTE FUNCTION guard_offering_child_write('product_offering_id');

-- catalogue_version delete ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_catalogue_version_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('RELEASED', 'RETIRED')
       AND EXISTS (SELECT 1 FROM catalogue WHERE tenant_id = OLD.tenant_id AND id = OLD.catalogue_id) THEN
        RAISE EXCEPTION 'A % catalogue version cannot be deleted', OLD.status USING ERRCODE = 'CV001';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_catalogue_version_delete_guard
BEFORE DELETE ON catalogue_version
FOR EACH ROW EXECUTE FUNCTION guard_catalogue_version_delete();

-- definitions referenced by locked versions ---------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_product_specification_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tenant_id <> OLD.tenant_id THEN
        RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = 'CV001';
    END IF;
    IF (NEW.spec_code, NEW.spec_name) IS DISTINCT FROM (OLD.spec_code, OLD.spec_name)
       AND EXISTS (SELECT 1
                     FROM product_offering po
                     JOIN catalogue_version cv ON cv.tenant_id = po.tenant_id AND cv.id = po.catalogue_version_id
                    WHERE po.tenant_id = OLD.tenant_id
                      AND po.product_specification_id = OLD.id
                      AND cv.status <> 'DRAFT') THEN
        RAISE EXCEPTION 'Product specification % is used by an approved or released catalogue version; its code and name are frozen', OLD.spec_code
            USING ERRCODE = 'CV001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_product_specification_guard
BEFORE UPDATE ON product_specification
FOR EACH ROW EXECUTE FUNCTION guard_product_specification_update();

CREATE OR REPLACE FUNCTION guard_charge_specification_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tenant_id <> OLD.tenant_id THEN
        RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = 'CV001';
    END IF;
    IF (NEW.charge_code, NEW.charge_name, NEW.charge_priority, NEW.stacking_rule, NEW.calculation_type, NEW.charge_type, NEW.charge_period)
           IS DISTINCT FROM
       (OLD.charge_code, OLD.charge_name, OLD.charge_priority, OLD.stacking_rule, OLD.calculation_type, OLD.charge_type, OLD.charge_period)
       AND EXISTS (SELECT 1
                     FROM offering_charge_component occ
                     JOIN product_offering po ON po.tenant_id = occ.tenant_id AND po.id = occ.offering_id
                     JOIN catalogue_version cv ON cv.tenant_id = po.tenant_id AND cv.id = po.catalogue_version_id
                    WHERE occ.tenant_id = OLD.tenant_id
                      AND occ.charge_spec_id = OLD.id
                      AND cv.status <> 'DRAFT') THEN
        RAISE EXCEPTION 'Charge specification % is used by an approved or released catalogue version and is frozen', OLD.charge_code
            USING ERRCODE = 'CV001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_charge_specification_guard
BEFORE UPDATE ON charge_specification
FOR EACH ROW EXECUTE FUNCTION guard_charge_specification_update();

CREATE OR REPLACE FUNCTION guard_service_specification_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tenant_id <> OLD.tenant_id THEN
        RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = 'CV001';
    END IF;
    IF (NEW.spec_code, NEW.spec_name, NEW.characteristics) IS DISTINCT FROM (OLD.spec_code, OLD.spec_name, OLD.characteristics)
       AND EXISTS (SELECT 1
                     FROM offering_service_component osc
                     JOIN product_offering po ON po.tenant_id = osc.tenant_id AND po.id = osc.offering_id
                     JOIN catalogue_version cv ON cv.tenant_id = po.tenant_id AND cv.id = po.catalogue_version_id
                    WHERE osc.tenant_id = OLD.tenant_id
                      AND osc.service_spec_id = OLD.id
                      AND cv.status <> 'DRAFT') THEN
        RAISE EXCEPTION 'Service specification % is used by an approved or released catalogue version and is frozen', OLD.spec_code
            USING ERRCODE = 'CV001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_service_specification_guard
BEFORE UPDATE ON service_specification
FOR EACH ROW EXECUTE FUNCTION guard_service_specification_update();

CREATE OR REPLACE FUNCTION guard_policy_rule_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tenant_id <> OLD.tenant_id THEN
        RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = 'CV001';
    END IF;
    IF (NEW.rule_json, NEW.schema_id) IS DISTINCT FROM (OLD.rule_json, OLD.schema_id)
       AND EXISTS (SELECT 1
                     FROM policy_mapping pm
                     JOIN product_offering po ON po.tenant_id = pm.tenant_id AND po.id = pm.product_offering_id
                     JOIN catalogue_version cv ON cv.tenant_id = po.tenant_id AND cv.id = po.catalogue_version_id
                    WHERE pm.tenant_id = OLD.tenant_id
                      AND pm.policy_rule_id = OLD.id
                      AND cv.status <> 'DRAFT') THEN
        RAISE EXCEPTION 'Policy rule is mapped to an approved or released catalogue version and is frozen'
            USING ERRCODE = 'CV001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_rule_guard
BEFORE UPDATE ON policy_rule
FOR EACH ROW EXECUTE FUNCTION guard_policy_rule_update();

-- A policy schema is versioned: once a rule is bound to it, structural changes need a new version.
CREATE OR REPLACE FUNCTION guard_policy_schema_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tenant_id <> OLD.tenant_id THEN
        RAISE EXCEPTION 'Cannot change tenant_id' USING ERRCODE = 'CV001';
    END IF;
    IF (NEW.schema_json, NEW.schema_name, NEW.version) IS DISTINCT FROM (OLD.schema_json, OLD.schema_name, OLD.version)
       AND EXISTS (SELECT 1 FROM policy_rule pr WHERE pr.tenant_id = OLD.tenant_id AND pr.schema_id = OLD.id) THEN
        RAISE EXCEPTION 'Policy schema % version % already has rules bound to it; create a new schema version instead',
            OLD.schema_name, OLD.version
            USING ERRCODE = 'CV001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_schema_guard
BEFORE UPDATE ON policy_schema
FOR EACH ROW EXECUTE FUNCTION guard_policy_schema_update();
