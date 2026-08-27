# Resolution Engine (Task 018)

The Resolution Engine is the core deterministic business logic layer responsible for taking the internal domain schema and calculating exact behavior for a given execution context.

## Architectural Model
Each capability remains isolated and independently testable. We do NOT merge this into one giant `resolve()` function. 

1. `resolve_price()` (Existing PGSQL Function) - Fetches the raw catalogue rate or account override.
2. `resolve_policy()` (TS Service) - Evaluates eligibility rules against a supplied JSON context.
3. `apply_charge_stacking()` (TS Service) - Orders and filters charges according to priority and stacking rules.
4. `resolve_tax()` (TS Service) - Identifies the correct tax configuration matching the market hierarchy.
5. `resolve_journal()` (TS Service) - Fetches GL accounts for financial reporting.

*Note on Unit Credits:* Unit credits represent catalogue-defined benefits, not real-time balances. Real-time consumption is tracked in the external SPR/Charging system.

## 1. ResolutionContext
A unified object passed to resolvers:
```typescript
export interface ResolutionContext {
    tenant_id: string;
    offering_id: string;
    market_id?: string;
    subscriber_id?: string;
    account_id?: string;
    effective_at: Date;
    context_json?: Record<string, any>;
}
```

## 2. Policy Resolution (`resolve_policy`)
Matches configured `policy_rule` JSON against the runtime `context_json`.
- **Timezone-aware:** Converts `effective_at` to the market's specific IANA timezone (e.g. `Africa/Lagos`) when evaluating `time_window` boundaries.
- **Evaluation modes:** Supports `ALL` (every rule must pass) and `ANY` (at least one rule must pass).

## 3. Charge Stacking (`apply_charge_stacking`)
Orders applicable charge specifications deterministically:
1. `charge_priority` ASC (10 evaluates before 50)
2. `charge_specification.id` ASC (Deterministic tie-breaker).
- **Semantics:** If an `OVERRIDE` charge is processed, it completely clears lower/equal priority charges accumulated in the stack before it.

## 4. Tax Resolution (`resolve_tax`)
Matches a charge to tax mappings.
- **Fallback sequence:**
  1. Specific exact market match.
  2. Parent market match (recursively up the market tree).
  3. Generic configuration (tax mapped with no specific market constraints).

## 5. Journal Resolution (`resolve_journal`)
Returns the General Ledger `gl_code` mapped to the charge for external billing ingestion. Doesn't mutate or post real ledger entries.

## 6. Error and Fallback Semantics
- **No Mapping:** Resolvers return clean structured empty states (e.g., `[]`, `{ passed: true }`) when no explicit restrictions exist, maintaining the "default allow" principle.
- **Ambiguities:** Discount ordering requires future integration. Conceptually, Discount operates after Base Price but before Tax. No mutation of the original rate table is permitted during calculation.
