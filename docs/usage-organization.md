# Usage data: organization note

<!-- crewrig-doc: section=reference nav_order=113 published=true title="Usage data: organization note" -->

This note is for an organization deciding whether to adopt CrewRig's
token-consumption tracking. It is the single reference for what data the
feature holds, how long that data stays, who can read each copy of it, and
how to remove all of it. It also explains where prices come from and what
changes when MemPalace is absent. The per-seam pages it links hold the
mechanics; the [usage guide](usage-guide.md) is the entry point for the
people who use the feature, and the
[usage architecture overview](usage-overview.md) explains its stages.

## Scope

The feature holds **per-user activity data**: which person's CLI session used
which model, when, how much, in which project directory, and for which task.
In a GDPR context, this is data about an identifiable person's work. This
note states what the feature holds, that nothing is deleted automatically,
who can read each copy, and how erasure is carried out, so that the
organization can assess it.

This note is not legal advice. It does not state the organization's own
obligations, and it does not cover MemPalace's own retention, access
control, or deletion behavior.

## What the feature holds

**Everything under the usage root is feature data**, and this note covers all
of it, including any location the feature starts writing there later. The
usage root is the directory `CREWRIG_USAGE_ROOT` names on each person's
machine (see [Usage root directory](usage-capture.md#usage-root-directory)).
The feature also writes a few locations outside it, listed after the
examples below.

Examples of what lives under the usage root follow. They are not a closed
list, and the rule above covers whatever they omit; the per-seam pages
describe each location, starting with the
[storage layout](usage-storage.md#on-disk-layout):

- `journal/` holds every usage record verbatim, one file per record, with a
  wing sidecar and an attribution sidecar beside each one. It is derived from
  recorded activity and is the source of truth.
- `spool/` (legacy, present only on machines that ran the first capture
  release) and `tmp/` (in-flight and aborted writes) can hold **records
  verbatim before they reach the journal**. Both are derived from recorded
  activity.
- `declarations/` and `ledger/` hold which task each session served, and for
  ledger entries who corrected an attribution and why. Both are derived from
  recorded activity.
- `prices/` holds one comparative price per record, and `dashboard/` the
  default static dashboard page, which shows every figure and identifier of
  its selection. Both are derived from recorded activity.
- `mirror/` holds one marker per record awaiting or finished mirroring,
  `pruned/` one marker per pruned month, and `cache/` the MemPalace wing
  resolved for each project directory. All three are derived from recorded
  activity.
- `state/` is the **capture state**: read positions in each CLI's own session
  record, memoized CLI versions, and the Antigravity status-line marker (see
  [Personal-data note](usage-capture.md#personal-data-note)). It is derived
  from recorded activity.
- `locks/` holds short-lived lock files, and `pricelist/` and `fx/` hold the
  pinned public price list and cached exchange rates. None of the three is
  derived from recorded activity.

Outside the usage root:

- **The MemPalace mirror.** When MemPalace is present, each record is also
  filed as one drawer in the `usage-records` room of its project's wing, with
  its `raw` block replaced by a reference to the journal entry (see
  [Drawer structure](usage-storage.md#drawer-structure)). Derived from
  recorded activity.
- **Dashboard output a person places elsewhere.** A static page written with
  `--out` to a chosen path, and terminal-report output redirected to a file
  (see [Personal-data note](usage-dashboard.md#personal-data-note)). Derived
  from recorded activity.
- **A transient hook payload file.** Each capture hook stages the payload its
  CLI hands it in a temporary file in the system temp directory, for the
  length of one call, and a killed hook can leave the file behind. **That
  file can hold conversation text**: Gemini CLI's payload carries the model
  request and response, and Claude Code's carries the turn's last assistant
  message (see [Personal-data note](usage-capture.md#personal-data-note)).
  Derived from recorded activity.
- **The non-interactive wrapper's whole-output file.**
  `usage_headless_run` in `scripts/lib/usage-headless.sh` stages the whole
  output of a run it wraps in a temporary file in the system temp directory.
  It deletes the file at the end of the call without a trap, so a killed run
  can leave it behind. **That file can hold conversation text**, the model's
  reply (see [Personal-data note](usage-capture.md#personal-data-note)).
  Derived from recorded activity. The Antigravity CLI rewrite
  (`usage_headless_agy_rewrite_json_response`) stages nothing: it rewrites
  the launch site's own output file in place.

The feature never writes the CLIs' own session records. It only reads them.

## Conversation text

No usage record holds prompts, model replies, tool inputs or outputs, or file
contents. Every capture channel, the non-interactive `headless-envelope`
channel included, copies only enumerated fields into a record's `raw` block.

Conversation text can appear only in the transient files listed above: the
hook payload file and the whole-output file of `usage_headless_run`, for the
length of one call, or longer when a killed call leaves them behind.

## Retention

**No record, ledger entry, price, or other item expires on its own.** No
code path in the feature deletes data on a schedule. Everything stays until a
person prunes a period
([Prune and unprune](usage-storage.md#prune-and-unprune)) or follows one of
the removal procedures below. Retention is therefore the adopting
organization's decision, carried out by those two means.

The dashboard's output falls outside the period prune. The static page stays
until it is regenerated or deleted, and output placed outside the usage root
stays until its owner deletes it. The local dashboard server keeps nothing
once it stops.

## Who can read each copy

- **The usage root.** Its files belong to the person's own account. Anyone
  who can read that account's files can read them: the person, the machine's
  administrators, and any process running as that account, such as an agent
  or a CI job. The feature applies no encryption; file-system permissions are
  the only safeguard. The ledger's author and reason fields are readable in
  the same way.
- **The MemPalace mirror.** Readable by whoever can read that MemPalace
  installation's drawers, as MemPalace governs.
- **The static dashboard page.** Readable by the person's own account and the
  machine's administrators, at the default location or at a chosen path.
  **Sharing that file shares every figure and identifier it shows.**
- **The local dashboard server.** It listens on the loopback interface, which
  is not per user: any account on the same machine can read the page while
  the server runs.
- **The terminal report.** Readable wherever its output is redirected.

## Removing usage data

Two procedures remove data:

- **(a) Purge the stored data while capture stays enabled.**
- **(b) Remove the feature entirely.**

Both are rules over the whole usage root with named exceptions, so a
location the feature starts writing there later is covered without editing
them. The declarations, the whole ledger, and every attribution sidecar go
with the rest of the root in both procedures.

Neither procedure touches the CLIs' own session records, which the feature
reads but never writes. They remain in place, and usage records can be
derived from them again at any time with a backfill.

### Before you start

- **Nothing else runs.** Close every CLI session and agent, and run no
  adopted launch site, until the procedure ends. A write during the
  procedure can file a MemPalace drawer after its marker is gone.
- **MemPalace must be reachable** when the usage root holds a `mirror/`
  directory, because removing a drawer needs the daemon's answer. When the
  mirror check below cannot confirm that every drawer is gone, it stops and
  the removal step does not run. `task mempalace:status` reports whether the
  daemon is up.
- **The current and future months are included.** The period prune refuses
  them without `--force`, so the check passes `--force` to every prune; that
  flag lifts only this refusal (see
  [Prune and unprune](usage-storage.md#prune-and-unprune)).
- **It can take time**, because the check makes one MemPalace call per
  mirrored record.
- **Run the blocks in `bash` or `zsh`, from the checkout** that wired
  capture, since they call its scripts.

### The mirror check (both procedures)

Paste this block first. It defines `ROOT` and the function
`usage_mirror_gate`. When a procedure calls the function, it mirrors any
record still waiting, then prunes every month of every CLI so that each
mirrored record's drawer is deleted, and prints one verdict line:

- `MemPalace mirror: removed` when every marker is gone;
- `MemPalace mirror: nothing mirrored` when the usage root has no `mirror/`
  directory, as on a machine without MemPalace;
- `MemPalace mirror: UNVERIFIED (…)` otherwise, in which case the function
  fails and the removal steps below do not run.

```sh
ROOT="${CREWRIG_USAGE_ROOT:-$HOME/.crewrig/usage}"

usage_mirror_gate() {
  local n d
  USAGE_MIRROR_VERDICT="UNVERIFIED (the mirror check did not finish)"
  if [ ! -d "$ROOT/mirror" ]; then
    USAGE_MIRROR_VERDICT="nothing mirrored"
    echo "MemPalace mirror: $USAGE_MIRROR_VERDICT"
    return 0
  fi
  bash scripts/usage-mirror.sh
  n=$(find "$ROOT/mirror/pending" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" != "0" ]; then
    USAGE_MIRROR_VERDICT="UNVERIFIED ($n pending marker(s): MemPalace unreachable or a record failed to mirror)"
    echo "MemPalace mirror: $USAGE_MIRROR_VERDICT"
    return 1
  fi
  while IFS= read -r d; do
    if ! bash scripts/usage-prune.sh "$(basename "$(dirname "$d")")" "$(basename "$d")" --force; then
      USAGE_MIRROR_VERDICT="UNVERIFIED (MemPalace unreachable while pruning $d)"
      echo "MemPalace mirror: $USAGE_MIRROR_VERDICT"
      return 1
    fi
  done < <(find "$ROOT/journal" -mindepth 2 -maxdepth 2 -type d 2>/dev/null)
  n=$(find "$ROOT/mirror/pending" "$ROOT/mirror/mirrored" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" != "0" ]; then
    USAGE_MIRROR_VERDICT="UNVERIFIED ($n marker(s) left without a journal entry)"
    echo "MemPalace mirror: $USAGE_MIRROR_VERDICT"
    return 1
  fi
  USAGE_MIRROR_VERDICT="removed"
  echo "MemPalace mirror: $USAGE_MIRROR_VERDICT"
}
```

The verdict rests on the mirror's own markers. A record still waiting to be
mirrored stops the check before any prune, because the prune removes a
waiting record's marker without contacting MemPalace, even when a drawer for
it already exists. A mirrored record's marker is removed only after MemPalace
has answered the prune's deletion request. The check does not list
MemPalace's drawers independently
([#1206](https://github.com/crewrig/crewrig/issues/1206)), and it trusts
that answer: `main` counts any reply that is not a protocol error as a
completed deletion, including a reply in which MemPalace itself reports that
the deletion failed ([#1211](https://github.com/crewrig/crewrig/issues/1211)).
A `removed` verdict is therefore only as good as the daemon's own
acknowledgment.

**When the verdict is `UNVERIFIED`**, the removal step has not run and the
usage root is still there. When the check stopped on a waiting record, it
has removed nothing. When it stopped during the prunes, the months pruned
before the stop are already gone, from the usage root and from MemPalace
alike. Either way, make MemPalace reachable and run the whole procedure again
from the start; every step can be repeated safely. One case no shipped command
resolves yet: a mirrored marker whose journal entry is already gone, which
the check reports as a marker left without a journal entry. Its drawer
cannot be found without that entry. The same holds for drawers left behind by
the older purge instructions, which deleted `journal/` and `mirror/` without
removing any drawer. Both cases are tracked in
[#1206](https://github.com/crewrig/crewrig/issues/1206).

### Procedure (a): purge the stored data while capture stays enabled

This removes every entry of the usage root except three:

- `state/`, the capture state, is kept because it records how far capture
  has read each CLI's own session record. Removing it while capture is
  enabled makes the next capture derive the whole history again from those
  records, which undoes the purge. It also holds the marker the Antigravity
  installer needs to offer its removal.
- `pricelist/` and `fx/` are kept because they are not derived from recorded
  activity. Keeping them avoids fetching the price list and the exchange
  rates again.

Everything else goes, including `pruned/`: its markers would otherwise make
the store reject new records for the months just pruned.

1. Paste the mirror check block above. It only defines `ROOT` and the
   function; nothing runs yet.
2. Run the purge, which runs only if the mirror check succeeds:

   ```sh
   usage_mirror_gate &&
     find "$ROOT" -mindepth 1 -maxdepth 1 -not -name state -not -name pricelist -not -name fx -exec rm -rf {} +
   ```

3. Run the closing check, which prints what is left and the mirror verdict:

   ```sh
   usage_check_purge() {
     local left
     left=$(find "$ROOT" -mindepth 1 -maxdepth 1 -not -name state -not -name pricelist -not -name fx 2>/dev/null)
     if [ -z "$left" ]; then
       echo "Usage root: purged (kept: state, pricelist, fx)"
     else
       echo "Usage root: NOT purged, still holding:"
       printf '%s\n' "$left"
     fi
     echo "MemPalace mirror: ${USAGE_MIRROR_VERDICT:-UNVERIFIED (the mirror check has not run in this shell)}"
   }
   usage_check_purge
   ```

After the purge, new sessions record only their own usage. An Antigravity CLI
session that stayed open across the purge reports its running total, which
still includes consumption from before the purge.

### Procedure (b): remove the feature entirely

1. **Switch capture off on every CLI** through its setup script, as
   [Switching capture on and off](usage-guide.md#switching-capture-on-and-off)
   describes. Do this before anything under the usage root is removed: the
   Antigravity installer finds its own installation through the marker kept
   in `state/`, and without it the status line keeps calling the capture
   shim.
2. Paste the mirror check block above. It only defines `ROOT` and the
   function; nothing runs yet.
3. Remove the usage root, which runs only if the mirror check succeeds:

   ```sh
   usage_mirror_gate && rm -rf "$ROOT"
   ```

4. Run the closing check. It reports the usage root, the mirror verdict, and
   whether any CLI configuration still calls a capture entry point:

   ```sh
   usage_check_removal() {
     local f hits=""
     if [ -e "$ROOT" ]; then echo "Usage root: NOT removed ($ROOT)"; else echo "Usage root: removed"; fi
     echo "MemPalace mirror: ${USAGE_MIRROR_VERDICT:-UNVERIFIED (the mirror check has not run in this shell)}"
     for f in "$HOME/.claude/settings.json" "$HOME/.gemini/settings.json" \
       "$HOME/.copilot/hooks/copilot-transcript-hooks.json" "$HOME/.gemini/antigravity-cli/settings.json"; do
       if [ -f "$f" ] && grep -qE 'usage-capture\.sh|antigravity-statusline-shim\.sh' "$f"; then
         hits="$hits $f"
       fi
     done
     if [ -z "$hits" ]; then
       echo "CLI configuration: no capture entry point"
     else
       echo "CLI configuration: capture still wired in:$hits"
     fi
   }
   usage_check_removal
   ```

What stays after procedure (b), and whose it is:

- **The person's own files**, to delete as they see fit: a static dashboard
  page written with `--out` to a chosen path, redirected terminal-report
  output, and the setup scripts' backups of each CLI configuration
  (`<file>.bak.<timestamp>`, beside the file), which can still name the
  capture script but are not read by any CLI. The organization's
  `model-prices.org.json` in the checkout is not activity data.
- **The CLIs' own session records**, which remain and from which usage
  records can be derived again.
- **Two writers that start again on their own.** Running an adopted launch
  site afterwards writes a usage record to the usage root again, and an agent
  session that follows the deployed session-start rules while establishing or
  resuming a task-handoff drawer writes a declaration there again (see
  [What writes usage data whatever you chose](usage-guide.md#what-writes-usage-data-whatever-you-chose)).
  `main` offers no switch that stops either of them.

## The price source

The decision is already taken. The primary price source is LiteLLM's public
price list, published under the MIT licence and pinned to one commit, so that
every price can be reproduced. OpenRouter's public list is reached only on an
explicit, one-shot cross-check that a person starts by hand, and never
automatically. The reason is section 7 of OpenRouter's Terms of Service,
which prohibits automated scraping or copying of its content. The mechanism
is described in [Primary source](usage-pricing.md#primary-source) and
[Cross-check against OpenRouter](usage-pricing.md#cross-check-against-openrouter).

## Without MemPalace

A deployment without MemPalace loses no stage. The local journal is a
first-class backend: capture, storage, attribution, pricing, and the
dashboard all run on it, and nothing is written under `mirror/` (see
[Gating: token file](usage-storage.md#gating-token-file)). Switching capture
on is an opt-in of its own on every CLI and needs no MemPalace (see
[Switching capture on and off](usage-guide.md#switching-capture-on-and-off)).

What such a deployment loses is the mirror: records are not queryable inside
MemPalace by session, agent, task, or external asset alongside the rest of
its memory. The same selections remain available from the journal through the
local read surface ([Read surface](usage-storage.md#read-surface)).

Three more points hold for such a deployment:

- The [adopted launch sites](usage-capture.md#adopted-launch-sites-non-interactive-runs)
  still write usage records whenever they run, whatever was chosen at install
  time, and `main` offers no switch that stops them.
- The session-start declaration writer does not fire: it runs only when an
  agent establishes or resumes a task-handoff drawer, and both need MemPalace
  (`artifacts/core/system-context/long-running-task-convention.md`).
- The removal procedures' mirror check reports `nothing mirrored`.
