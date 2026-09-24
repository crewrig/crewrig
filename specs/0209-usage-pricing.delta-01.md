---
id: "0209"
slug: usage-pricing
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1193
version: 1.1.0
---

# Comparative pricing of usage — delta 01: one period placement rule for session-cumulative sessions

## ADDED

1. **New requirement (R43) — One period per session-cumulative session.**
   A rollup of prices over a period — a calendar month, or any other span
   of time a rollup is scoped to — SHALL count each `session-cumulative`
   session's contribution in exactly one period: the period holding the
   `timing.requestInstant` of that session's last snapshot; no other
   period SHALL receive any part of that session's contribution.
2. **New requirement (R44) — A superseded snapshot contributes nothing.**
   A period holding only snapshots of a `session-cumulative` session that
   are not that session's last snapshot SHALL receive nothing from that
   session — no price, no priced count, and no `unpriced` count; the
   `unpriced` tally of requirement 34 for such a session SHALL be counted
   only in the period that requirement 43 places the session in.
3. **New requirement (R45) — The last snapshot is chosen over the whole
   session, within the selection.** The last snapshot of requirements 43
   and 44 SHALL be chosen from every snapshot of that session present in
   the store that the rollup's selection admits — the selection being
   every filter other than a placement bound, that is the session, the
   agent and parent session, the task-handoff key or external asset
   reference (with the attribution ledger applied, spec 0208 requirement
   15), the source CLI, and the fidelity — and a placement bound (the
   period or span of time the rollup is scoped to, and, on spec 0210's
   dashboard, the model filter) SHALL NOT restrict that choice but only
   decide, afterwards, whether the chosen snapshot is counted; a snapshot
   the selection admits that falls outside the period and is later than
   every in-period snapshot of the same session SHALL therefore supersede
   them. Among the admitted snapshots of one session, the last SHALL be
   the one with the latest `timing.requestInstant`, ties broken by the
   latest `timing.captureInstant`, then by the greatest `recordId`.
4. **New requirement (R46) — Period rollups are additive.** For any set
   of disjoint periods, computed under the same price-list snapshot
   (requirement 30), the same currency and fixing date (requirement 27),
   and the same selection (requirement 45),
   the sum of the periods' `session-cumulative` price contributions SHALL
   equal the sum, over every session those periods count, of that
   session's own `session-cumulative` price contribution as a rollup
   scoped to that one session reports it; no session SHALL be counted in
   more than one of those periods.
5. **New requirement (R47) — Agreement with the dashboard.** Given an
   identical period, selection (requirement 45), currency, fixing date,
   and price-list snapshot, a rollup of prices over a period SHALL report,
   for its `session-cumulative` records, the same price contribution, the
   same priced count, and the same `unpriced` count as spec 0210's
   dashboard reports for that same period; this extends to the pricing
   contract's own period rollup the agreement spec 0210 requirement 2
   already requires among the dashboard's three delivery forms. A record
   whose currency conversion failed is outside this requirement until
   issue #1202 settles how the price rollup tallies it.
6. **New requirement (R48) — Computed from the surviving snapshots, never
   frozen.** A period's `session-cumulative` price contribution SHALL be
   computed from the snapshots present in the store at computation time;
   it SHALL change after the period has ended when a session straddling
   the period's end records a later snapshot, and when an explicit prune
   of a later period (spec 0207 requirement 19 as reworded by spec 0207
   delta-01, together with requirement 37 for that period's stored
   prices) removes the snapshot that was that
   session's last, making its last *surviving* snapshot the one requirement
   43 places; no rollup SHALL report an earlier figure retained for an
   ended period in place of the one so computed.
7. **New requirement (R49) — The placement rule and its instability are
   documented.** The organization-facing documentation of requirement 42
   SHALL state the placement rule of requirements 43 through 45 and the
   two ways requirement 48 lets an ended period's `session-cumulative`
   figure change: a straddling session still recording snapshots, and an
   explicit prune of a later period; and no organization-facing
   documentation of the usage feature SHALL describe a divergence between
   a period rollup of prices or tokens and spec 0210's dashboard on the
   placement of a `session-cumulative` session.
8. **New requirement (R50) — Continuous-integration acceptance criterion
   for period placement.** A continuous-integration suite SHALL verify,
   with no network access and against a pinned fixture price list, over a
   fixture holding one `session-cumulative` session wholly inside a period
   P (snapshots at 100, 300, and 500 tokens) and one `session-cumulative`
   session straddling the end of P (a 700-token snapshot in P's last hour
   and a 900-token snapshot in the following period P+1): that the rollup
   of prices over P counts only the first session, at the price of its
   500-token snapshot; that the rollup over P+1 counts the straddling
   session at the price of its 900-token snapshot; that the P and P+1
   contributions sum to the two sessions' own session-scoped
   `session-cumulative` contributions; that each figure equals spec 0210's dashboard figure for
   the same period; and that, after an explicit prune of P+1, the rollup
   over P counts the straddling session at the price of its 700-token
   snapshot, now its last surviving one.

The following restates, for this delta's additions, the boundary the
parent's `## Out of scope` already draws:

