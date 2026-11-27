-- 017_offering_rate_offering_scope.up.sql
--
-- WHY: docs/domain-model.md states `offering_rate --FK--> offering_charge_component`, but the table
-- was keyed on (tenant_id, charge_spec_id, market_id) only. Because charge_specification is shared
-- across a tenant, two offerings using the same charge (e.g. "Monthly Recurring" on M2M_199 and
-- M2M_299) were forced to share one price, and rates had no link to a catalogue version, so editing a
-- rate silently re-priced released catalogues. This migration adds offering_id and a composite FK to
-- offering_charge_component, which makes every rate belong to exactly one offering (and therefore to
-- exactly one catalogue version). charge_spec_id is kept, so the existing documented FK still holds.
--
-- DATA: existing rates are attached to the offering(s) that use their charge. A rate whose charge is
-- used by several offerings is fanned out to one row per offering (overrides are copied with it, so
-- resolved prices do not change). Rates whose charge is not attached to any offering could never be
-- reached through an offering; they are moved to offering_rate_orphan_archive instead of being
-- dropped, and the rollback restores them.

CREATE TABLE offering_rate_orphan_archive (
    id            UUID PRIMARY KEY,          -- original offering_rate.id
    tenant_id     UUID NOT NULL,
    rate_row      JSONB NOT NULL,
    override_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    archived_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_offering_rate_orphan_archive_tenant ON offering_rate_orphan_archive(tenant_id);

ALTER TABLE offering_rate ADD COLUMN offering_id UUID;

-- 1. Archive and remove rates that no offering can reach.
INSERT INTO offering_rate_orphan_archive (id, tenant_id, rate_row, override_rows)
SELECT r.id,
       r.tenant_id,
       to_jsonb(r) - 'offering_id',
       COALESCE((SELECT jsonb_agg(to_jsonb(po))
                   FROM price_override po
                  WHERE po.tenant_id = r.tenant_id AND po.offering_rate_id = r.id), '[]'::jsonb)
  FROM offering_rate r
 WHERE NOT EXISTS (SELECT 1
                     FROM offering_charge_component occ
                    WHERE occ.tenant_id = r.tenant_id AND occ.charge_spec_id = r.charge_spec_id);

DELETE FROM offering_rate r
 USING offering_rate_orphan_archive a
 WHERE a.id = r.id;

-- 2. Attach the remaining rates to their offering(s).
ALTER TABLE offering_rate DROP CONSTRAINT uq_offering_rate_market;

CREATE TEMP TABLE _rate_fanout AS
SELECT r.id AS old_rate_id,
       occ.offering_id,
       ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY occ.created_at, occ.id) AS rn,
       gen_random_uuid() AS new_rate_id
  FROM offering_rate r
  JOIN offering_charge_component occ
    ON occ.tenant_id = r.tenant_id AND occ.charge_spec_id = r.charge_spec_id;

UPDATE offering_rate r
   SET offering_id = f.offering_id
  FROM _rate_fanout f
 WHERE f.old_rate_id = r.id AND f.rn = 1;

INSERT INTO offering_rate (id, tenant_id, charge_spec_id, market_id, currency_code, amount, created_at, updated_at, offering_id)
SELECT f.new_rate_id, r.tenant_id, r.charge_spec_id, r.market_id, r.currency_code, r.amount, r.created_at, r.updated_at, f.offering_id
  FROM _rate_fanout f
  JOIN offering_rate r ON r.id = f.old_rate_id
 WHERE f.rn > 1;

INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount,
                            effective_from, effective_to, created_at, updated_at)
SELECT po.tenant_id, f.new_rate_id, po.scope_type, po.scope_reference_id, po.override_amount,
       po.effective_from, po.effective_to, po.created_at, po.updated_at
  FROM _rate_fanout f
  JOIN price_override po ON po.offering_rate_id = f.old_rate_id
 WHERE f.rn > 1;

DROP TABLE _rate_fanout;

-- 3. Enforce the new shape.
ALTER TABLE offering_rate ALTER COLUMN offering_id SET NOT NULL;

ALTER TABLE offering_rate
    ADD CONSTRAINT uq_offering_rate_offering_charge_market
        UNIQUE (tenant_id, offering_id, charge_spec_id, market_id),
    ADD CONSTRAINT fk_offering_rate_charge_component
        FOREIGN KEY (tenant_id, offering_id, charge_spec_id)
        REFERENCES offering_charge_component (tenant_id, offering_id, charge_spec_id)
        ON DELETE CASCADE;

CREATE INDEX idx_offering_rate_offering ON offering_rate(offering_id);
