DROP TRIGGER IF EXISTS trg_catalogue_version_status_check ON catalogue_version;
DROP FUNCTION IF EXISTS catalogue_version_status_check();

DROP TABLE IF EXISTS catalogue_version;
DROP TABLE IF EXISTS catalogue;
DROP TYPE IF EXISTS catalogue_status;
