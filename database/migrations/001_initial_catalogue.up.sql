CREATE TYPE catalogue_status AS ENUM ('DRAFT', 'APPROVED', 'RELEASED', 'RETIRED');

CREATE TABLE catalogue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_catalogue_tenant_id ON catalogue(tenant_id);

CREATE TABLE catalogue_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    catalogue_id UUID NOT NULL REFERENCES catalogue(id) ON DELETE CASCADE,
    version VARCHAR(50) NOT NULL,
    status catalogue_status NOT NULL DEFAULT 'DRAFT',
    valid_from TIMESTAMPTZ,
    valid_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (catalogue_id, version)
);
CREATE INDEX idx_catalogue_version_tenant_id ON catalogue_version(tenant_id);

CREATE OR REPLACE FUNCTION catalogue_version_status_check()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent changing tenant_id
    IF OLD.tenant_id != NEW.tenant_id THEN
        RAISE EXCEPTION 'Cannot change tenant_id';
    END IF;

    -- Prevent edits to RELEASED row except transition to RETIRED
    IF OLD.status = 'RELEASED' THEN
        IF NEW.status = 'RETIRED' THEN
            -- Only allow status (and updated_at) to change.
            IF OLD.version != NEW.version OR 
               OLD.valid_from IS DISTINCT FROM NEW.valid_from OR 
               OLD.valid_to IS DISTINCT FROM NEW.valid_to OR
               OLD.catalogue_id != NEW.catalogue_id THEN
                RAISE EXCEPTION 'Cannot edit data fields of a RELEASED catalogue version, only status to RETIRED';
            END IF;
        ELSE
            RAISE EXCEPTION 'Cannot edit a RELEASED catalogue version except to RETIRE it';
        END IF;
    END IF;

    -- Prevent edits to RETIRED row completely
    IF OLD.status = 'RETIRED' THEN
        RAISE EXCEPTION 'Cannot edit a RETIRED catalogue version';
    END IF;

    -- Ensure status only moves forward
    IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'APPROVED', 'RETIRED') THEN
        RAISE EXCEPTION 'Invalid status transition from DRAFT';
    END IF;
    IF OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED', 'RELEASED', 'RETIRED') THEN
        RAISE EXCEPTION 'Invalid status transition from APPROVED';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_catalogue_version_status_check
BEFORE UPDATE ON catalogue_version
FOR EACH ROW
EXECUTE FUNCTION catalogue_version_status_check();
