CREATE TABLE offering_relationship (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    source_offering_id UUID NOT NULL,
    target_offering_id UUID NOT NULL,
    relationship_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT chk_offering_rel_type CHECK (relationship_type IN ('REQUIRES', 'EXCLUDES', 'UPGRADE')),
    CONSTRAINT chk_offering_rel_self CHECK (source_offering_id != target_offering_id),
    CONSTRAINT uq_offering_rel_unique UNIQUE (tenant_id, source_offering_id, target_offering_id, relationship_type),
    CONSTRAINT fk_offering_rel_source FOREIGN KEY (tenant_id, source_offering_id) REFERENCES product_offering(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_offering_rel_target FOREIGN KEY (tenant_id, target_offering_id) REFERENCES product_offering(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_offering_rel_tenant ON offering_relationship(tenant_id);
CREATE INDEX idx_offering_rel_source ON offering_relationship(source_offering_id);
CREATE INDEX idx_offering_rel_target ON offering_relationship(target_offering_id);

CREATE OR REPLACE FUNCTION check_offering_relationship_cycle(
    p_tenant_id UUID,
    p_source_offering_id UUID,
    p_target_offering_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_cycle_detected BOOLEAN;
BEGIN
    WITH RECURSIVE dependency_path AS (
        SELECT 
            target_offering_id
        FROM offering_relationship
        WHERE tenant_id = p_tenant_id
          AND source_offering_id = p_target_offering_id
          AND relationship_type IN ('REQUIRES', 'UPGRADE')
          
        UNION
        
        SELECT 
            r.target_offering_id
        FROM offering_relationship r
        INNER JOIN dependency_path dp ON dp.target_offering_id = r.source_offering_id
        WHERE r.tenant_id = p_tenant_id
          AND r.relationship_type IN ('REQUIRES', 'UPGRADE')
    )
    SELECT EXISTS (
        SELECT 1 FROM dependency_path WHERE target_offering_id = p_source_offering_id
    ) INTO v_cycle_detected;

    RETURN COALESCE(v_cycle_detected, FALSE);
END;
$$ LANGUAGE plpgsql;
