# Architecture

A modular monolith on PostgreSQL. The TMF620 adapter is the only externally facing seam (AGENTS.md).

```
  External CRM / OM / BSS ──TMF620 JSON──▶ api/tmf620  (translation only)
  Catalogue admin UI ──────internal JSON──▶ api/internal
  Catalogue viewer UI ──────TMF620 JSON──▶ api/tmf620
                                              │
                        services/   business rules, lifecycle, resolution engine
                                              │
                        repositories/   tenant-scoped SQL, no rules
                                              │
                        PostgreSQL   constraints, immutability triggers, resolve_price()
```

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| HTTP platform | `backend/app.ts`, `backend/http/` | request id, JSON access log, security headers, CORS, tenant/auth context, validation (zod), error mapping |
| TMF620 adapter | `backend/api/tmf620/` | Maps internal rows ↔ `ProductSpecification`, `ProductOffering`, `ProductOfferingPrice`, `Catalog`, `Category`. No business logic, and no internal field names in output |
| Internal API | `backend/api/internal/` | Admin console API in the engine's own model |
| Services | `backend/services/` | Version lifecycle, editing rules, reference data, price overrides, resolution engine |
| Domain | `backend/domain/` | `ResolutionContext`, exact money arithmetic |
| Repositories | `backend/repositories/` | SQL. Every statement is filtered by `tenant_id` |
| Database | `database/` | Migrations (with rollbacks), SQL constraint tests, seed |
| UIs | `frontend/` | Static, no build step, served by the API on the same origin |

## Tenancy and authentication

Row-based tenancy: `tenant_id` on every catalogue table, composite FKs, and no cross-tenant joins.

- **Production** (`API_KEYS` set; required when `NODE_ENV=production`): every request presents a key (`x-api-key` or `Authorization: Bearer`). The key determines the tenant and role (`admin` or `reader`). A conflicting `x-tenant-id` header is rejected with 403, and readers cannot write.
- **Development** (no keys): the `x-tenant-id` header is trusted and the caller is admin.

## Catalogue versions

- Content belongs to a version and is editable only while DRAFT. The rules are enforced by both the service layer and database triggers (migration 019).
- **Published** means: per catalogue, the RELEASED version with the latest `valid_from` that is in force. TMF620 reads default to published content. A specific version can be read with `x-catalogue-version-id`.
- A new version is usually created as a clone of the current one, edited, approved, then released. Releasing it supersedes the previous version without touching it.

## Operations

| Concern | How |
|---|---|
| Migrations | `npm run db:migrate`: checksummed, transactional, advisory-locked; `db:rollback`, `db:status`, `db:baseline` |
| Rollback proof | `npm run db:verify-rollback`: applies all, reverts all, re-applies all on a scratch database |
| Health | `GET /health` (liveness), `GET /ready` (database reachable) |
| Logs | JSON lines on stdout/stderr with request id, status, duration and tenant |
| Shutdown | SIGTERM/SIGINT stop accepting connections, drain, close the pool |
| Smoke | `npm run smoke -- <baseUrl>` after a deploy |
| CI | `.github/workflows/ci.yml`: typecheck, rollback proof, SQL tests, Jest |

## Deliberately not here (AGENTS.md)

No Kafka, Kubernetes, microservice split or event sourcing. Subscriber state, usage and provisioning execution belong to other systems.
