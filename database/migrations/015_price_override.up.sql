ALTER TABLE offering_rate ADD CONSTRAINT uq_offering_rate_tenant UNIQUE (tenant_id, id);

CREATE TABLE price_override (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    offering_rate_id UUID NOT NULL,
    scope_type VARCHAR(50) NOT NULL,
    scope_reference_id VARCHAR(255) NOT NULL,
    override_amount NUMERIC(16,6) NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT chk_price_override_scope CHECK (scope_type IN ('SUBSCRIBER', 'ACCOUNT', 'MARKET')),
    CONSTRAINT chk_price_override_amount CHECK (override_amount >= 0),
    CONSTRAINT fk_price_override_rate FOREIGN KEY (tenant_id, offering_rate_id) REFERENCES offering_rate(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_price_override_tenant ON price_override(tenant_id);
CREATE INDEX idx_price_override_rate ON price_override(offering_rate_id);
CREATE INDEX idx_price_override_lookup ON price_override(tenant_id, offering_rate_id, scope_type, scope_reference_id);



-- Resolution function
CREATE TYPE resolved_price_result AS (
    amount NUMERIC(16,6),
    source VARCHAR(50)
);

CREATE OR REPLACE FUNCTION resolve_price(
    p_tenant_id UUID,
    p_offering_rate_id UUID,
    p_subscriber_id VARCHAR(255),
    p_account_id VARCHAR(255),
    p_market_id VARCHAR(255),
    p_effective_at TIMESTAMPTZ
) RETURNS resolved_price_result AS $$
DECLARE
    v_amount NUMERIC(16,6);
    v_source VARCHAR(50);
BEGIN
    -- 1. Try SUBSCRIBER
    IF p_subscriber_id IS NOT NULL THEN
        SELECT override_amount INTO v_amount
        FROM price_override
        WHERE tenant_id = p_tenant_id
          AND offering_rate_id = p_offering_rate_id
          AND scope_type = 'SUBSCRIBER'
          AND scope_reference_id = p_subscriber_id
          AND effective_from <= p_effective_at
          AND (effective_to IS NULL OR effective_to > p_effective_at)
        LIMIT 1;

        IF FOUND THEN
            RETURN (v_amount, 'SUBSCRIBER')::resolved_price_result;
        END IF;
    END IF;

    -- 2. Try ACCOUNT
    IF p_account_id IS NOT NULL THEN
        SELECT override_amount INTO v_amount
        FROM price_override
        WHERE tenant_id = p_tenant_id
          AND offering_rate_id = p_offering_rate_id
          AND scope_type = 'ACCOUNT'
          AND scope_reference_id = p_account_id
          AND effective_from <= p_effective_at
          AND (effective_to IS NULL OR effective_to > p_effective_at)
        LIMIT 1;

        IF FOUND THEN
            RETURN (v_amount, 'ACCOUNT')::resolved_price_result;
        END IF;
    END IF;

    -- 3. Try MARKET
    IF p_market_id IS NOT NULL THEN
        SELECT override_amount INTO v_amount
        FROM price_override
        WHERE tenant_id = p_tenant_id
          AND offering_rate_id = p_offering_rate_id
          AND scope_type = 'MARKET'
          AND scope_reference_id = p_market_id
          AND effective_from <= p_effective_at
          AND (effective_to IS NULL OR effective_to > p_effective_at)
        LIMIT 1;

        IF FOUND THEN
            RETURN (v_amount, 'MARKET')::resolved_price_result;
        END IF;
    END IF;

    -- 4. Fallback to base offering_rate
    SELECT amount INTO v_amount
    FROM offering_rate
    WHERE tenant_id = p_tenant_id
      AND id = p_offering_rate_id;

    IF FOUND THEN
        RETURN (v_amount, 'CATALOGUE_RATE')::resolved_price_result;
    ELSE
        RETURN (NULL, 'NOT_FOUND')::resolved_price_result;
    END IF;
END;
$$ LANGUAGE plpgsql;
