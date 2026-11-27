-- 018_charge_type_and_audit.up.sql
--
-- WHY (charge_type / charge_period): docs/domain-model.md lists charge_type as a key field of
-- charge_specification and docs/pricing-engine.md records as a known limitation that, without it,
-- the TMF620 adapter cannot tell a recurring charge from a one-time one and reports every flat
-- charge as "oneTime". charge_type states what kind of charge this is; charge_period is the
-- billing period and is required exactly when the charge is RECURRING. Existing rows default to
-- ONE_TIME, which is what the adapter was already reporting for them.
--
-- WHY (stacking_rule / calculation_type checks): both columns were free text although the engine
-- only understands ADDITIVE/OVERRIDE and FLAT/PERCENTAGE. An unknown value silently fell through to
-- "additive flat". The checks turn a typo into an error at write time.
--
-- WHY (updated_at trigger): every table carries updated_at but nothing maintained it, so it only
-- changed when application code remembered to set it. One generic trigger makes it trustworthy.

ALTER TABLE charge_specification
    ADD COLUMN charge_type   VARCHAR(20) NOT NULL DEFAULT 'ONE_TIME',
    ADD COLUMN charge_period VARCHAR(20);

ALTER TABLE charge_specification
    ADD CONSTRAINT chk_charge_spec_type
        CHECK (charge_type IN ('RECURRING', 'ONE_TIME', 'USAGE')),
    ADD CONSTRAINT chk_charge_spec_period
        CHECK (charge_period IS NULL OR charge_period IN ('DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR')),
    ADD CONSTRAINT chk_charge_spec_period_matches_type
        CHECK ((charge_type = 'RECURRING') = (charge_period IS NOT NULL)),
    ADD CONSTRAINT chk_charge_spec_stacking_rule
        CHECK (stacking_rule IN ('ADDITIVE', 'OVERRIDE')),
    ADD CONSTRAINT chk_charge_spec_calculation_type
        CHECK (calculation_type IN ('FLAT', 'PERCENTAGE'));

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOR v_table IN
        SELECT c.table_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
         WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_set_updated_at BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            v_table);
    END LOOP;
END;
$$;
