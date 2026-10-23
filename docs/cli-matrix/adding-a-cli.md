# Adding a new CLI

Every checklist item below is governed by the **Symmetric-script rule**
and **Gap-acceptance evidence rule** in `AGENTS.md` → *CLI Matrix
Maintenance*. Unchecking an item requires the evidence the gap rule
demands; it is not a free-form choice.

Use this checklist when onboarding a new CLI. Each item maps to a row in
the feature matrix above — leaving one unchecked produces a parity gap.

1. [ ] Create the workspace config root (`./.<cli>/`).
2. [ ] Add a top-level agent-context entry point that re-exports `AGENTS.md` (analogous to `CLAUDE.md`).
3. [ ] Extend `scripts/build-components.ts` with a `--target <cli>` branch and emit skills via the tier-routed output root (`output_root_for_tier`): `core` → `.<cli>/skills/<name>/SKILL.md` in the project tree; non-`core` → `dist/<tier>/.<cli>/skills/<name>/SKILL.md` (or the native form). The build is tier-agnostic — do not hardcode tier names.
4. [ ] Extend `build_agents` in the same script to emit agents in the CLI's native layout.
5. [ ] Extend `build_commands` in the same script to emit commands in the CLI's native form.
6. [ ] Add a per-CLI settings template under `config/<cli>/`.
7. [ ] Decide whether a checked-in workspace settings file at `.<cli>/settings.json` is required, and add it if so.
8. [ ] Provide a hook-integration manifest under `hooks/<cli>-transcript-hooks.json` covering the CLI's lifecycle events.
9. [ ] Document the CLI's project-dir env var convention and wire `hooks/mempalace-transcript.ts` to read it.
10. [ ] Add an interactive setup entry `scripts/setup-<cli>-interactive.ts` (modules under `scripts/lib/setup/`, spec 0256), including the artifact-install phase that reads `dist/<tier>/` and routes by tier scope: `library` auto-installed to the user home, `community`/`org` each behind an opt-in prompt (ADR-0011, spec 0019). `core` is never installed here — it ships in the project tree.
11. [ ] Add a transcript backfill script `scripts/import-<cli>-history.ts` (spec 0253).
12. [ ] Add or extend a component-management script for the CLI.
13. [ ] If the CLI requires a build step before install, add `scripts/build-<cli>-plugin.ts` (or equivalent).
14. [ ] If a separate install step is required, add `scripts/install-<cli>-plugin.ts`.
15. [ ] Register `--target <cli>` invocations and the `setup-`, `import-`, `install-`, `link-`, and `build-components-` task entries in the matching `taskfiles/*.yml` domain files (`setup.yml`, `extensions.yml`, `components.yml`, ...; these groups are flattened, so keep their unprefixed names). Add the file to the root `includes` only if you create a new one (see `DEVELOPMENT.md` → *Taskfile layout*).
16. [ ] Add a per-CLI extension manifest convention to `extension-skeleton/` and update `extensions/core/hello-world/` with an example.
17. [ ] Add a CI workflow `.github/workflows/<cli>.yml` if the CLI offers an automation entry point.
18. [ ] Update prose references in `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, and `DEVELOPMENT.md`.
19. [ ] Add `.gitignore` carve-outs for the CLI's local settings and any generated `dist-<cli>-*` directories.
20. [ ] Append a new column to this matrix and re-check every row.
