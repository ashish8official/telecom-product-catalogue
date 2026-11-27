# Telecom Product Catalogue Engine

A standalone, multi-tenant, multi-market product catalogue for telecom BSS. It defines what can be sold, to whom, where and for how much. It exposes that over the **TM Forum TMF620 v5** API, so any CRM, order-management or billing system can consume it without knowing the internal schema.

It does not track subscribers, usage or provisioning. Those belong to other systems.

```
 External CRM / OM / BSS ──TMF620──▶ TMF620 adapter (translation only)
 Admin console ─────────internal──▶ internal API
                                        │
                     services: lifecycle, editing rules, resolution engine
                                        │
                     PostgreSQL: tenant-safe FKs, immutability triggers, resolve_price()
```

## What it does

- **Catalogue versions**: DRAFT → APPROVED → RELEASED → RETIRED. Content freezes at approval, and database triggers enforce it for every writer. New versions are cloned from the current one. Releasing a version supersedes the previous one without editing it.
- **Offerings**: product specification, provisioning services, charges, per-market rates, market restrictions, relationships (requires / excludes / upgrade), eligibility policies, categories.
- **Pricing**: rates per offering, charge and market, falling back up the market tree (a country rate prices its cities). Overrides resolve subscriber › account › market › catalogue and never change the catalogue rate. Charges stack by priority and can be flat or a percentage of the preceding subtotal. Tax and GL codes come per line. Money arithmetic is exact (no floats).
- **Eligibility**: hierarchy-aware market restrictions (no mapping means allowed; EXCLUDE covers children; INCLUDE carves out) and JSON-Schema-validated policy rules, evaluated in the market's time zone.
- **TMF620**: `productSpecification`, `productOffering`, `productOfferingPrice`, `catalog`, `category`, with TMF630 paging, `fields` selection and the TMF error shape.
- **Multi-tenancy**: `tenant_id` on every row and composite foreign keys. With API keys configured, the key decides the tenant and role (admin or read-only).
- **Two UIs**, served by the API with no build step: an **admin console** (`/admin/`) for the whole lifecycle plus a price simulator, and a **viewer** (`/viewer/`) that behaves like an external CRM and uses only TMF620.

## Quick start (local PostgreSQL)

Requirements: Node.js 20+ and PostgreSQL 14+.

```bash
cd backend
npm ci
```

```bash
cp .env.example .env
```

Edit `.env` with your database connection, then:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm start
```

Open <http://localhost:3000/admin/> and <http://localhost:3000/viewer/>. The port comes from `PORT` in `.env`; the code default is 8080.

### Existing database created before the migration runner

If the tables already exist but there is no `schema_migrations` table, record what is already applied once, then migrate:

```bash
npm run db:baseline -- 016
```

```bash
npm run db:migrate
```

Back up first (`pg_dump -Fc`). `npm run db:rollback -- 4` reverts migrations 017–020 if needed.

### Docker

```bash
cp .env.example .env
```

```bash
docker compose up --build
```

```bash
docker compose exec api npm run db:seed
```

## Using the API

Development mode (no `API_KEYS`) identifies the tenant with a header:

```bash
curl -H "x-tenant-id: 17000000-0000-4000-a000-000000000000" "http://localhost:3000/productCatalogManagement/v5/productOffering"
```

The price of every charge of M2M Basic in Lagos, for a subscriber with a negotiated price:

```bash
curl -H "x-tenant-id: 17000000-0000-4000-a000-000000000000" "http://localhost:3000/productCatalogManagement/v5/productOfferingPrice?productOffering.id=17000000-0000-4000-a000-000000000012&marketId=17000000-0000-4000-a000-000000000004&subscriberId=SUB-NGA-001"
```

Full resolution (eligibility, policy, stacking, tax, GL, totals):

```bash
curl -X POST -H "x-tenant-id: 17000000-0000-4000-a000-000000000000" -H "content-type: application/json" -d '{"offering_id":"17000000-0000-4000-a000-000000000024","market_id":"17000000-0000-4000-a000-000000000004","context":{"account_category":"CORPORATE"}}' http://localhost:3000/api/internal/quote
```

In production, set `API_KEYS` (see `backend/.env.example`) and send `x-api-key: <key>` instead of the tenant header.

## Commands (in `backend/`)

| Command | What it does |
|---|---|
| `npm start` | Run the API and UIs |
| `npm test` | Unit and API tests (Jest) against the isolated `catalogue_test` database, which is created, migrated and seeded automatically |
| `npm run test:db` | SQL constraint tests (`database/tests`), each rolled back |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` / `db:rollback [n]` / `db:status` | Migrations |
| `npm run db:verify-rollback` | Apply → revert → re-apply every migration on a scratch database |
| `npm run db:seed` | Load the demo tenants (`docs/seed-fixture.md`) |
| `npm run smoke -- <url>` | Post-deploy checks against a running server |

## Repository layout

```
backend/    app.ts, server.ts, config.ts
            api/tmf620     TMF620 adapter (translation only)
            api/internal   admin API
            services/      lifecycle, editing rules, resolution engine
            repositories/  tenant-scoped SQL
            domain/        ResolutionContext, exact money arithmetic
            db/            pool, migration runner
            tests/         unit + integration (supertest)
database/   migrations/ (NNN_name.up.sql + .down.sql), tests/, seeds/
frontend/   catalogue-admin/, catalogue-viewer/, shared/
docs/       architecture, domain model, constraints, pricing, resolution, markets, policy, TMF alignment, seed
docker/     Dockerfile
```

## Documentation

- [Architecture](docs/architecture.md)
- [Domain model](docs/domain-model.md)
- [Constraints and where they are enforced](docs/constraints.md)
- [Pricing engine](docs/pricing-engine.md) · [Resolution engine](docs/resolution-engine.md)
- [Market resolution](docs/market-resolution.md) · [Policy engine](docs/policy-engine.md)
- [TMF620 alignment](docs/tmforum-alignment.md) · [Seed fixture](docs/seed-fixture.md)
- [AGENTS.md](AGENTS.md): the architecture rules this code follows