- Rollups not scoped to a period — a rollup for a session, a task-handoff
  key, or an external asset reference — are unchanged by requirements 43
  through 50; they keep consuming spec 0208's per-fidelity rollup over the
  records that selection names.
- The placement of `per-request` records, `run-total` records, and
  `uncaptured` records is unchanged: each is counted in the period holding
  its own `timing.requestInstant`, as before this delta.
- The ordering R45 states is the one the storage contract's per-fidelity
  rollup already applies on `main`; spec 0208 names the last snapshot
  (requirements 20 and 22) without stating an ordering, and R45 makes it
  normative for price rollups without changing which snapshot any
  existing rollup designates.

**Scenario:** A straddling session is placed in the later period

```text
Given a session-cumulative session with a 700-token snapshot in the last
      hour of period P and a 900-token snapshot in the first hours of the
      following period P+1
When  a rollup of prices is computed over P, then over P+1
Then  the rollup over P receives nothing from that session, neither a
      price nor an unpriced count, and the rollup over P+1 counts that
      session once, at the price of its 900-token snapshot
```

**Scenario:** The periods sum to the whole

```text
Given a store holding a session-cumulative session whose snapshots all
      fall in period P, and a second session straddling the end of P into
      P+1, and no other record
When  a rollup of prices is computed over P, over P+1, and over each
      session on its own, under the same price-list snapshot and currency
Then  the P and P+1 session-cumulative contributions sum to the two
      session-scoped contributions, each session counted exactly once,
      and each period's figure equals the dashboard's figure for that
      period
```

**Scenario:** Pruning the later period moves the straddling session back

```text
Given the store of the previous scenario, whose rollup over P counts only
      the session lying wholly inside P
When  an explicit prune of P+1 removes the straddling session's 900-token
      snapshot and the rollup over P is computed again
Then  the rollup over P also counts the straddling session, at the price
      of its 700-token snapshot, now its last surviving snapshot, and no
      earlier figure for P is reported in its place
```

**Scenario:** The selection applies before the choice, the period after it

```text
Given a session-cumulative session with a 400-token snapshot in period P
      attributed to task A, and a 600-token snapshot in period P+1 that
      an attribution-ledger entry scoped to P+1 attributes to task B
When  a rollup of prices is computed for task A over P, and for task B
      over P+1
Then  the rollup for task A over P counts that session at the price of
      its 400-token snapshot, the last snapshot task A's selection admits,
      and the rollup for task B over P+1 counts it at the price of its
      600-token snapshot; the snapshot task A's selection does not admit
      never supersedes one it does
```

**Scenario:** A period holding only a superseded snapshot receives nothing

```text
Given a session-cumulative session whose last snapshot resolved to the
      unpriced marker and falls in period P+1, and whose earlier, priced
      snapshot falls in period P
When  a rollup of prices is computed over P
Then  P reports neither a price nor an unpriced count for that session, and
      the session's unpriced count appears only in the rollup over P+1
```

## MODIFIED

**R32** — the `session-cumulative` clause SHALL name the last snapshot as
the one over the whole session and place its price in exactly one period.

> Original R32: *"A rollup of prices over a period SHALL sum the prices of
> records declaring `per-request` fidelity, SHALL sum the prices of records
> declaring `run-total` fidelity, and SHALL take only the price of the last
> snapshot per session for records declaring `session-cumulative`
> fidelity, never a sum of that session's snapshots."*

Replacement: A rollup of prices over a period SHALL sum the prices of
records declaring `per-request` fidelity, SHALL sum the prices of records
declaring `run-total` fidelity, and SHALL take, for records declaring
`session-cumulative` fidelity, only the price of each session's last
snapshot over the whole session — never a sum of that session's
snapshots, and never a snapshot chosen from among only those falling
within the period — counted in the period holding that last snapshot's
`timing.requestInstant` and in no other period (requirements 43 through
45).

## REMOVED

(none — every obligation of the parent stands; this delta only states
which period a `session-cumulative` session's single contribution belongs
to, a case the parent left unspecified.)

## Notes

**Why this delta exists.** Issue #1193 surfaced, while planning #1173
(spec 0210), that two readings of R32 coexist on `main`. The period
rollups of `task usage:query -- --period P --rollup` and
`task usage:price -- --period P --rollup` filter first — they read
period P, then take each session's last snapshot among the records read
(`scripts/lib/usage-store/query.js` l. 170-185;
`scripts/lib/usage-price/rollup.js` l. 29-30). The dashboard of spec 0210
runs one pass over the whole selection, then places each session's last
snapshot by its own request instant (PLAN v2 D4,
`scripts/lib/usage-dashboard/model.js` header comment;
`scripts/lib/usage-dashboard/source.js` header comment). The reproduction
logged on #1193 (comment 5813700367, `origin/main` @ `e1319ae`, fixture
records `r03`–`r07` of `scripts/tests/fixtures/usage-dashboard/records/`):
session `sess-s1` at 100, 300, and 500 tokens in September, session
`sess-s2` at 700 (`2026-09-30T23:00Z`) and 900 (`2026-10-01T01:00Z`). For
`2026-09`, `usage:query` gives **1200** (500 + 700) where the dashboard
gives **500**; for `2026-10` both give **900**. Under filter-first,
September + October = 1200 + 900 = **2100**, counting `sess-s2`'s 700
twice, since its 900 snapshot is cumulative and already includes it;
under the whole-session reading the sum is 500 + 900 = **1400**, every
session counted once. Spec 0208 R22 forbids deriving a delta from two
snapshots, so filter-first has no way to subtract the double count: the
last snapshot must be chosen once, across all periods.

