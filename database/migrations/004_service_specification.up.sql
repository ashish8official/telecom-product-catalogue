CREATE TABLE service_specification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    spec_code VARCHAR(100) NOT NULL,
    spec_name VARCHAR(255) NOT NULL,
    characteristics JSONB, -- NULL is valid when downstream provisioning owns its payload shape
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_service_spec_tenant_code UNIQUE (tenant_id, spec_code),
    CONSTRAINT uq_service_spec_tenant_id UNIQUE (tenant_id, id) -- For cross-tenant composite FK isolation
);

CREATE INDEX idx_service_spec_tenant ON service_specification(tenant_id);

-- Add unique constraint to product_offering so child tables can use composite cross-tenant FKs
ALTER TABLE product_offering ADD CONSTRAINT uq_product_offering_tenant_id UNIQUE (tenant_id, id);

CREATE TABLE offering_service_component (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    offering_id UUID NOT NULL,
    service_spec_id UUID NOT NULL,
    mandatory_flag BOOLEAN NOT NULL DEFAULT TRUE,
    min_qty INTEGER NOT NULL DEFAULT 1,
    max_qty INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_offering_service_component UNIQUE (tenant_id, offering_id, service_spec_id),
    CONSTRAINT offering_service_component_offering_fk FOREIGN KEY (tenant_id, offering_id) REFERENCES product_offering(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT offering_service_component_spec_fk FOREIGN KEY (tenant_id, service_spec_id) REFERENCES service_specification(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_offering_svc_comp_min_qty CHECK (min_qty >= 0),
    CONSTRAINT chk_offering_svc_comp_max_qty CHECK (max_qty >= min_qty),
    CONSTRAINT chk_offering_svc_comp_mandatory CHECK (mandatory_flag = TRUE OR min_qty = 0)
);

CREATE INDEX idx_offering_svc_comp_tenant ON offering_service_component(tenant_id);
CREATE INDEX idx_offering_svc_comp_offering ON offering_service_component(offering_id);
CREATE INDEX idx_offering_svc_comp_spec ON offering_service_component(service_spec_id);
