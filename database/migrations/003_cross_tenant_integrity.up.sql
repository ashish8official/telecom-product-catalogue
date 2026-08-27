-- 1. Add UNIQUE (tenant_id, id) to parent tables to support composite FKs
ALTER TABLE catalogue ADD CONSTRAINT uq_catalogue_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE catalogue_version ADD CONSTRAINT uq_catalogue_version_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE product_specification ADD CONSTRAINT uq_product_specification_tenant_id UNIQUE (tenant_id, id);

-- 2. Drop existing simple FKs
ALTER TABLE catalogue_version DROP CONSTRAINT catalogue_version_catalogue_id_fkey;
ALTER TABLE product_offering DROP CONSTRAINT product_offering_catalogue_version_id_fkey;
ALTER TABLE product_offering DROP CONSTRAINT product_offering_product_specification_id_fkey;

-- 3. Add composite FKs ensuring tenant_id matches
ALTER TABLE catalogue_version
    ADD CONSTRAINT catalogue_version_catalogue_tenant_fk 
    FOREIGN KEY (tenant_id, catalogue_id) REFERENCES catalogue(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE product_offering
    ADD CONSTRAINT product_offering_catalogue_version_tenant_fk
    FOREIGN KEY (tenant_id, catalogue_version_id) REFERENCES catalogue_version(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE product_offering
    ADD CONSTRAINT product_offering_product_specification_tenant_fk
    FOREIGN KEY (tenant_id, product_specification_id) REFERENCES product_specification(tenant_id, id) ON DELETE RESTRICT;

-- 4. Add status check constraint
-- Aligned with TMF standards (Active, Draft, Retired, Obsolete)
ALTER TABLE product_specification
    ADD CONSTRAINT chk_product_spec_status 
    CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED', 'OBSOLETE'));
