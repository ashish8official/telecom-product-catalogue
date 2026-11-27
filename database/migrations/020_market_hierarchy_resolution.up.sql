-- 020_market_hierarchy_resolution.up.sql
--
-- WHY: markets form a hierarchy of arbitrary depth (GROUP > COUNTRY > CITY ...), but resolution
-- ignored it. Tax resolution walked the tree with one query per level and no cycle guard, rate
-- lookup did not walk it at all, and a MARKET price override only applied when the caller passed
-- the exact market the override was written for. market_ancestry() gives every resolver one
-- cycle-safe way to ask "this market and its ancestors, nearest first", and resolve_price() now uses
-- it so that an override written for Nigeria also applies to a subscriber in Lagos unless Lagos has
-- its own. The function signature is unchanged; callers are unaffected.
--
-- p_market_id stays VARCHAR because scope_reference_id is an opaque string: an exact match on the
-- supplied value is always tried first, the ancestor walk only happens when it is a market UUID.

CREATE OR REPLACE FUNCTION market_ancestry(p_tenant_id UUID, p_market_id UUID)
RETURNS TABLE (market_id UUID, depth INTEGER) AS $$
    WITH RECURSIVE chain AS (
        SELECT m.id, m.parent_market_id, 0 AS depth, ARRAY[m.id] AS path
          FROM market_master m
         WHERE m.tenant_id = p_tenant_id AND m.id = p_market_id

        UNION ALL

        SELECT p.id, p.parent_market_id, c.depth + 1, c.path || p.id
          FROM chain c
          JOIN market_master p ON p.tenant_id = p_tenant_id AND p.id = c.parent_market_id
         WHERE NOT (p.id = ANY (c.path))   -- a corrupt, cyclic hierarchy must never loop forever
    )
    SELECT chain.id, chain.depth FROM chain ORDER BY chain.depth;
$$ LANGUAGE sql STABLE;

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
    v_market_uuid UUID;
BEGIN
    -- 1. SUBSCRIBER (highest precedence)
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

    -- 2. ACCOUNT
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

    -- 3. MARKET: the requested market first, then its ancestors, nearest first
    IF p_market_id IS NOT NULL THEN
        IF p_market_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            v_market_uuid := p_market_id::uuid;
        END IF;

        SELECT po.override_amount INTO v_amount
        FROM price_override po
        JOIN (
            SELECT p_market_id::text AS ref, 0 AS depth
            UNION ALL
            SELECT a.market_id::text, a.depth
              FROM market_ancestry(p_tenant_id, v_market_uuid) a
             WHERE a.depth > 0
        ) chain ON chain.ref = po.scope_reference_id
        WHERE po.tenant_id = p_tenant_id
          AND po.offering_rate_id = p_offering_rate_id
          AND po.scope_type = 'MARKET'
          AND po.effective_from <= p_effective_at
          AND (po.effective_to IS NULL OR po.effective_to > p_effective_at)
        ORDER BY chain.depth ASC, po.effective_from DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN (v_amount, 'MARKET')::resolved_price_result;
        END IF;
    END IF;

    -- 4. Base catalogue rate
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
$$ LANGUAGE plpgsql STABLE;
