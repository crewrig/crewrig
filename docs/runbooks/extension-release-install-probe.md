# Runbook — extension release install probe (spec 0183 R20)

<!-- crewrig-doc: published=false -->

Spec 0183 R20 requires the archive form the in-place tool (Gemini CLI)
demonstrably accepts — its internal layout, the location of that tool's own
manifest within it, and the asset naming the tool resolves — to be pinned
with recorded evidence obtained from the installed tool against a published
artifact, before the install-from-release path is documented as the default
operating mode. This runbook is that evidence.

## Why observation and not the vendor guide

The installed tool's own bundled documentation states that a release
archive's manifest must sit at the archive root with no wrapper directory,
and separately (elsewhere in the same documentation) that one top-level
wrapper directory IS tolerated when it contains the manifest. The two claims
disagree with each other before they are ever checked against the running
tool. This project's own record (spec 0183's own grounding notes; the
`extension-mcp-token-probe.md` precedent) shows vendor documentation getting
a per-tool detail wrong more often than not, so this probe reads the
**installed tool's own behaviour and its own recorded install metadata**,
never the documentation, as the source of truth.

**The probe's verdict is an assertion, not an observation of "did it print
success".** `gemini extensions install <url> --ref <tag> --consent`
degrades silently to a plain `git clone` of the ref on *every* release-side
failure — a tag with no release, no matching asset, a download failure, an
extraction failure — and still prints "installed successfully" in that
degraded case. The verdict this runbook records is therefore **not** "the
command exited 0"; it is **`type == "github-release"` in the installed
extension's own `~/.gemini/extensions/<name>/.gemini-extension-install.json`**.
`type == "git"` there is a FAILED probe even if the install command itself
reported success.

## Setup

- Candidate archive: `scripts/release-package-extension.sh`'s output for the
  reference extension (`hello-world`), version `1.7.0` — the archive form
  spec 0183 R17/R22 mandate (Ruling A: `build/extensions/hello-world`,
  single-tool).
- Scratch repository: a throwaway **public** GitHub repository under the
  operator's own account (`hcross/crewrig-probe-1008`), created with `gh
  repo create`, so the probe needs no `GITHUB_TOKEN` at all (a public
  release's generic asset is resolvable anonymously). Deleted at the end of
  this procedure (see *Cleanup*).
- One commit on `main`, then a tag matching this project's own
  `tagFormat` (`<name>-v<version>`) — `hello-world-v1.7.0` for the first
  attempt, `hello-world-v1.7.1-fix` for the corrected attempt (a NEW tag
  rather than force-moving the first one, so both attempts stay inspectable
  in the scratch repository's own history until cleanup).
- `gh release create <tag> <archive> --repo hcross/crewrig-probe-1008
  --title ... --notes ...` — verified with `gh release view <tag> --json
  assets` to carry **exactly one asset** before running the probe (the
  measured vendor constraint this project's own ground for Ruling A rests
  on; see `specs/0183-extension-model-migration.delta-01.md`).
- Probe command: `gemini extensions install
  https://github.com/hcross/crewrig-probe-1008 --ref <tag> --consent`.
- Tool version: **Gemini CLI 0.46.0** (`gemini --version`) — the same
  version spec 0183's own grounding notes cite.
- Credential: **none** — the scratch repository is public, so no
  `GITHUB_TOKEN` was exported. (The documented credential for a private
  repository is `GITHUB_TOKEN` only, with no `GH_TOKEN` alias and no `gh auth
  token` fallback — not exercised here since the scratch repository does not
  need one.)

## Attempt 1 — FAILED (archive shape defect found live)

The first candidate archive was built as
`tar -czf archive.tar.gz -C build/extensions hello-world` — a single
top-level wrapper directory (`hello-world/`) containing
`gemini-extension.json` one level down, matching this project's OWN prior
(incorrect) reading of "one top-level wrapper directory is tolerated."

```sh
$ gemini extensions install https://github.com/hcross/crewrig-probe-1008 \
    --ref hello-world-v1.7.0 --consent
Configuration file not found at /var/folders/.../gemini-extensionXXXXXX/gemini-extension.json
```

**Verdict: FAILED.** The installed tool does **not** tolerate the wrapper
directory the way its own bundled documentation claims — it looks for
`gemini-extension.json` directly at the archive root, unconditionally. This
is exactly the kind of vendor-documentation mismatch R20 exists to catch
before the path is documented as default, and it is a **live, reproducible
disagreement with the documentation**, not a hypothetical one.

