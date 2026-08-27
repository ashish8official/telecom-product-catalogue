ALTER TABLE product_specification DROP CONSTRAINT chk_product_spec_status;

ALTER TABLE product_offering DROP CONSTRAINT product_offering_product_specification_tenant_fk;
ALTER TABLE product_offering DROP CONSTRAINT product_offering_catalogue_version_tenant_fk;
ALTER TABLE catalogue_version DROP CONSTRAINT catalogue_version_catalogue_tenant_fk;

-- Restore simple FKs
ALTER TABLE catalogue_version
    ADD CONSTRAINT catalogue_version_catalogue_id_fkey FOREIGN KEY (catalogue_id) REFERENCES catalogue(id) ON DELETE CASCADE;
ALTER TABLE product_offering
    ADD CONSTRAINT product_offering_catalogue_version_id_fkey FOREIGN KEY (catalogue_version_id) REFERENCES catalogue_version(id) ON DELETE CASCADE;
ALTER TABLE product_offering
    ADD CONSTRAINT product_offering_product_specification_id_fkey FOREIGN KEY (product_specification_id) REFERENCES product_specification(id) ON DELETE RESTRICT;

ALTER TABLE product_specification DROP CONSTRAINT uq_product_specification_tenant_id;
ALTER TABLE catalogue_version DROP CONSTRAINT uq_catalogue_version_tenant_id;
ALTER TABLE catalogue DROP CONSTRAINT uq_catalogue_tenant_id;
