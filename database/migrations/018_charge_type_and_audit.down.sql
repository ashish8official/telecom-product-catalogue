-- 018_charge_type_and_audit.down.sql

DO $$
DECLARE
    v_row RECORD;
BEGIN
    FOR v_row IN
        SELECT tg.tgname, cls.relname
          FROM pg_trigger tg
          JOIN pg_class cls ON cls.oid = tg.tgrelid
          JOIN pg_proc p ON p.oid = tg.tgfoid
         WHERE NOT tg.tgisinternal AND p.proname = 'set_updated_at'
    LOOP
        EXECUTE format('DROP TRIGGER %I ON %I', v_row.tgname, v_row.relname);
    END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS set_updated_at();

ALTER TABLE charge_specification
    DROP CONSTRAINT IF EXISTS chk_charge_spec_calculation_type,
    DROP CONSTRAINT IF EXISTS chk_charge_spec_stacking_rule,
    DROP CONSTRAINT IF EXISTS chk_charge_spec_period_matches_type,
    DROP CONSTRAINT IF EXISTS chk_charge_spec_period,
    DROP CONSTRAINT IF EXISTS chk_charge_spec_type,
    DROP COLUMN IF EXISTS charge_period,
    DROP COLUMN IF EXISTS charge_type;
