CREATE TABLE policy_schema (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    schema_name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    schema_json JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_policy_schema_version UNIQUE (tenant_id, schema_name, version),
    CONSTRAINT uq_policy_schema_tenant UNIQUE (tenant_id, id)
);

CREATE INDEX idx_policy_schema_tenant ON policy_schema(tenant_id);

CREATE TABLE policy_rule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    schema_id UUID NOT NULL,
    rule_json JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_policy_rule_tenant UNIQUE (tenant_id, id),
    CONSTRAINT fk_policy_rule_schema FOREIGN KEY (tenant_id, schema_id) REFERENCES policy_schema(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_policy_rule_tenant ON policy_rule(tenant_id);
CREATE INDEX idx_policy_rule_schema ON policy_rule(schema_id);

CREATE TABLE policy_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_offering_id UUID NOT NULL,
    policy_rule_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_policy_mapping UNIQUE (tenant_id, product_offering_id, policy_rule_id),
    CONSTRAINT fk_policy_mapping_offering FOREIGN KEY (tenant_id, product_offering_id) REFERENCES product_offering(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_policy_mapping_rule FOREIGN KEY (tenant_id, policy_rule_id) REFERENCES policy_rule(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_policy_mapping_tenant ON policy_mapping(tenant_id);
CREATE INDEX idx_policy_mapping_offering ON policy_mapping(product_offering_id);
CREATE INDEX idx_policy_mapping_rule ON policy_mapping(policy_rule_id);