**Fix applied to `scripts/release-package-extension.sh`:** the archive is
now built as `tar -czf archive.tar.gz -C build/extensions/hello-world .` —
every file (including `gemini-extension.json`) placed directly at the
archive root, with NO wrapper directory. This is a real, load-bearing
correction to the implementation the probe forced, made in the same commit
as this runbook.

## Attempt 2 — PASSED

The corrected archive (no wrapper directory), published as a fresh release
on a fresh tag (`hello-world-v1.7.1-fix`, same scratch repository, exactly
one asset verified beforehand):

```sh
$ gemini extensions install https://github.com/hcross/crewrig-probe-1008 \
    --ref hello-world-v1.7.1-fix --consent
```

`~/.gemini/extensions/hello-world/.gemini-extension-install.json` after
install:

```json
{
  "source": "https://github.com/hcross/crewrig-probe-1008",
  "type": "github-release",
  "ref": "hello-world-v1.7.1-fix",
  "releaseTag": "hello-world-v1.7.1-fix"
}
```

**Verdict: PASSED.** `type == "github-release"` — the true release-asset
resolution path was used, not the silent git-clone degradation. The file
records `releaseTag`, not a version (confirming the plan's own note: the
tool ignores the manifest version entirely for install-metadata purposes —
do not look for one there). No `autoUpdate` / `allowPreRelease` keys appear
because neither flag was passed to `install`.

## Pinned form (R20's own deliverable)

- **Archive layout:** a plain gzipped tar with **every file at the archive
  root** — `gemini-extension.json` included. **No top-level wrapper
  directory is tolerated**, contradicting the installed tool's own bundled
  documentation on this point; this project keeps the observed (stricter)
  behaviour, not the documented one.
- **Manifest location:** `gemini-extension.json` at the archive root
  (per the above — there is no "one level down" case that works).
- **Asset naming the tool resolves:** the tool's own `findReleaseAsset`
  resolves the release's single asset generically when the release carries
  **exactly one asset** (independently re-verified against the tool's own
  source during PLAN review; not re-derived here) — no platform-prefixed
  name is required for a project that ships one archive per release.
- **Credential:** `GITHUB_TOKEN` only for a private repository (not
  exercised in this probe, whose scratch repository is public).
- **Detection:** read `~/.gemini/extensions/<name>/.gemini-extension-install.json`
  and require `type == "github-release"`; `type == "git"` is a failed probe
  even when the install command itself printed success.

## An unrelated local-state finding, recorded for completeness

Between the two attempts, a second, unrelated error surfaced once:
`Extension integrity store cannot be verified. Please delete
~/.gemini/extension_integrity.json to reset it.` This is a LOCAL
machine-state cache (a signature store, not the extension's own data) that
had drifted after the failed first install attempt left `hello-world`
partially registered; the tool's own error message names its own
remediation. Backed up (`/tmp/extension_integrity.json.bak`) before
following it. Not a release-format finding — recorded here only because it
occurred during this procedure and a future operator repeating it should not
be surprised by it.

## Cleanup

Reverse every side effect this procedure created, in order:

1. `gemini extensions uninstall hello-world` — **done** (removes the probe
   install; the machine this probe ran on had no pre-existing "hello-world"
   state to restore).
2. `gh release delete <tag> --repo hcross/crewrig-probe-1008 --yes`, for
   both tags — **done**; the scratch repository carries zero releases and
   zero assets as of this writing.
3. `gh repo delete hcross/crewrig-probe-1008 --yes` — **NOT done**: the
   authenticated `gh` token lacks the `delete_repo` OAuth scope, and
   granting it (`gh auth refresh -h github.com -s delete_repo`) requires an
   interactive browser approval this procedure could not complete headless.
   The scratch repository is public, empty of releases and assets, and
   named and described as a throwaway probe artifact
   (`crewrig/crewrig#1008`); it carries no secret and no artifact under
   test. **Follow-up required**: either the account owner deletes
   `hcross/crewrig-probe-1008` via the GitHub UI, or grants the
   `delete_repo` scope and re-runs step 3.
4. The local scratch clone (`/tmp/probe-repo`) and candidate archives are
   `mktemp`-rooted or under `/tmp`, requiring no separate cleanup beyond
   normal `/tmp` hygiene.

No `docs/` file names install-from-release the default operating mode as of
this change; that documentation move is out of this ticket's scope (spec
0183's own Out of scope defers the authoring-documentation surface to
sub-spec S6, issue #1009) and SHALL NOT happen before a runbook exists — this
one does now, but the S6 documentation pass is a separate ticket's work.
