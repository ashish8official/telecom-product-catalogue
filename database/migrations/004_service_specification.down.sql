DROP TABLE IF EXISTS offering_service_component;
DROP TABLE IF EXISTS service_specification;
ALTER TABLE product_offering DROP CONSTRAINT IF EXISTS uq_product_offering_tenant_id;
