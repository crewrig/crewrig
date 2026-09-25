# Usage guide

<!-- crewrig-doc: section=reference nav_order=111 published=true title="Usage guide" -->

CrewRig can record how many model tokens each of your CLI sessions uses, and
show what that consumption would cost at listed rates. This guide is the
entry point: it tells you how to switch recording on and off, what is
recorded, how to read the dashboard and its prices, and where to go for the
everyday tasks. Each section names the task and links to the page that holds
its mechanics.

## Start here

- The [usage architecture overview](usage-overview.md) explains the six
  stages the feature runs through and where it can be extended.
- The [organization note](usage-organization.md) is the single reference for
  how long the data stays, who can read it, and how to remove all of it.

## Switching capture on and off

Capture is off until you switch it on, and you switch it on for each CLI
separately. No CLI needs MemPalace for it: records go to a local journal on
your machine. On every CLI the switch is a question the CLI's interactive
setup script asks; re-running the script is also how you switch capture off.

This section was verified against `main` at commit `c8baa79` on 2026-09-24.

### Claude Code

- **On.** Run `scripts/setup-claude-interactive.sh`. After the session-recording
  question, it asks *Capture token usage for Claude Code? (opt-in, MemPalace
  not required)*. The default is `no`; answer `yes`. Before writing, it tells
  you what it registers and that it changes `~/.claude/settings.json`.
