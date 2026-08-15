# CAMPLY Account Manager Contract

This document defines the ownership boundaries of the CAMPLY account-manager flow. It is a release contract, not a proposal.

## 1. Canonical client/account identity

Operational Meta flows use `clientMetaAssetId` as the client-to-ad-account identity.

Legacy `metaAssetId` / `adAccountId` inputs may remain only for compatibility/discovery paths. New operational sync callers must not create another account identity contract.

## 2. Meta data source

- The official collection base is `last_90d`.
- Insights are persisted daily (`time_increment=1`).
- Dashboard/Analytics periods are reads over the persisted base; they must not trigger an implicit Meta sync.
- A newer failed/partial attempt must never replace the last trusted successful snapshot.

## 3. Data quality before decision

CAMPLY must distinguish at least:

- trusted/complete data;
- zero delivery (`zero_delivery` / `no_delivery`);
- partial collection;
- failed collection;
- stale data;
- period not synchronized / account not connected.

A trusted successful run with no metrics in the selected range is represented as zero-valued `zero_delivery` metrics by the dashboard contract. Zero delivery is a valid business state, not a transport failure.

When data is partial, failed, stale or unavailable, the account-manager layer must lower/block confidence instead of manufacturing a performance recommendation.

## 4. Performance decision owner

`clientAnalyticsDecision` plus the profile/target/metric-comparison contracts own media-performance decisions.

They receive:

- trusted Meta metrics;
- the client's analysis profile;
- primary conversion metric;
- secondary metrics;
- resolved targets;
- planned budget and pacing;
- selected period;
- data-quality evidence.

They produce deterministic status, primary issue, gap, pacing, projection and recommendation.

Objective-aware metric presentation must use the shared campaign metric resolver. Sales metrics such as Purchases/CPA/ROAS must not be displayed as the default decision contract for non-sales objectives.

## 5. Operational decision owner

`evaluateOperationalSignals` owns workspace operational facts only, such as:

- overdue/due-today tasks;
- overdue/idle projects;
- campaign review cadence recorded in CAMPLY;
- receivables;
- aggregated critical pending items by client.

It must **not** judge media performance from manual workspace fields such as `campaign.spent`, `campaign.budget`, `campaign.cpr`, client CPR benchmarks, CPA or ROAS.

`syncOperationalSignals` owns signal deduplication/lifecycle (`active`, `dismissed`, `resolved`).

## 6. Interpretive AI

AI is downstream of deterministic contracts.

It may:

- summarize canonical operational signals;
- rewrite deterministic diagnoses in a more readable form;
- organize recommended actions already supported by CAMPLY evidence.

It must not:

- calculate campaign health from manual spend/budget fields;
- invent CPA/CPR/ROAS/CTR/CPM conclusions;
- override data-quality gates;
- replace the Analytics decision engine.

When a question depends on media performance, the interpretive layer must defer to the Analytics result.

## 7. Workspace persistence

- Remote workspace state is versioned per authenticated user.
- Async work from a previous session must not mutate the new session.
- Save conflicts adopt/require the latest remote version rather than silently overwriting it.
- If the initial remote read fails, workspace mutations are locked and the UI is explicitly read-only until recovery.

## 8. Security

The Meta sync resolver that can return encrypted access-token material is service-role-only, uses caller privileges (`SECURITY INVOKER`) and an empty `search_path`.

No authenticated/anonymous Data API caller may execute that resolver directly.

## 9. Required release gates

A candidate release is not considered verified until all of the following pass on the resulting commit:

1. `npm ci` on the repository-supported Node runtime (>=22).
2. `npm audit --audit-level=high`.
3. TypeScript/typecheck.
4. Full Vitest suite.
5. Production build.
6. Browser E2E.
7. Isolated Meta/Supabase E2E validation (three cycles).
8. Staging validation against the actual CAMPLY Supabase project before production database/function changes.

`main`/production must not be used as the first environment for a migration or Edge Function change.
