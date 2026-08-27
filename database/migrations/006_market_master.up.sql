CREATE TABLE currency_master (
    currency_code CHAR(3) PRIMARY KEY,
    currency_name VARCHAR(100) NOT NULL,
    CONSTRAINT chk_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$')
);

CREATE TABLE market_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    market_code VARCHAR(100) NOT NULL,
    market_name VARCHAR(255) NOT NULL,
    parent_market_id UUID,
    timezone VARCHAR(100) NOT NULL,
    default_currency_code CHAR(3) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_market_master_code UNIQUE(tenant_id, market_code),
    CONSTRAINT uq_market_master_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT market_master_parent_fk FOREIGN KEY (tenant_id, parent_market_id) REFERENCES market_master(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT market_master_currency_fk FOREIGN KEY (default_currency_code) REFERENCES currency_master(currency_code) ON DELETE RESTRICT,
    CONSTRAINT chk_market_timezone_iana CHECK (timezone ~ '^[A-Za-z_]+/[A-Za-z_]+(/.+)?$') -- Rejects 'IST', requires Area/City
);

CREATE INDEX idx_market_master_tenant ON market_master(tenant_id);
CREATE INDEX idx_market_master_parent ON market_master(parent_market_id);

-- Function for the service layer to call to check for cycles before assigning a parent
CREATE OR REPLACE FUNCTION check_market_cycle(p_market_id UUID, p_new_parent_id UUID) 
RETURNS BOOLEAN AS $$
DECLARE
    v_has_cycle BOOLEAN;
BEGIN
    -- If setting to NULL, no cycle is possible
    IF p_new_parent_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- A market cannot be its own parent
    IF p_market_id = p_new_parent_id THEN
        RETURN TRUE;
    END IF;

    -- Walk up the tree from the proposed new parent to see if we hit p_market_id
    WITH RECURSIVE market_tree AS (
        SELECT id, parent_market_id
        FROM market_master
        WHERE id = p_new_parent_id
        
        UNION ALL
        
        SELECT m.id, m.parent_market_id
        FROM market_master m
        JOIN market_tree mt ON m.id = mt.parent_market_id
    )
    SELECT EXISTS (
        SELECT 1 FROM market_tree WHERE id = p_market_id
    ) INTO v_has_cycle;
    
    RETURN v_has_cycle;
END;
$$ LANGUAGE plpgsql;
