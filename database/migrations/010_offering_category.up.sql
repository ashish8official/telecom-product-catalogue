CREATE TABLE offering_category (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_category_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_category_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_category_self_parent CHECK (id != parent_category_id),
    CONSTRAINT fk_category_parent FOREIGN KEY (tenant_id, parent_category_id) REFERENCES offering_category(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_category_tenant ON offering_category(tenant_id);
CREATE INDEX idx_category_parent ON offering_category(parent_category_id);

CREATE TABLE offering_category_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_offering_id UUID NOT NULL,
    category_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_category_mapping UNIQUE (tenant_id, product_offering_id, category_id),
    CONSTRAINT fk_mapping_offering FOREIGN KEY (tenant_id, product_offering_id) REFERENCES product_offering(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_mapping_category FOREIGN KEY (tenant_id, category_id) REFERENCES offering_category(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_mapping_tenant ON offering_category_mapping(tenant_id);
CREATE INDEX idx_mapping_offering ON offering_category_mapping(product_offering_id);
CREATE INDEX idx_mapping_category ON offering_category_mapping(category_id);

CREATE OR REPLACE FUNCTION check_category_cycle(
    p_tenant_id UUID,
    p_category_id UUID,
    p_parent_category_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_cycle_detected BOOLEAN;
BEGIN
    IF p_parent_category_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- We want to check if setting parent_category_id = p_parent_category_id creates a cycle.
    -- Meaning, is p_category_id an ancestor of p_parent_category_id?
    WITH RECURSIVE ancestor_path AS (
        -- Base case: start from the proposed parent
        SELECT 
            parent_category_id, id
        FROM offering_category
        WHERE tenant_id = p_tenant_id
          AND id = p_parent_category_id
          
        UNION
        
        -- Recursive case: go up the tree
        SELECT 
            c.parent_category_id, c.id
        FROM offering_category c
        INNER JOIN ancestor_path ap ON c.id = ap.parent_category_id
        WHERE c.tenant_id = p_tenant_id
    )
    SELECT EXISTS (
        SELECT 1 FROM ancestor_path WHERE id = p_category_id
    ) INTO v_cycle_detected;

    RETURN COALESCE(v_cycle_detected, FALSE);
END;
$$ LANGUAGE plpgsql;