- **Off.** Run the same script again. The question becomes *Usage capture is
  registered for Claude Code. Keep it or remove it?*. The default is `keep`;
  answer `remove`. Only the capture entries are deleted. What `keep` and
  `remove` change is defined in
  [Shim wiring](usage-capture.md#shim-wiring-claude-code-gemini-cli-copilot-cli).

### Gemini CLI

- **On.** Run `scripts/setup-gemini-interactive.sh` and answer `yes` to
  *Capture token usage for Gemini CLI? (opt-in, MemPalace not required)*
  (default `no`). It changes `~/.gemini/settings.json`.
- **Off.** Run it again and answer `remove` to *Usage capture is registered
  for Gemini CLI. Keep it or remove it?* (default `keep`); see
  [Shim wiring](usage-capture.md#shim-wiring-claude-code-gemini-cli-copilot-cli).
- **Before re-running.** This script merges `~/.gemini/settings.json` in
  place and backs it up first to `settings.json.bak.<timestamp>`. Your own
  keys, hooks and MCP servers are kept, whatever you answer, and so are
  capture, the session-recording hooks and the worktree git guard. Deleting
  a key the framework ships a default for brings the template value back on
  the next run, so set a value to override it. Comments in the file are not
  kept by a re-run; they remain in the timestamped backup.

### Copilot CLI

- **On.** Run `scripts/setup-copilot-interactive.sh` and answer `yes` to
  *Capture token usage for Copilot CLI? (opt-in, MemPalace not required)*
  (default `no`). It changes `~/.copilot/hooks/copilot-transcript-hooks.json`,
  the file session recording also uses.
- **Off.** Run it again and answer `remove` to *Usage capture is registered
  for Copilot CLI. Keep it or remove it?* (default `keep`). The
  session-recording entries in that file stay as they are; see
  [Shim wiring](usage-capture.md#shim-wiring-claude-code-gemini-cli-copilot-cli).

### Antigravity CLI

- **On.** Run `scripts/setup-antigravity-interactive.sh` and answer `yes` to
  *Enable Antigravity CLI usage capture (statusline channel, opt-in)?*
  (default `no`). It wires capture into the `statusLine.command` setting of
  `~/.gemini/antigravity-cli/settings.json`, and only when that setting is
  empty. When it already holds a command the installer did not put there, the
  installer leaves it untouched and capture stays off on that machine. See
  [Statusline shim wiring](usage-capture.md#statusline-shim-wiring-antigravity-cli).
- **Off.** Run it again. When the installer finds its own command still in
  place, it asks *Antigravity usage capture is installed — keep it, or remove
  it (restores the prior statusLine.command, R21)?* (default `keep`); answer
  `remove`. See
  [Statusline shim wiring](usage-capture.md#statusline-shim-wiring-antigravity-cli).
- **Order matters.** The installer recognizes its own installation through a
  marker it keeps in the capture state under the usage root. Delete the usage
  root first and it no longer offers `remove`, which leaves the status line
  still calling the capture shim. The
  [removal procedures](usage-organization.md#removing-usage-data) run the
  steps in the right order.

### What writes usage data whatever you chose

Two writers do not depend on your answers above:

- **Adopted launch sites.** A few framework-owned probe scripts run a CLI
  non-interactively and write one usage record per run whenever they run,
  whatever you answered at install time. They are listed in
  [Adopted launch sites](usage-capture.md#adopted-launch-sites-non-interactive-runs).
  `main` offers no switch that stops this channel.
- **Session-start declarations.** The deployed session-start rules tell an
  agent that establishes or resumes a task-handoff drawer in MemPalace to
  record the task it works on, with
  `scripts/usage-task.sh set --channel protocol`. Each such session writes one
  declaration (a task key) under the usage root, even with capture off.
  `main` offers no switch that stops it. See
  [Session-start protocol recording](usage-attribution.md#session-start-protocol-recording).

## What is recorded, and what never is

A usage record holds activity metadata, in these categories:

- **Who and where:** session and agent identifiers, and the project directory
  the session ran in.
- **What:** the model identifier exactly as the CLI reported it, and the kind
  of request (a user turn, a tool continuation, the CLI's own housekeeping).
- **When:** the instant of the request and the instant of capture.
- **How much:** five token counts (net input, cache read, cache write, output,
  reasoning), with the precision the source allows.
- **From where:** the CLI, its version, and the capture channel, plus a
  bounded copy of the vendor's own usage fields.
- **For which work:** optionally, a task key or an external reference such as
  a forge issue.

The field-level detail is in [Usage record format](usage-record-format.md#field-reference),
and what each CLI's adapter copies is in
[Per-adapter field sources](usage-capture.md#per-adapter-field-sources).

A record never holds your prompts, the model's replies, tool inputs or
outputs, or file contents.

## Reading the dashboard

The dashboard comes in three forms, all built from the same figures:

- **A static page** suits a record you keep or send: one offline HTML file for
  the filters you chose.
- **A local server** suits exploring: change filters in the browser and see
  the result at once, while it runs.
- **A terminal report** suits a quick look or a script, and its JSON output
  suits another program.

Every view answers the same questions, one section each:

- **Totals:** how much was used overall in the selection.
- **Periods (day, week, month):** when it was used.
- **CLIs and models:** which tool and which model used it.
- **Sessions and their agents:** which session used it, and how much of that
  went to the agents it started.
- **Tasks and external assets:** which piece of work it served. A session can
  serve several tasks, so these rows need not add up to the totals.

On each row, the fidelity marker tells you whether the figures combine
measurements of different precision, and the tallies tell you how many
records carry no tokens or no price. For the period in which a
session-cumulative session is counted, see
[Period rollups](usage-pricing.md#period-rollups).

Commands, filters, tallies, and the empty-result banners are in
[Usage dashboard](usage-dashboard.md).

## Interpreting a comparative price

- **A reference figure, not an invoice.** A price says what the recorded
  consumption would cost at the rates of one pinned public price list. It is
  never what a vendor billed you. See [Usage pricing](usage-pricing.md) and
  [Interpreting a comparative price](usage-dashboard.md#interpreting-a-comparative-price).
- **Copilot CLI has two billing regimes.** For an account on current billing,
  the price uses the CLI's own first-party figures (a dollar amount, or an
  AIU count priced at the organization's declared rate) when a record carries
  them, and the price list otherwise (spec 0209 R20). For an account on a legacy
  premium-request plan, the price comes from the price list and carries a
  caveat naming it a legacy-plan reference price, not the account's billed
  cost (spec 0209 R21). The plan is declared by the organization, as
  [Declaring a Copilot CLI billing plan](usage-pricing.md#declaring-a-copilot-cli-billing-plan)
  describes.
- **Subscriptions and free tiers.** A Claude Code subscription or a Gemini CLI
  free tier bills nothing per token. A price for those records is what the
  same consumption would cost at listed rates, not what you paid. See
  [Usage pricing](usage-pricing.md).
- **Gemini caches are under-estimated.** The price list gives no cache-storage
  rate for Google models, so a price for long-lived Gemini caches leaves that
  cost out (spec 0209 R15). See
  [Known under-estimates](usage-pricing.md#known-under-estimates).

## Everyday tasks

- **Backfill history.** Derive records from what your CLIs already recorded
  before capture was switched on: see
  [Backfill command](usage-capture.md#backfill-command).
- **Prune a period.** Remove one CLI's records for one month, with their
  mirror drawers and derived data: see
  [Prune and unprune](usage-storage.md#prune-and-unprune).
- **Unprune a period.** Let a pruned month accept records again: see
  [Unprune](usage-storage.md#unprune).
- **Remove everything.** Purge all stored data while capture stays on, or
  remove the feature entirely: see
  [Removing usage data](usage-organization.md#removing-usage-data).
