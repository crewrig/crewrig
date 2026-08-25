# Extension context delivery and invocation-reference evidence (spec 0181 R10/R11, issue #1007)

Scope: pin, per target command-line tool, (a) the location that tool
demonstrably ingests as a plugin-scoped context, and (b) the invocation
reference it honors for a plugin command and a plugin skill — BEFORE either
is declared mapped (PLAN step 1). Structured like
`tests/gemini-extension-path-form.md` and
`docs/runbooks/antigravity-discovery-probe.md`: Method / Environment /
verdict per target. This step decides PLAN steps 9 and 10, so it runs first.

## Claude Code

**(a) Context location.** Not re-probed here: the delivery mechanism is
unchanged by this ticket (a file copied into the built plugin at its root,
`scripts/build-claude-plugin.sh`'s existing `CLAUDE_CONTEXT` copy), only the
manifest key that names it moves from authored (`claude.contextFileName`) to
render-supplied (R8). The location itself — the built plugin's own root,
where `--plugin-dir`/the marketplace loader already reads `CLAUDE.md` today
— is the SAME location `extensions/core/hello-world/CLAUDE.md` already
reaches, unaffected by this change.

**(b) Invocation reference.** Documented, not re-probed:
`extension-skeleton/EXTENSION-FORMAT.md:80` — "For Claude Code: also the
plugin namespace (skills become `/name:skill`)". The reference extension's
own committed `CLAUDE.md` already asserts the same form for both a command
and a skill: `` `/hello-world:hello` command`` and
`` `/hello-world:greeter` skill``. **Verdict: MAPPED.** Namespaced,
`` `/{ext}:{name}` `` for both commands and skills.

## Gemini CLI

**(a) Context location.** Not re-probed: R9 keeps the existing delivery —
inside the rendered installable tree (`build/extensions/<name>/GEMINI.md`),
sibling to `gemini-extension.json`, which the tool loads when the extension
is installed from that tree (spec 0173's own grounding, re-affirmed by
`tests/gemini-extension-path-form.md`). Only the manifest key that names it
moves from authored to render-supplied.

**(b) Invocation reference.** The reference extension's own committed
`GEMINI.md` and `copilot-instructions.md` establish the form empirically: a
command renders bare, no namespace (`` `/hello` `` — the SAME string on both
Gemini and Copilot, confirming neither namespaces). No source in the tree
pins a *skill* invocation form for Gemini specifically — the committed
`GEMINI.md` says `Greeter skill` (a hand-written capitalized name, not an
invocation reference at all). Absent a pinned slash form, the descriptor
carries the render's own declaration-checked identifier — `` `{name}` ``,
bare, no slash — per specs/0181-extension-context-pivot.md step 6's
*Preservation result* (the one recorded deviation, `10c10` against the
committed `GEMINI.md`). **Verdict: MAPPED**, command bare
(`` `/{name}` ``), skill bare-no-slash (`` `{name}` ``) — the deviation is
recorded at its point of use (step 6), not invented here.

## Antigravity CLI

**(a) Context location.** Live probe. A throwaway plugin was written to the
REAL customization root the vendor documents
(`~/.gemini/config/plugins/crewrig-probe-ctx-1007/`, per
`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/plugins.md:20-21,57-59`,
the assumed location this requirement names) — never an isolated `$HOME`,
because `agy -p` requires the real, already-authenticated account and an
isolated `$HOME` breaks auth (`Error: authentication required`, observed
directly). Same pattern as
`docs/runbooks/antigravity-discovery-probe.md`: sentinels written under the
real root, a bounded `agy -p` call, then removed.

```text
~/.gemini/config/plugins/crewrig-probe-ctx-1007/
├── plugin.json                          {"name": "crewrig-probe-ctx-1007"}
├── rules/AGENTS.md                      "SENTINEL-CONTEXT-1007-QZPX is the secret sentinel word..."
└── skills/probe-skill-1007/SKILL.md     name: probe-skill-1007
```

Prompt: `agy -p "Reply with exactly one line: SENTINEL=<word> where <word>
is the secret sentinel word from any currently loaded plugin
rules/context, or SENTINEL=NONE if none. No explanation."`

Output: `SENTINEL=SENTINEL-CONTEXT-1007-QZPX`

The rule file was loaded as active context with no install step beyond
placing it at the documented path. `docs/runbooks/antigravity-discovery-probe.md`
records that reading the vendor guide alone already produced a wrong
discovery claim once (for agents) — this probe is the reason the location
is recorded as MEASURED, not merely read off the doc a second time.

**(b) Invocation reference.** Same probe session, second call:
`agy -p "List the names of every skill you currently have available, one
per line, exactly as you would invoke or refer to each one. Include any
skill related to 'probe-skill-1007'."` — the listing (21 skills) included
`probe-skill-1007` **bare**, with no `crewrig-probe-ctx-1007:` plugin-name
prefix, alongside every other installed plugin's skills (`asm-to-c-port`,
`obsidian-weekly-goals`, …), none of them prefixed either. A third call
confirmed the rule content is actually reachable, not merely listed: `agy -p
"Use the probe-skill-1007-context skill/instructions and reply with SENTINEL=<word>..."`
→ `SENTINEL=SENTINEL-CONTEXT-1007-COPILOT-VJKQ` (that specific transcript is
the Copilot probe below; the Antigravity skill-content check is the
sentinel-listing call above, since Antigravity's skills are referenced by
name in prose rather than invoked with an explicit tool call). No source in
the tree pins a *command* form for Antigravity either — the builder
compiles a command pivot into a skill for this target
(`scripts/build-antigravity-extension.sh:161-191`), so its invocation
reference is the SAME bare-name form as a skill's.

