# AGENTS.md — Telecom Product Catalogue Engine (v2)

You are an implementation agent working inside a bounded task. You do not own architecture decisions — this document does. Read it fully before touching any file. This supersedes any earlier AGENTS.md.

## What this system is

A **standalone, plug-and-play** multi-tenant, multi-market Product Catalogue Engine. It defines commercial configuration (what can be sold, to whom, where, for how much) and exposes it over TM Forum Open APIs so that *any* external CRM, Order Management, or BSS — ours or a third party's — can consume it without knowing our internal schema. It does not track subscriber state, usage, or provisioning execution.

## Two-layer architecture — this is now the central rule

```
        External CRM / OM / any BSS
                     │
                     ▼  (TMF620 REST JSON only)
        ┌─────────────────────────────┐
        │   TMF620 API Adapter Layer   │   ← translation only, no business logic
        └──────────────┬───────────────┘
                        ▼
        ┌─────────────────────────────┐
        │   Internal Domain Model +    │   ← our actual engine, free to be
        │   Resolution Engine          │     shaped however serves it best
        └─────────────────────────────┘
```

- The **internal domain model** (catalogue_version, product_offering, service_specification, charge_specification, offering_rate, price_override, market_master, etc.) is our engine's own concern. It is not required to look like TMF JSON, and should not be contorted to match it.
- The **TMF620 adapter layer** is the only thing external systems ever see. It maps internal state to `ProductSpecification` / `ProductOffering` / `ProductOfferingPrice` on the way out, and TMF620-shaped requests to internal writes on the way in.
- Never let API-layer JSON shape leak backward into the database schema. Never let internal table names leak forward into API responses.

## Non-negotiable principles

1. **Catalogue defines commercial configuration, not subscriber state.**
2. **Product and price are separate.** `ProductOffering → ChargeSpecification (internal) → RateCode → OfferingRate`, exposed externally as `ProductOffering → ProductOfferingPrice`.
3. **`product_specification` is the true root of the product domain** — per TM Forum SID / TMF620 v5.0.0. `product_offering` rows (e.g. M2M_199, M2M_299) reference a parent `product_specification` (e.g. M2M_CONNECTIVITY). This is not the same concept as `service_specification` or `charge_specification` — those are internal engine constructs, not TMF entities, and must never be named or documented as if they were siblings of `product_specification`.
4. **Service provisioning and financial charging are separate branches** under an offering; neither is `product_specification`.
5. **Market ≠ timezone ≠ currency**, always IANA timezones, ISO 4217 currency codes. Market hierarchy must not assume a fixed depth — some markets won't nest continent→country→city.
6. **Category is presentation only.** No pricing/billing/provisioning/eligibility meaning.
7. **Catalogue version is immutable after release.** `Draft → Approved → Released → Retired`.
8. **Price overrides never mutate `offering_rate`.** Resolved at runtime: `Subscriber → Account → Market → Catalogue Rate`.
9. **Tenancy is row-based**, `tenant_id` on every catalogue table, no cross-tenant joins, written as if RLS already enforced it.
10. **No entity is TMF-shaped by assumption.** If a task requires exposing something externally, it goes through the adapter layer — it does not change the internal table.

## Resolved defaults (do not re-litigate)

- **Market restriction default:** no mapping row = allowed. Only `EXCLUDE` rows restrict.
- **Circular relationship protection:** recursive CTE cycle check in a DB function, called from the service layer (not a trigger).
- **Policy JSON:** never accepted without validation against a `policy_schema` record.
- **Charge stacking:** deterministic by `charge_priority` ascending.

## Working rules for you, the agent

- One bounded task at a time, exactly as scoped. No adjacent "helpful" additions.
- Never invent columns, tables, or endpoints not in `docs/domain-model.md`. Flag gaps instead of guessing.
- Every schema change ships with migration, rollback, constraint tests, and a one-paragraph "why" note.
- Show the diff before considering a task done.
- No Kafka, no Kubernetes, no microservices split, no event sourcing at this stage — modular monolith on PostgreSQL, with the adapter layer as the only externally-facing seam.
- Tests are part of the task, not a follow-up.

## Repository layout

```
telecom-product-catalogue/
├── docs/            architecture.md, domain-model.md, constraints.md, pricing-engine.md,
│                    policy-engine.md, market-resolution.md, tmforum-alignment.md, scenarios/
├── database/        migrations/, seeds/, functions/, tests/
├── backend/
│   ├── domain/      internal model — offerings, charges, rates, overrides, engine
│   ├── services/
│   ├── repositories/
│   ├── api/
│   │   ├── tmf620/  adapter layer — TMF620 JSON in/out ONLY, no business logic
│   │   └── internal/  (optional, non-TMF endpoints for our own admin UI if ever needed)
│   └── tests/
├── frontend/        catalogue-admin/, catalogue-viewer/
├── integrations/    provisioning/, billing/, om/, spr/   (future CRM/OM plug in here, via tmf620/ only)
├── scripts/
├── docker/
├── .env.example
├── README.md
└── AGENTS.md
```
