-- 017_offering_rate_offering_scope.down.sql
--
-- Returns offering_rate to the (tenant_id, charge_spec_id, market_id) key. Where two offerings now
-- hold different prices for the same charge and market, only the earliest row can survive under the
-- old unique key; that is an unavoidable loss of the information this migration introduced.

ALTER TABLE offering_rate
    DROP CONSTRAINT IF EXISTS fk_offering_rate_charge_component,
    DROP CONSTRAINT IF EXISTS uq_offering_rate_offering_charge_market;

DROP INDEX IF EXISTS idx_offering_rate_offering;

ALTER TABLE offering_rate DROP COLUMN IF EXISTS offering_id;

-- Restore the rates (and their overrides) that were archived as unreachable.
INSERT INTO offering_rate
SELECT (jsonb_populate_record(NULL::offering_rate, a.rate_row)).*
  FROM offering_rate_orphan_archive a
 -- the charge or market may have been deleted since the rate was archived
 WHERE EXISTS (SELECT 1 FROM charge_specification c
                WHERE c.tenant_id = a.tenant_id AND c.id = (a.rate_row->>'charge_spec_id')::uuid)
   AND EXISTS (SELECT 1 FROM market_master m
                WHERE m.tenant_id = a.tenant_id AND m.id = (a.rate_row->>'market_id')::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO price_override
SELECT (jsonb_populate_record(NULL::price_override, o.elem)).*
  FROM offering_rate_orphan_archive a
 CROSS JOIN LATERAL jsonb_array_elements(a.override_rows) AS o(elem)
 WHERE EXISTS (SELECT 1 FROM offering_rate r WHERE r.tenant_id = a.tenant_id AND r.id = a.id)
ON CONFLICT (id) DO NOTHING;

-- Collapse per-offering duplicates back to one rate per charge and market (earliest wins).
DELETE FROM offering_rate r
 USING (SELECT id,
               ROW_NUMBER() OVER (PARTITION BY tenant_id, charge_spec_id, market_id ORDER BY created_at, id) AS rn
          FROM offering_rate) d
 WHERE d.id = r.id AND d.rn > 1;

ALTER TABLE offering_rate
    ADD CONSTRAINT uq_offering_rate_market UNIQUE (tenant_id, charge_spec_id, market_id);

DROP TABLE IF EXISTS offering_rate_orphan_archive;
