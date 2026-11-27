# Constraints

Where each rule is enforced. "DB" means a constraint or trigger that holds for every writer. "Service" means application code that runs before the database so callers get a clear error.

| Rule | DB | Service | Test |
|---|---|---|---|
| Every catalogue table carries `tenant_id`; children reference parents by `(tenant_id, id)` composite FKs, so cross-tenant links are impossible | ✔ (003+) | queries always filter by tenant | test_003, tmf620 isolation tests |
| Catalogue version status only moves DRAFT → APPROVED → RELEASED → RETIRED | ✔ trigger (001) | `catalogueService.transition` | test_001, lifecycle tests |
| Version content is editable only while DRAFT | ✔ triggers (019), SQLSTATE `CV001` | `assertDraft` / `editableOffering` | test_019, lifecycle tests |
| Definitions used by a locked version are frozen (lifecycle fields excepted) | ✔ triggers (019) | — | test_019 |
| RELEASED/RETIRED versions cannot be deleted alone | ✔ trigger (019) | `deleteVersion` | test_019, lifecycle tests |
| One rate per offering + charge + market; a rate requires the charge to be attached | ✔ unique + FK (017) | `upsertRate` also requires a pricing market | test_008, lifecycle tests |
| Price overrides never mutate `offering_rate` | ✔ (separate table) | — | test_015, lifecycle tests |
| Override dates are ordered; no overlapping periods per scope | ✔ check (016) | row lock + overlap check | test_015, override race test |
| Charge kind is consistent: `RECURRING` ⇔ period present; known stacking/calculation values | ✔ checks (018) | zod enums | test_018 |
| Product spec status, offering type, payment type, relationship type, restriction values | ✔ checks | zod enums | test_002/008/009 |
| ISO 4217 currency codes | ✔ check + FK | zod | test_006 |
| IANA time zones | ✔ shape check | validated against the tz database | test_006/007, lifecycle tests |
| No circular market / category / REQUIRES-UPGRADE chains | functions `check_*_cycle` | called before writes, under an advisory lock | test_007/009/010, lifecycle tests |
| Policy rules conform to their schema | — (by design) | Ajv | unit + lifecycle tests |
| `updated_at` reflects the last change | ✔ trigger (018) | — | test_018 |
| Amounts fit `NUMERIC(16,6)` | ✔ type | zod: ≤10 integer, ≤6 fraction digits | lifecycle tests |

## Error mapping (HTTP)

| Cause | Status |
|---|---|
| Malformed input (bad UUID, date, JSON, unknown field) | 400 |
| Missing or invalid API key | 401 |
| Read-only key writing, or tenant header ≠ key tenant | 403 |
| Unknown resource, or a resource of another tenant | 404 |
| Locked version (`CV001`), duplicate, still referenced, invalid transition, overlap, cycle | 409 |
| Business validation (no rate, non-pricing market, policy schema violation) | 422 |
| Anything unexpected | 500, with a generic message; details go to the server log with the request id |
