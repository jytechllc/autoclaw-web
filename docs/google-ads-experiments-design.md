# Google Ads A/B Experiments — Design Proposal

| Field | Value |
|---|---|
| **Author** | Shui Lin |
| **Created** | 2026-07-03 |
| **Status** | Proposal — implementation deferred until after the live-account verification pass (`docs/google-ads-launch-checklist.md`) |
| **Closes** | The last major item in the audit's Section 6 competitor table |

## 1. Why a design doc first

Experiments are the most complex Google Ads API surface this module will touch, for three reasons that make blind implementation (the approach that worked for extensions/bid-modifiers) too risky here:

1. **Long-running operations.** `experiments:scheduleExperiment` returns an LRO — the treatment campaign is created asynchronously by Google. Our request/response route pattern doesn't fit; we need polling or optimistic state.
2. **Google creates a campaign we didn't create.** The treatment arm materializes as a real, spending campaign that is NOT in our `campaigns` table.
3. **⚠️ Ledger conflict (the big one).** Our entire money-safety model — per-campaign reserve, hourly spend sync, auto-pause at cap — keys off rows in `campaigns`. An experiment's treatment campaign spends real money from the same account **invisibly to our sync**. Untracked spend = ledger drift = the exact failure mode audit D-1 existed to prevent. Any implementation MUST solve this before an experiment can be scheduled.

## 2. Google API surface (v20)

- **`experiment`** — name, type (`SEARCH_CUSTOM` / `DISPLAY_CUSTOM`), status (`SETUP` → `INITIATED` → `GRADUATED`/`HALTED`/`PROMOTED`), start/end dates, sync enabled.
- **`experiment_arm`** — control arm (points at the base campaign, e.g. 50% traffic) + treatment arm (Google generates `in_design_campaigns`, traffic split e.g. 50%).
- **Flow:** create experiment → create 2 arms → mutate the treatment's draft campaign (the thing being tested: different bid strategy, different ad copy, …) → `scheduleExperiment` (LRO) → experiment serves → read per-arm metrics → `promoteExperiment` (apply treatment to base, also LRO) or `endExperiment`.
- **Metrics:** treatment campaign is queryable like any campaign; comparison = base vs. treatment over the experiment window.

## 3. Ledger integration design (must-solve)

**Decision: treatment campaigns become first-class rows in `campaigns`.**

- On successful `scheduleExperiment`, insert the treatment campaign into `campaigns` with `metadata.experiment_of = <base campaign id>`, `total_budget_cents` = share of the base cap proportional to the traffic split, and move that share of the base campaign's `reserved_cents` to the treatment row (zero-sum — no new reserve needed from the org pool).
- Hourly sync then tracks both arms automatically (no sync changes needed — it iterates `campaigns` rows).
- Auto-pause semantics: if EITHER arm hits its share of the cap → pause BOTH (pausing one arm invalidates the test anyway) + release remaining reserve from both. Implemented as a small extension in `syncOrgGoogleAdsSpend`: when a closing campaign has `metadata.experiment_of` (or is referenced by one), cascade.
- On promote/end: treatment row closed; reserve reconsolidated to the surviving campaign.
- Reconcile needs one new check: base + treatment reserved sum equals the original cap share-out.

This reuses every existing safety mechanism instead of building a parallel one. The only new ledger primitive is "split a reserve between two campaign rows", which is arithmetic on existing columns inside one transaction.

## 4. LRO handling

Keep it simple — no job queue:
- `scheduleExperiment` route returns immediately with `experiment.status = INITIATED_PENDING` stored in a new `experiments` table (org_id, base_campaign_id, experiment_resource_name, status, traffic_split, created_by).
- Status refresh is **read-on-demand**: the experiments UI polls `GET /experiments/[id]` which queries Google live (same pattern as search terms — no auto-fire). The hourly sync also refreshes any `PENDING` experiments it encounters (piggyback, ~1 extra GAQL query per org with pending experiments).
- If the LRO failed, surface Google's error verbatim and allow retry/delete.

## 5. Proposed schema

```sql
CREATE TABLE IF NOT EXISTS ad_experiments (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  base_campaign_id INTEGER REFERENCES campaigns(id),
  treatment_campaign_id INTEGER REFERENCES campaigns(id),
  experiment_resource_name VARCHAR(255),
  name VARCHAR(255),
  traffic_split INTEGER NOT NULL DEFAULT 50,   -- percent to treatment
  status VARCHAR(40),                          -- mirrors Google + PENDING states
  what_changed JSONB,                          -- human-readable description of the treatment delta
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP
);
```

## 6. UI (slice 3)

Detail page card "🧪 Experiments": create form (name, traffic split slider 10–90%, ONE treatment change from a preset list: bid strategy / daily budget ±% / ad variant), status timeline, metric comparison table (impr/clicks/CTR/cost/conv per arm + naive lift %), Promote / End buttons with confirms. Statistical significance display is a non-goal for v1 (show Google's own recommendation state instead when available).

## 7. PR breakdown

| PR | Scope | Size | Prereq |
|---|---|---|---|
| exp-1 | schema + lib (create experiment/arms, mutate treatment, schedule LRO, status read) + ledger split/merge in credits.ts + tests | L | **live-account access** (LRO behavior can't be desk-checked) |
| exp-2 | API routes (create/status/promote/end) + sync cascade for arm auto-pause + reconcile check | M | exp-1 |
| exp-3 | 🧪 UI card + i18n + checklist additions | M | exp-2 |

## 8. Open questions

1. Traffic-split cap share-out uses the split ratio — OK, or should treatment get a fixed user-set cap? (Proposal: ratio; simpler mental model.)
2. Should PAYG platform fee apply to treatment spend separately? (Proposal: yes automatically — it flows through the same recordSpend path.)
3. v1 treatment presets limited to bid strategy / budget / ad variant — enough for launch? (Optmyzr parity says yes.)

## 9. Explicit non-goals for v1

Multi-arm experiments, overlapping experiments on one campaign, auto-promote on significance, PMax experiments (different API), portfolio-level experiments.
