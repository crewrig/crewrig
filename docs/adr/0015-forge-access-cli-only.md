# ADR 0015 — Forge access CLI-only; no framework forge MCP

<!-- crewrig-doc: section=architecture-adr nav_order=150 published=true title="ADR 0015 — Forge access CLI-only; no framework forge MCP" -->

**Status:** Accepted (issue #617; owner-validated 2026-07-21)

## Framing

- **Goal.** Make forge access (issues, PRs/MRs, branch protection) uniform and
  vendor-neutral across all four CLIs, and stop shipping a forge credential in
  a plaintext config default.
- **Constraints.** Multi-CLI parity (AGENTS.md → *Multi-CLI parity*); the
  "forkable by as many people as possible" + sovereignty promise; the
  overlay/core layer boundaries (spec 0020, `docs/layers.md`); no silent
  capability regression for an adopter who genuinely wants a forge MCP.
- **Non-goals.** Building the org-level MCP declaration mechanism (a derived
  spec); fixing setup-script overwrite behaviour (issue #616 / spec 0089);
  changing MemPalace or SequentialThinking; touching native `git` usage.

## Context

The framework's forge-access story is internally contradictory and
CLI-asymmetric today:

- **Core rules mandate MCP-first.** `artifacts/core/rules/60-tools.md` (l.72–75)
  states "The GitHub MCP server MUST be used as a priority for all GitHub
  interactions, except for native `git` commands", and `AGENTS.md` (l.418)
  repeats it: "All GitHub operations ... are performed through the dedicated
  MCP server."
- **Real practice is CLI-first.** `AGENTS.md` itself drives merges with
  `gh pr merge` (l.173); the priority-65 org-tools layer (deployed from the
  overlay `config/TOOLS.md`) is the sanctioned home for forge-CLI preference,
  and the reference operator's layer-65 uses `gh`/`glab`/`tea` explicitly.
- **The forge MCP is already asymmetric.** Only 2 of 4 CLIs ship it:
  `config/gemini/settings.json` (l.32–37) and
  `config/copilot/mcp-config.json.template` (l.3–9) hardcode the GitHub-hosted
  endpoint `https://api.githubcopilot.com/mcp/` with
  `Authorization: Bearer $GITHUB_PAT`. Claude Code registers only `mempalace`
  and `sequentialthinking` (`scripts/setup-claude-interactive.sh` l.158–248),
  and Antigravity starts from an empty `mcpServers` and patches only those two
  (`scripts/setup-antigravity-interactive.sh` l.195–222). Neither ever had a
  forge MCP.
- **The endpoint is GitHub-only.** A GitLab or Gitea adopter cannot use
  `api.githubcopilot.com/mcp/` at all — it contradicts the sovereignty and
  vendor-neutrality promise.
- **Secret hygiene.** `$GITHUB_PAT` (defined in `config/.env.example` l.4, the
  one core/strict file among these) is interpolated verbatim into a plaintext
  `Authorization` header in the two shipped config defaults.

## Decision

Forge access is **CLI-only**, and the framework ships **no forge MCP server**.

**1. Forge-access policy.** All forge operations (issues, PRs/MRs, branch
protection, releases) go through the forge's own CLI — `gh` (GitHub),
`glab` (GitLab), `tea` (Gitea) — with authentication delegated to the CLI
(`gh auth login`, `glab auth login`, `tea login`). Native `git` remains the
tool for ordinary version control. Core rules realign to this: the
`60-tools.md` *GitHub MCP Server* section is rewritten CLI-first, and the
`AGENTS.md` *GitHub Access* section is both rewritten CLI-first **and renamed
*Forge Access*** — GitLab and Gitea are now first-class, so the GitHub-specific
section name no longer fits.

**2. The `github` MCP block is removed, not made optional.** It is deleted from
`config/gemini/settings.json` and `config/copilot/mcp-config.json.template`,
and `$GITHUB_PAT` is dropped from `config/.env.example` and both headers. A
shipped-but-optional server would still carry the PAT template and the same
60↔65 contradiction into every new setup (see *Alternatives*, option ii).

**3. MCP embedding model — three layers.**

| Layer | Owner | Contents | How it is installed |
|---|---|---|---|
| **Framework** | Upstream | MemPalace + SequentialThinking (each individually omittable at setup, e.g. `setup-gemini-interactive.sh` l.203–206). **No forge MCP.** | The `setup-*-interactive.sh` scripts. |
| **Org** | Adopting org | Any org-specific MCP server, **including a re-added forge MCP** (github/gitlab/gitea). | Declared once via an org-level MCP channel that mirrors `AGENTS.org.md` (spec 0020), then **merged** into each CLI's native MCP config, **never overwritten**. Depends on issue #616 (spec 0089). |
| **User** | Individual | Personal MCP servers (e.g. `claude mcp add --scope user`). | Out of scope; neither precluded nor managed here. |

Reclassifying the forge MCP from *framework* to *org* also corrects the stale
"Framework MCP servers (MemPalace, SequentialThinking, GitHub)" note in
`config/TOOLS.md.template` (l.57).

## Alternatives considered

| Option | What it buys | At the cost of | Verdict |
|---|---|---|---|
| **A. CLI-only, forge MCP removed** *(chosen)* | Parity across 4 CLIs; vendor neutrality; no plaintext PAT default; 60↔65 coherence | Loses the typed MCP tool surface for Gemini/Copilot; depends on `gh`/`glab`/`tea` being installed | **Accepted** |
| **i. Keep MCP-first, make the server forge-agnostic** | One typed tool surface across forges | Requires GitLab/Gitea MCP servers at GitHub's maturity — they do not exist at that level; a per-forge shim is a new abstraction to build and maintain | Rejected |
| **ii. Keep the `github` MCP, but opt-in / optional** | Backward-compatible for GitHub shops | A shipped-but-optional server still ships the `$GITHUB_PAT` header template and preserves the 60↔65 contradiction for every new adopter; "optional" is where the PAT default keeps leaking in | Rejected (owner) |
| **iii. Let the adopter choose CLI-or-MCP at install time** | Maximum adopter flexibility | Pushes an unresolved policy contradiction onto every adopter and doubles the parity surface (both paths must be tested on all 4 CLIs, forever) | Rejected |

Each rejected option was given a fair hearing:

- **(i)** is the "right" answer in a world where a mature, forge-agnostic MCP
  exists. It does not. The GitHub-hosted endpoint is GitHub-specific by
  construction; there is no equivalent third-party MCP for GitLab/Gitea at the
  same maturity. Adopting (i) means the framework builds and maintains that
  abstraction — squarely against "simplest design that satisfies the
  requirement".
- **(ii)** is the smallest diff, and tempting. It fails on secret hygiene: the
  PAT header template ships regardless of the opt-in default, so the plaintext
  credential pattern remains the framework's blessed example. It also leaves
  `60-tools.md`/`AGENTS.md` asserting MCP-first while the default is off —
  the contradiction persists, just quieter.
- **(iii)** looks adopter-friendly but is the worst for maintainers: it makes
  the contradiction a permanent, first-class configuration axis. Every future
  change to forge access must reason about both branches on four CLIs.

The tie is broken by the parity + sovereignty constraint: option A is the only
one that removes the asymmetry (2-of-4 CLIs shipping a GitHub-only MCP) instead
of entrenching or duplicating it.

## Consequences

### Blast radius

- **Core, normative (strict layer):** `artifacts/core/rules/60-tools.md`
  (rewrite *GitHub MCP Server* → CLI-first), `AGENTS.md` (rewrite *GitHub
  Access* → CLI-first **and rename it *Forge Access***), `config/.env.example`
  (drop `GITHUB_PAT`).
- **Overlay, shipped defaults (adopter-owned per `docs/layers.md`):**
  `config/gemini/settings.json`, `config/copilot/mcp-config.json.template`
  (remove `github` block), `config/TOOLS.md.template` (drop GitHub from the
  framework-MCP note).
- **CLI-matrix trigger:** edits under `config/gemini/**` and the
  `scripts/setup-*.sh` surface fire the *CLI Matrix Maintenance* obligation
  (AGENTS.md) — `docs/cli-matrix.md` updates in the same diff.
- **Manifest:** no `.crewrig/core-paths.txt` change — no core path is
  added, removed, or reclassified.
- **Reversibility:** the removal (specs) is a trivial revert; the org-MCP
  mechanism is a one-way abstraction (awkward to remove once adopters depend
  on it) — hence it earns its own spec.

### Easier

- **Vendor neutrality restored.** GitLab/Gitea adopters are no longer shipped a
  dead GitHub endpoint. Forge choice becomes "which CLI is installed", not "is
  my forge GitHub".
- **Secret hygiene.** No plaintext `Bearer $GITHUB_PAT` in any shipped default;
  auth moves to the CLIs' own credential stores (`gh auth`, `glab auth`,
  `tea login`).
- **Parity by subtraction.** All four CLIs converge on the same forge story
  (CLI + native `git`); the 2-of-4 asymmetry disappears.
- **Coherence.** `60-tools.md`, `AGENTS.md`, and the priority-65 org layer stop
  contradicting each other.

### Harder

- **Loss of the typed tool surface.** For Gemini/Copilot agents the `github`
  MCP exposed schema-validated tools; those agents now shell out to `gh`/`glab`
  and parse `--json` output. This is a real ergonomic downgrade for the two
  CLIs that had it (assumption to weigh — see the final risk note).
- **CLI availability becomes a precondition.** `gh`/`glab`/`tea` must be
  installed and authenticated; the framework should say so where it previously
  assumed an MCP endpoint.
- **Re-adding a forge MCP is now an org task.** A GitHub-only shop that wants
  the MCP back must use the org-MCP mechanism — which does not exist until the
  derived spec + #616 land.

### Security

Net improvement: one plaintext-credential default is deleted, and forge auth
delegates to the CLIs' existing (often OS-keychain-backed) credential handling
instead of an env-interpolated header.

### Parity implications (Claude / Gemini / Copilot / Antigravity)

- Claude and Antigravity: **no behavioural change** — neither shipped a forge
  MCP.
- Gemini and Copilot: the `github` block is removed from their shipped config
  defaults; new setups no longer register it.
- The org-MCP mechanism must deliver to all four CLIs with no silent gap
  (AGENTS.md → *Multi-CLI parity*); that parity work is scoped into its spec.

### Existing adopters — migration note, not active cleanup

The removal changes the **shipped default** for new setups only. It does **not**
rewrite an existing adopter's deployed `~/.gemini/settings.json` or
`~/.copilot/mcp-config.json`: those live in the overlay layer (adopter-owned per
`docs/layers.md`; `config/gemini/**` and `config/copilot/**` are absent from
`.crewrig/core-paths.txt`), and the upstream sync never touches them.

Automated scrubbing is not just out of scope — it would **contradict** the
merge-not-overwrite semantics of issue #616 (spec 0089). Once #616 lands, the
setup scripts merge only the framework-managed servers
(`mempalace`/`sequentialthinking`) and preserve every other pre-existing
`mcpServers` entry (the `(.mcpServers // {}) + {managed}` idiom already used by
`manage-{copilot,antigravity,workspace}-component.sh`). A leftover `github`
block is therefore an **unmanaged** entry the setup deliberately preserves;
having setup delete it would re-introduce the very clobbering #616 removes.

Consequence: an existing adopter who wants the old `github` MCP gone removes the
block and `$GITHUB_PAT` from their own deployment. Spec 0090 SHALL ship a short
migration note (in the ADR/spec and the changelog) documenting exactly that.

## Derived spec plan

Two `standard` specs, **not** a single `large` parent. The two units have
different dependencies and different risk profiles, and each is independently
reviewable and mergeable; coupling them under a `large` umbrella would gate the
fast security win on the slower new-abstraction work for no benefit.

| # | Spec (proposed id) | Scope | Depends on | Tier |
|---|---|---|---|---|
| 1 | **Forge access CLI-only** (0090) | Remove the `github` MCP block from `config/gemini/settings.json` + `config/copilot/mcp-config.json.template`; drop `$GITHUB_PAT` from `config/.env.example` + both headers; rewrite `60-tools.md` *GitHub MCP Server* CLI-first; rewrite **and rename** `AGENTS.md` *GitHub Access* → *Forge Access* CLI-first; fix the `config/TOOLS.md.template` framework-MCP note; ship the existing-adopter **migration note** (ADR/spec + changelog); update `docs/cli-matrix.md`. | nothing | `standard` |
| 2 | **Org-level MCP declaration mechanism** (0091) | A single org-owned MCP declaration channel mirroring `AGENTS.org.md`/spec 0020, fanned out and **merged** into each CLI's native MCP config by the setup scripts; documents how an org re-adds a forge MCP. | **#616 / spec 0089** (merge-not-overwrite) as a hard technical prerequisite; **spec 0090** for the CLI-first baseline it documents | `standard` |

**Ordering.**

1. **#616 / spec 0089** (merge-not-overwrite) and **spec 0090** (removal) are
   independent and MAY run in parallel. Spec 0090 delivers the security +
   coherence win immediately and blocks nothing.
2. **Spec 0091** (org-MCP mechanism) starts only after #616 is merged (its
   merge-not-overwrite behaviour is what makes org MCP declarations durable)
   and reads best after 0090 has established the CLI-first baseline it
   references.

Proposed ids 0090/0091 are provisional (highest current spec is 0088; #616 is
0089) and are the spec-author's to finalise.

## Open questions

- **Org-MCP declaration format/location.** The ADR fixes the *model* only —
  a single org channel, merged, delivered to all four CLIs. The concrete
  format stays a HOW decision for spec 0091, to be confirmed at its PLAN
  stage. **ADR recommendation:** a single CLI-agnostic manifest (a JSON MCP
  list translated into each CLI's native `mcpServers` shape at setup),
  preferred over per-CLI overlay edits because it declares once and mirrors
  `AGENTS.org.md` (spec 0020) faithfully.
