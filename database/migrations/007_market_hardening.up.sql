-- 007_market_hardening.up.sql

ALTER TABLE market_master 
    ADD COLUMN market_type VARCHAR(50) NOT NULL DEFAULT 'COUNTRY',
    ADD COLUMN is_pricing_market BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN effective_from TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN effective_to TIMESTAMPTZ,
    ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    ALTER COLUMN timezone DROP NOT NULL,
    ALTER COLUMN default_currency_code DROP NOT NULL;

ALTER TABLE market_master
    ADD CONSTRAINT chk_market_self_parent CHECK (id != parent_market_id),
    ADD CONSTRAINT chk_market_effective_dates CHECK (effective_to IS NULL OR effective_to > effective_from),
    ADD CONSTRAINT chk_market_type CHECK (market_type IN ('GROUP', 'COUNTRY', 'REGION', 'CITY', 'ZONE')),
    ADD CONSTRAINT chk_market_status CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED', 'OBSOLETE'));
