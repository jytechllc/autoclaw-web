# Google Ads Module — Launch Verification Checklist

| Field | Value |
|---|---|
| **Author** | Shui Lin |
| **Created** | 2026-07-03 |
| **Scope** | Everything shipped in the 2026-07-02/03 sprint (22 PRs) + pre-existing surfaces they touch |
| **Why this exists** | The sprint's Google Ads API calls were written against API docs and verified with unit tests only — **no call has been executed against a live account yet**. This checklist is the end-to-end acceptance pass required before launch. Expect to find 2–5 small mismatches (field names, enum casing, error shapes); file each as a `fix:` PR referencing the checklist item ID. |

**How to use:** run top-to-bottom on a staging deployment pointed at a real (low-budget) Google Ads account. Check the box, note the date/initials. Any ❌ blocks launch until fixed and re-verified.

---

## 0. Environment prerequisites

- [ ] **E-1** `GOOGLE_ADS_CLIENT_ID` / `CLIENT_SECRET` / `REFRESH_TOKEN` / `DEVELOPER_TOKEN` / `CUSTOMER_ID` set in the staging env; `GOOGLE_ADS_LOGIN_CUSTOMER_ID` set if the customer sits under an MCC.
- [ ] **E-2** The developer token has at least **Basic access** (test-account-only tokens cannot mutate production customers).
- [ ] **E-3** `CRON_SECRET` matches the GitHub Actions secret; `DATABASE_URL` points at the staging DB with `lib/schema.sql` applied.
- [ ] **E-4** Test users exist: one **owner/admin** account and one **viewer** (sandbox) account in the same org, with ad credits topped up (≥ $50 via Stripe test mode).

## 1. Smoke: connectivity

- [ ] **S-1** `GET /api/google-ads/diagnose` returns customer info (currency, timezone) with no error — proves OAuth refresh + developer token + customer id all work.
- [ ] **S-2** Google Ads list page loads; `Discover` shows campaigns that exist Google-side.

## 2. Campaign lifecycle (pre-sprint core, regression)

- [ ] **C-1** Create a SEARCH campaign ($1/day daily, $10 cap). Verify: PAUSED state Google-side, `ad_credits.reserved_cents` increased by cap×markup, `campaigns` row present.
- [ ] **C-2** Rename, change daily budget, change schedule — each reflects in the Google Ads web UI within a minute.
- [ ] **C-3** Enable → Pause → Close. On close: reserve released back to balance, row marked closed.

## 3. Sprint features — campaign detail page

Use a fresh SEARCH campaign for items B/N/A/D/L/SL/X/ST unless noted.

### Bid strategy (PR #47)
- [ ] **B-1** 🎯 chip shows the live strategy (new campaigns: Manual CPC).
- [ ] **B-2** Switch to Maximize Clicks → chip updates after refresh; Google UI shows "Maximize clicks".
- [ ] **B-3** Switch to Target CPA $5 → Google UI shows Max Conversions with tCPA $5. *(Watch for: `maximize_conversions` update-mask quirks when switching one Smart Bidding oneof to another — most likely live-mismatch candidate.)*
- [ ] **B-4** On a VIDEO campaign, the selector only offers conversion-based options; Manual CPC absent.

### Negative keywords (PR #47)
- [ ] **N-1** Add `free`, `[exact] cheap alternative` → red chips appear; visible under campaign negatives in Google UI.
- [ ] **N-2** Adding a duplicate reports "duplicates ignored", not an error.
- [ ] **N-3** Remove one via × → gone both sides.

### Ad schedule (day parting)
- [ ] **AS-1** Apply the Mon–Fri 9–18 preset → 5 chips; Google UI shows matching ad schedule.
- [ ] **AS-2** Overlapping intervals rejected with a clear message before any API call.
- [ ] **AS-3** Clear → "running at all times"; criteria removed Google-side.

