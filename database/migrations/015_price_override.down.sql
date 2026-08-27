DROP FUNCTION IF EXISTS resolve_price;
DROP TYPE IF EXISTS resolved_price_result;


DROP TABLE IF EXISTS price_override;

ALTER TABLE offering_rate DROP CONSTRAINT IF EXISTS uq_offering_rate_tenant;
