# Usage dashboard

<!-- crewrig-doc: section=reference nav_order=145 published=true title="Usage dashboard" -->

The usage dashboard is the one place to see what a period, a session, an
agent, a CLI, a task, or an external asset consumed, and what that
consumption would have cost in comparison. It reads the local usage store
(see [`usage-storage.md`](usage-storage.md)) and the comparative prices (see
[`usage-pricing.md`](usage-pricing.md)). It never needs the MemPalace daemon,
never reaches the network, and never shows a prompt, a response, or any
other conversation text: it only reads activity metadata.

Every price the dashboard shows is a **reference figure, not an invoice**.

This page is one stage of the usage feature; the
[usage architecture overview](usage-overview.md) shows how the stages fit
together.

## The three forms and their commands

The three forms render one view model, built once per command (once per
request for the server). Given the same filters, currency, and price-list
snapshot, they show the same token counts, fidelity markers, tallies, and
prices.

| Form | Command | What it produces |
|---|---|---|
| A — static page | `task usage:dashboard -- [filters] [--as-of-today] [--out <path>]` | One self-contained HTML file that works offline. By default it is written to `<root>/dashboard/usage-dashboard.html` and the command prints its path. |
| B — local server | `task usage:dashboard:serve -- [--port <n>]` | A live page on `http://127.0.0.1:41920/`, in the foreground. It prints `LISTENING http://127.0.0.1:<port>/`. Stop it with Ctrl-C or its **Stop** button. |
| C — terminal report | `task usage:dashboard:report -- [filters] [--as-of-today] [--json]` | A plain-text report with fixed sections and columns, or the view model itself as JSON with `--json`. |

`<root>` is `~/.crewrig/usage` unless `CREWRIG_USAGE_ROOT` overrides it.

### Filters

All three forms accept the same filters. Forms A and C take them as options.
Form B takes them as request parameters with the same names and no leading
dashes, for example `/?period=2026-09&model=claude-sonnet-5`. The page's
filter form builds these for you.

| Filter | Meaning |
|---|---|
| `--session <id>` | Records of one session. |
| `--agent <id> --parent <id>` | Records of one subordinate agent. The two options go together. |
| `--task-key <key>` | Records attributed to a task-handoff key, after the attribution ledger is applied. |
| `--asset <kind>:<ref>` | Records attributed to an external asset. |
| `--cli <cli>` | Records captured from one CLI. |
| `--fidelity <f>` | Only `per-request`, `run-total`, or `session-cumulative` records. |
| `--no-ledger` | Ignore the attribution ledger and use each record's own attribution. |
| `--from <YYYY-MM-DD>`, `--to <YYYY-MM-DD>` | An inclusive UTC date range. |
| `--period <YYYY-MM>` | One UTC month. It can be combined with `--from`/`--to`. |
| `--model <id>` | One model identifier, as the CLI reported it. |
| `--bucket day\|week\|month` | Which period table the report prints, and which one the page opens on. All three are always computed. |
| `--currency <ISO4217>` | The currency of the prices. The default is `USD`. |
| `--as-of-today` | Recompute every price as of today for this view (forms A and C). |

A filter combination that matches nothing is shown as an explicit empty
result, never as an error.

## Reading the views

Every view has the same sections: totals, a table per period (day, ISO week,
month), one row per CLI, one row per model, sessions with their subordinate
agents, tasks, and external assets. Each row shows the record count, the
`uncaptured` count, the five token classes (net input, cache read, cache
write, output, reasoning), the fidelity marker, the price, and the price
tallies.

- **Periods are in UTC.** A record belongs to the day, week, and month of the
  instant its request happened. Weeks follow ISO 8601: they start on Monday
  and are named `YYYY-Www` after the ISO week-year, so 1 January 2027 is in
  `2026-W53`.
- **The fidelity marker.** A row carrying one fidelity names it, for example
  `per-request`. A row that combines several shows `mixed:` followed by every
  fidelity it combines, for example `mixed: per-request+session-cumulative`,
  and the rows beneath it break the tokens down per fidelity.
- **Sessions and agents.** A session's row covers the session's own records.
  Each subordinate agent is listed beneath it by its agent identifier. A
  session with no subordinate agent says `No subordinate agent`. With
  `--session <id>`, the drill-down still lists that session's subordinate
  agents, exactly as the whole-store view does, but the totals and every
  other table cover the session's own records only.
- **Tasks and assets** follow `task usage:query -- --task-key <key> --rollup`:
  each key is rolled up on its own. A session can contribute to more than one
  task, so the task rows need not add up to the totals.

### The placement rule for session-cumulative records

