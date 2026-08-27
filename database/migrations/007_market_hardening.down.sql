-- 007_market_hardening.down.sql

ALTER TABLE market_master
    DROP CONSTRAINT IF EXISTS chk_market_self_parent,
    DROP CONSTRAINT IF EXISTS chk_market_effective_dates,
    DROP CONSTRAINT IF EXISTS chk_market_type,
    DROP CONSTRAINT IF EXISTS chk_market_status;

-- Note: When altering columns back to NOT NULL, they will fail if any existing rows have NULLs.
-- This rollback assumes data has been cleaned up or you're starting fresh.
-- If you need a fully safe rollback, you'd update NULLs to a dummy value first.
UPDATE market_master SET timezone = 'UTC/Rollback' WHERE timezone IS NULL;
UPDATE market_master SET default_currency_code = 'USD' WHERE default_currency_code IS NULL;

ALTER TABLE market_master
    ALTER COLUMN timezone SET NOT NULL,
    ALTER COLUMN default_currency_code SET NOT NULL,
    DROP COLUMN IF EXISTS market_type,
    DROP COLUMN IF EXISTS is_pricing_market,
    DROP COLUMN IF EXISTS effective_from,
    DROP COLUMN IF EXISTS effective_to,
    DROP COLUMN IF EXISTS status;