### Device bid adjustments
- [ ] **D-1** Mobile +20%, Tablet exclude → chips colored; Google UI device table shows +20% / −100%.
- [ ] **D-2** Excluding all three devices is rejected client- AND server-side.

### Location bid adjustments
- [ ] **L-1** With ≥1 geo targeted, set +30% → chip shows `+30%`; Google UI location table matches. Percent 0 resets.

### Sitelinks / Callouts / Snippets
- [ ] **SL-1** Add 2 sitelinks (with paired descriptions) → appear in Google UI assets tab; remove one → detached but asset still visible in the Asset Library page.
- [ ] **SL-2** Callouts batch add; duplicate text rejected by validation.
- [ ] **SL-3** Structured snippet with header "Service catalog" + 3 values → accepted. *(Watch for: header string casing — Google expects exact EN strings.)*

### AI features
- [ ] **AI-1** Recommendations: Generate on a campaign with ≥7 days of data → 3-6 ranked cards in the UI language; zh locale returns Chinese text.
- [ ] **AI-2** On a SEARCH campaign with spend, wasteful terms appear in a KEYWORD recommendation naming real queries.
- [ ] **AI-3** "✨ Generate from site" (sitelinks): every suggested URL actually exists on the site (spot-check 2); no invented URLs.
- [ ] **AI-4** Ad copy generation still works post-`mode` refactor (regression: `mode` defaults to `copy`).

### Search terms
- [ ] **ST-1** Load on a campaign with traffic → terms with metrics; "− Negative" adds EXACT negative and the row flips to "excluded".

## 4. Conversion tracking

- [ ] **CT-1** Create a SIGNUP action → appears with gtag snippets (global + event); paste snippets into a test page, fire once, conversion shows in Google UI within ~3h.
- [ ] **CT-2** Pause / Enable / Remove status changes stick. Removed actions disappear from the list (status filter).

## 5. Asset Library

- [ ] **AL-1** Page lists assets created above with correct type badges, thumbnails, and usage counts.
- [ ] **AL-2** Attach an existing sitelink to a second SEARCH campaign → usage count increments; attaching again reports "already attached" (success, not error).

## 6. Exports

- [ ] **EX-1** Campaign list CSV opens in Excel with correct CJK rendering; spend columns match the UI.
- [ ] **EX-2** Detail daily-metrics CSV: 30 rows, dates contiguous.
- [ ] **EX-3** Budget transactions CSV: entries match the ledger table; types/amounts correct.

## 7. Permissions (fix/google-ads-readonly-enforcement)

Log in as the **viewer** account:
- [ ] **P-1** List/detail/assets/search-terms pages load read-only; **no edit buttons anywhere** (detail page, conversions page, asset library).
- [ ] **P-2** Direct API probe: `POST /api/google-ads/campaigns/{id}/negative-keywords` with a valid body returns **403**, not 200. Repeat for bid-strategy and conversion-actions POST.
- [ ] **P-3** Recommendations POST returns 403 (no LLM tokens burned for viewers).

## 8. Crons & ledger

- [ ] **CR-1** Manually dispatch `google-ads-sync` (workflow_dispatch) → response has `orgsProcessed ≥ 1`, `orgsSkipped: 0`, spend deltas recorded if any.
- [ ] **CR-2** Manually dispatch `google-ads-reconcile` → no `poolDriftCents` errors on a fresh org.
- [ ] **CR-3** After real spend accrues (leave the $1/day campaign ENABLED for a day): spent_cents updates hourly; when spend reaches the cap, campaign auto-pauses and reserve releases. **This is the money-safety feature — do not launch without observing it fire once.**

## 9. Sign-off

| Item | Result | Notes |
|---|---|---|
| All sections ✅ | ☐ | |
| Fix PRs filed for any ❌ | ☐ | |
| Weijing informed (open questions #1/#4 still pending) | ☐ | |

---
*Companion doc: `docs/google-ads-audit.md` (architecture, risks, per-PR changelog).*