Some CLIs report a session's counters as running totals: each snapshot
repeats everything the session used so far. Adding two snapshots would count
the same tokens twice. So a session-cumulative session **counts once, in
full, at the instant of its last snapshot**, and nowhere else.

For example, a session reports 100 and then 300 input tokens on 20 September
2026, and 500 on 21 September. The dashboard shows 500 on 21 September, and
nothing for that session on 20 September.

This rule holds in every view:

- A day, week, or month that holds only earlier snapshots of a session shows
  nothing for that session.
- A date filter or `--period` gives exactly the figures of the matching
  period row. `--from 2026-09-20 --to 2026-09-20` shows nothing for the
  session above, and `--from 2026-09-21 --to 2026-09-21` shows 500.
- `--model` works the same way. A session's last snapshot counts under that
  snapshot's model.

When a selection holds only superseded snapshots, the dashboard says so with
its own banner: `N session-cumulative snapshot(s) match this selection but
are superseded by a later snapshot of the same session outside it`. The
records exist in the store, but they add nothing, because a later snapshot
already carries their tokens.

### Empty results

The dashboard names three kinds of empty result:

| Banner | Meaning |
|---|---|
| `The usage store holds no record` | The journal holds no record at all, for example after every period was pruned. |
| `No record matches this selection: <filters>` | The store has records, but none matches the filters. |
| `N session-cumulative snapshot(s) match this selection but are superseded …` | Records match, but each is an earlier snapshot of a session whose last snapshot falls outside the selection. |

## The six tallies

Every row carries six counts, each present even when it is zero. The page
and the report show five of them as columns; the captured count is in the
`--json` view model (`capturedCount`) and equals `records` minus
`uncaptured`.

- `records`: every record the row holds;
- captured: the records that carry token counts;
- `uncaptured`: records whose source could not be read. They are counted,
  but they carry no tokens and never enter a sum;
- `priced`: captured records with a price in the requested currency;
- `unpriced`: captured records whose model has no entry in the price list;
- `unconverted`: captured records that were priced in US dollars but could not
  be converted to the requested currency.

They always add up: `priced + unpriced + unconverted = captured`, and
`captured + uncaptured = records`. (When no price list is pinned, the three
price tallies are all zero and every price is absent.)

An `unpriced` or `unconverted` record's tokens stay in the token sums,
because they were really consumed. They are left out of the price sum, and
the tallies show how many were left out.

## Interpreting a comparative price

- **Reference, not invoice.** Every price comes with the statement
  *reference figure, not an invoice* and three timestamps: when the pinned
  price list was fetched, which FX fixing converted it, and when the price
  was computed. The dashboard prints them next to every price.
- **Absent prices.** A row with no priced record shows `—` and a reason,
  never `0`:
  - `no-priced-record`: nothing in the row could be priced, for example
    because every model is `unpriced`;
  - `no-converted-price`: prices exist in US dollars, but none could be
    converted to the requested currency;
  - `no-pinned-pricelist`: no price list is pinned yet. Run
    `task usage:price -- --refresh-pricelist`.
- **`unpriced` versus `unconverted`.** `unpriced` means the model is missing
  from the price list; add it through `model-prices.org.json` (see
  [`usage-pricing.md`](usage-pricing.md)). `unconverted` means no suitable FX
  fixing is cached, or the currency is not an ECB currency.
- **FX is offline.** The dashboard converts with the fixings already cached
  and never fetches new ones. When the newest cached fixing is older than the
  computation date, the pricing section says the fixing is stale. For a
  fresher fixing, run `task usage:price -- --refresh-fx`, then regenerate.
- **Stored prices are reused only when they fit.** A stored price is used
  when its currency and price-list snapshot match the view. Otherwise the
  dashboard recomputes the price for the view, without storing it.
- **Persisting goes through `task usage:price`.** No form of the dashboard
  writes a price. The server's **Recompute prices as of today** button
  recomputes for that view only. To store prices recomputed as of today, run
  the `task usage:price -- … --as-of-today` command the page shows.

Form A's footer states when the file was generated and the exact command that
regenerates it, with and without `--as-of-today`.

## Personal-data note

The dashboard shows session, agent, task, and asset identifiers, the models
used, and when they were used. What each form writes, and where:

- **Form A** writes one file, `<root>/dashboard/usage-dashboard.html`, with
  mode `0600` in a directory with mode `0700`. With `--out <path>`, the file
  goes where you choose, with the same `0600` mode.
- **Form B** listens on `127.0.0.1` only and writes no file.
- **Form C** writes to standard output only.

Who can read each form's output, how long it stays, and what sharing it
exposes are stated in the organization note, under
[Who can read each copy](usage-organization.md#who-can-read-each-copy) and
[Retention](usage-organization.md#retention).
