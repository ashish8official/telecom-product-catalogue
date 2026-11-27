-- 020_market_hierarchy_resolution.down.sql
-- Restores resolve_price() exactly as migration 016 left it and removes market_ancestry().

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
    -- 1. Try SUBSCRIBER (highest precedence)
    IF p_subscriber_id IS NOT NULL THEN
        SELECT override_amount INTO v_amount
        FROM price_override
        WHERE tenant_id = p_tenant_id
          AND offering_rate_id = p_offering_rate_id
          AND scope_type = 'SUBSCRIBER'
          AND scope_reference_id = p_subscriber_id
          AND effective_from <= p_effective_at
          AND (effective_to IS NULL OR effective_to > p_effective_at)
        ORDER BY effective_from DESC
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
        ORDER BY effective_from DESC
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
        ORDER BY effective_from DESC
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

DROP FUNCTION IF EXISTS market_ancestry(UUID, UUID);
