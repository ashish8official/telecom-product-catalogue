CREATE TABLE charge_specification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    charge_code VARCHAR(100) NOT NULL,
    charge_name VARCHAR(255) NOT NULL,
    charge_priority INTEGER NOT NULL DEFAULT 100,
    stacking_rule VARCHAR(50) NOT NULL, -- e.g., 'ADDITIVE', 'OVERRIDE'
    calculation_type VARCHAR(50) NOT NULL, -- e.g., 'FLAT', 'PERCENTAGE'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_charge_spec_tenant_code UNIQUE (tenant_id, charge_code),
    CONSTRAINT uq_charge_spec_tenant_id UNIQUE (tenant_id, id) -- For cross-tenant composite FK isolation
);

CREATE INDEX idx_charge_spec_tenant ON charge_specification(tenant_id);

CREATE TABLE offering_charge_component (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    offering_id UUID NOT NULL,
    charge_spec_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_offering_charge_component UNIQUE (tenant_id, offering_id, charge_spec_id),
    CONSTRAINT offering_charge_component_offering_fk FOREIGN KEY (tenant_id, offering_id) REFERENCES product_offering(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT offering_charge_component_spec_fk FOREIGN KEY (tenant_id, charge_spec_id) REFERENCES charge_specification(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_offering_charge_comp_tenant ON offering_charge_component(tenant_id);
CREATE INDEX idx_offering_charge_comp_offering ON offering_charge_component(offering_id);
CREATE INDEX idx_offering_charge_comp_spec ON offering_charge_component(charge_spec_id);
