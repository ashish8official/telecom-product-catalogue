# Policy Engine

Eligibility policies decide who may buy an offering. They are data, not code.

## Storage

| Table | Role |
|---|---|
| `policy_schema` | A JSON Schema describing the *shape* of rules (versioned by `schema_name` + `version`) |
| `policy_rule` | The rule data, e.g. `{"account_category": "CORPORATE"}`, bound to one schema |
| `policy_mapping` | Attaches rules to offerings |

## Validation (write time)

Policy JSON is never accepted without validation against its `policy_schema` record (AGENTS.md):

- Creating a schema compiles it with Ajv. An invalid JSON Schema is rejected with 422.
- Creating or updating a rule validates `rule_json` against its schema. Every violation is reported with 422.
- Validation lives in the service layer (`services/policyValidator.ts`), not in database triggers.
- Once a rule is bound to a schema, that schema version is frozen (migration 019). A structural change needs a new schema version, so existing rules stay valid against the schema they were written for.
- A rule mapped to an approved or released offering is frozen too.

## Evaluation (resolve time)

`resolve_policy(db, context, mode = 'ALL')`:

- Each top-level key of a rule must equal the same key in the runtime `context_json` (strict equality).
- `time_window: { start: "HH:mm", end: "HH:mm" }` is evaluated in the **market's IANA time zone**, never the server's. Windows may cross midnight (`22:00`–`06:00`).
- `ALL` (default): every mapped rule must pass. `ANY`: at least one must.
- An offering without policies is eligible for everyone.

The quote endpoint returns every evaluated check (`expected`, `actual`, `passed`), so a CRM can explain a rejection.

## Boundaries

- Markets come from `market_master`. Policies never duplicate market or region hierarchies.
- No priorities or lifecycle states live inside policy tables.
- Richer operators (ranges, sets) would be added in `resolve_policy`. The schema/rule split already allows them without a migration.
