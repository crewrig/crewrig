# Introduction

<!-- crewrig-doc: section=introduction nav_order=10 published=true title="Introduction" -->

CrewRig is a centralized configuration framework for three command-line AI
coding assistants — [Gemini CLI](https://github.com/google-gemini/gemini-cli),
[Claude Code](https://claude.ai/code), and
[GitHub Copilot CLI](https://docs.github.com/copilot/github-copilot-in-the-cli).
Rather than configuring each tool by hand and re-doing the work for every
teammate and every project, CrewRig holds a single source of truth and compiles
it into the directory layout each tool expects.

This page is the orientation a newcomer needs: what the framework is, the five
pillars it stands on, and where to read next.

## The mental model

CrewRig sits **between** you and the AI assistants. You edit source files once,
in this repository; build and setup scripts deploy them into each tool's
configuration directory (`~/.gemini/`, `~/.claude/rules/`,
`~/.copilot/instructions/` for context, plus project-scoped outputs for skills
and agents). Three concerns share that pipeline:

- **Who the assistant is for you** — a layered stack of context files that
  encode your identity, seniority, team, role, and tooling.
- **What capabilities it has** — reusable skills, agents, and commands authored
  once and compiled to every tool.
- **How the framework improves itself** — a feedback loop where agents report
  the frictions they hit, and those reports become tracked work.

CrewRig develops itself using its own mechanics: the internal agent crew
(architect, developer, tester, pr-logbook, pr-reviewer) runs on the same skills
and agents that ship with the framework. The development workflow is the product
in action.

## The five pillars

Every agent and contributor should understand these five pillars. They are the
load-bearing ideas; the rest of the documentation elaborates them.

1. **Layered context system engineering** — priority-ordered context files
   (numbered 00–60) deployed to each tool's user directory shape how the
   assistant behaves for a specific user's identity, role, team, and seniority.
2. **Shared cross-tool memory** — MemPalace provides persistent agent memory
   that survives across sessions and across tools, so context built up in one
   CLI is available in another.
3. **Skill, agent, and command authoring** — `artifacts/` is the single-source
   zone where these components are written once and compiled by
   `scripts/build-components.sh` into outputs for all three supported tools.
4. **Harness engineering** — a built-in feedback loop where agents invoke the
   `harness-report` skill to tag frictions during real work, and the
   `harness-curator` skill clusters those frictions into actionable GitHub
   issues.
5. **Multi-CLI parity** — features are implemented symmetrically across the
   three tools. Silent asymmetry is prohibited; every parity gap requires
   concrete evidence that the missing mechanism does not exist in the target
   tool.

These five pillars are also stated normatively in
[`AGENTS.md`](../AGENTS.md), the working-rules document every agent loads.

## The development lifecycle

Non-trivial work in CrewRig flows through a four-stage lifecycle —
**SPECS → PLAN → DEV → REVIEW** — where a review pass routes findings back to
the stage that can fix them, and the cycle terminates only when a full review
produces zero findings. The full contract lives in
[ADR-0010](adr/0010-spec-plan-review-lifecycle.md); the working rules layer the
operational protocol on top of it in [`AGENTS.md`](../AGENTS.md).

## Where to read next

- New to the concepts? Read [Core concepts](concepts.md) for the layered
  context system, the layering model, parity, memory, and the harness loop.
- Adopting CrewRig for your organization? Start with the
  [Adoption guide](adoption-guide.md), then the
  [Layer taxonomy and boundary contract](layers.md).
- Building your own components? See
  [Authoring skills, agents & commands](authoring.md).
- Curious how the framework improves itself? See
  [Harness engineering](harness-engineering.md).