**Owner decision.** Settled at the `user-validate` gate on 2026-09-24
(plannotator backend, `approved`, annotation "OK pour la solution A"),
recorded at
<https://github.com/crewrig/crewrig/issues/1193#issuecomment-5813732392>:

> A `session-cumulative` session contributes **its last snapshot over the
> whole session**, placed in the period that holds that snapshot's
> `timing.requestInstant`, and contributes nothing to any other period.
> [...] "Last snapshot *within* the period" (filter-first) is rejected.

The same decision fixed the scope: this single delta of spec 0209, no
delta of spec 0208, no delta of spec 0210.

**Spec 0208 side — an unspecified surface aligned, not a new 0208
requirement.** Spec 0209's parent `## Out of scope` keeps the per-fidelity
rollup rule's own definition in spec 0208, so this delta states the
placement for **price** rollups only. Spec 0208 specifies rollups for a
task-handoff key or an external asset reference (R20); it does not say
whether a period is a selection filter or a placement bound, and so does
not specify the period rollup `usage:query --period P --rollup` exposes.
The implementing diff aligns that token rollup on the selection-versus-
placement split R45 states, so the token figures of a period agree with
the price figures and with the dashboard for the same period. That split
is what keeps the change from reaching spec 0208's shipped task-key
rollup: `usage:query --task-key K --rollup` keeps choosing each session's
last snapshot among the snapshots attributed to K, since the task-handoff
key is a selection filter, and remains unchanged. An earlier draft framed
the token-side change as a conformance fix to spec 0208 R22; read that
broadly, the same argument would condemn the task-key rollup too (seat
`specs/1193#1`, finding s1-F2), so it is withdrawn in favor of the split.
No 0208 requirement is added or reworded. Spec 0208 names the last
snapshot without stating an ordering; the ordering R45 states is the one
`lastSnapshots` in `scripts/lib/usage-store/rollup.js` already applies,
so no existing rollup changes which snapshot it designates.

**Spec 0210 side.** Spec 0210 R2 requires agreement among the dashboard's
three delivery forms only, and spec 0210 states no placement rule of its
own; its PLAN v2 D4 already applies reading A. R47 extends agreement to
the pricing contract's period rollup without changing spec 0210, which is
why no 0210 delta is needed.

**Rejected alternative — reading B, filter-first.** "The last snapshot
within the period" keeps an ended period's figure stable, which is its
one real advantage. It was rejected because it is not additive: summing
periods double-counts every straddling session (2100 instead of 1400
above), and it would break the dashboard's invariant that the sum of its
day, week, or month rows equals the whole-scope total. It also adds a
qualifier — *within the period* — that neither spec 0209 R32 nor spec
0208 R22 contains.

**Accepted cost.** Reading A lets an ended period's figure move, in the
two ways R48 names; the owner accepted that cost on condition that it is
documented (R49). The implementing diff of #1193 carries that
documentation: `docs/usage-pricing.md` states the placement rule and both
ways an ended period can move, and `docs/usage-dashboard.md` → *Reading
the views* drops its paragraph on the divergence between `usage:query` /
`usage:price` and the dashboard. The documentation work of #1175 builds
on that state.

**Test impact.** Case 13.8 of #1173 (`scripts/tests/test-usage-dashboard.sh`,
`case_divergence`; expected values under the `divergence` key of
`scripts/tests/fixtures/usage-dashboard/expected.json`) pins today's
token-side divergence. The implementing diff is to turn it into an
agreement assertion — `2026-09` → 500 and `2026-10` → 900 for both
`usage:query` and the dashboard on the golden fixture. The `2026-10`
filter-first value is 1300 there, not 900, because the golden fixture
also holds `sess-split` (400 tokens on `2026-10-20`, 600 on
`2026-11-03`), a second straddling session. R50 covers the price side
of the same agreement.

**Version bump.** MINOR (`1.0.0` → `1.1.0`) per `docs/spec-format.md` →
*Versioning*: a new scenario and new requirements (43 through 50) that
constrain a previously unspecified case — which period a
`session-cumulative` session's single contribution falls in — plus a
reworded R32 that keeps every obligation of the original (per-request and
run-total prices summed, one last-snapshot price per session, never a sum
of a session's snapshots) and adds the whole-session choice and its
single-period placement. It is not MAJOR: the filter-first behavior on
`main` was one reading of an under-specified R32, not an obligation R32
stated, so no requirement the implementation satisfied is withdrawn; the
implementing diff narrows the behavior to the one reading this delta
makes normative.