**Environment.** `agy` 1.1.20, macOS (arm64), 2026-08-25. Cleanup: `rm -rf
~/.gemini/config/plugins/crewrig-probe-ctx-1007` — verified removed
(`ls ~/.gemini/config/plugins/` afterward listed only the three
pre-existing, unrelated plugins: `gemini-cli-security`, `obsidian`,
`snes-re`).

**Verdict: MAPPED.** Location `plugins/<name>/rules/AGENTS.md` under the
documented customization root, confirmed by direct observation rather than
documentation alone. Both command and skill references are bare, no
namespace, no slash — `` `{name}` ``.

## GitHub Copilot CLI

**(a) Context location.** `copilot plugin --help`'s own summary: "Plugins
extend Copilot CLI with additional skills, agents, hooks, MCP servers, and
LSP servers" — no context, instructions or rules surface named at all. This
matches spec 0181's own open-question grounding (no plugin-scoped context
surface exists) and is why R11 delivers context as a skill instead — the
same surface the build already uses for this target's commands. R11
requires that surface itself to be pinned by live evidence before it is
declared mapped, since (per the spec's own open question) nothing in the
tree recorded it before this ticket.

Live probe, session-scoped only (`--plugin-dir`, no persistent
registration, nothing written under `~/.copilot/`):

```text
<tmp>/probe-ctx-plugin/
├── plugin.json
└── skills/probe-skill-1007-context/SKILL.md   name: probe-skill-1007-context
                                                user-invocable: true
                                                body: "SENTINEL-CONTEXT-1007-COPILOT-VJKQ is the secret sentinel word..."
```

Call 1 — `copilot --plugin-dir <tmp>/probe-ctx-plugin --allow-all-tools -p
"List the names of every skill you currently have available, one per
line..."` — the listing (28 skills) included `probe-skill-1007-context`
**bare**, no `probe-ctx-plugin:` prefix, alongside every other repository
skill (`architect`, `harness-report`, `obsidian-weekly-goals`, …).

Call 2 (fresh invocation, same plugin dir) —
`copilot --plugin-dir <tmp>/probe-ctx-plugin --allow-all-tools -p "Use the
probe-skill-1007-context skill/instructions and reply with exactly one
line: SENTINEL=<word>..."` — transcript shows `● skill(probe-skill-1007-context)`
then `SENTINEL=SENTINEL-CONTEXT-1007-COPILOT-VJKQ`: the skill was invoked
by name and its body content was reachable, not merely listed.

**(b) Invocation reference.** The committed `copilot-instructions.md`
already asserts the form for a command-derived skill
(`` `/hello` skill``) and a native skill (`` `/greeter` skill``) — both bare,
with a leading slash, no plugin-name prefix. The live probe's own listing
(bare `probe-skill-1007-context`, no prefix) is consistent with that;
neither the file nor the probe shows a namespaced form anywhere on this
target.

**Environment.** GitHub Copilot CLI `1.0.80`, macOS (arm64), 2026-08-25.
Cleanup: the plugin directory lived entirely under `mktemp -d`; removed
after the second call. No `~/.copilot/` state was touched (`--plugin-dir`
is session-scoped, confirmed by its own warning text — when given no
argument on a bare invocation from the repo working tree, it printed
"no plugin.json or SKILL.md found" rather than falling back to any
persistent registration).

**Verdict: MAPPED.** R11's assumed design — a user-invocable skill of the
built plugin, the same surface the build already uses for commands —
resolves against the SAME evidence R11 required before declaring it: this
is not the R12 gap path. `extensions/core/hello-world/accepted-gaps.json`
therefore gains no new `context`/`copilot` row from this ticket.

## Decision this step feeds (PLAN steps 9/10)

All four targets MAP. No target takes the R12 gap fallback: step 9's
conditional `accepted-gaps.json` entry for Copilot is NOT produced (the
probe confirms the assumed design, it does not refute it) and step 10's
Antigravity location is exactly the one `specs/0181-extension-context-pivot.md`'s
*Open questions* names as already resolved in-spec, now measured rather
than only documented.
