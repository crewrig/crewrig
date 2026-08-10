---
id: "0123"
slug: antigravity-components-discoverable
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 761
version: 1.0.0
---

# Antigravity components land where the CLI finds them

## Intent

A skill or an agent that the framework installs for Antigravity CLI is one
that Antigravity CLI actually finds. Today it is not: the skills the setup
run reports as installed are placed where the assistant never looks, so every
framework skill shipped to that assistant is inert on the user's machine,
and no agent is placed at all — the install step announces nothing and
completes as though it had succeeded. A user who has run the Antigravity
setup therefore sees none of the framework's skills offered in a session and
none of its agents in the agent list, with nothing in the run's output to
suggest anything is missing. After this spec is realized, a completed
Antigravity setup leaves every component it claims to have installed where
the assistant finds it, a machine set up under the superseded placement keeps
no orphaned framework component behind, an install step that places nothing
says so instead of passing quietly, and the framework's own record of where
Antigravity components live states what has been observed of the assistant
rather than what its documentation implies.

## Requirements

1. Every skill and every agent the framework installs for Antigravity CLI
   SHALL be placed at a location Antigravity CLI discovers.
2. The framework SHALL install skills and agents for Antigravity CLI under a
   single customization root, and that root SHALL be the machine-local
   customization root the vendor documents.
3. An installed Antigravity component SHALL carry the on-disk shape
   Antigravity CLI recognizes for its kind, whether or not that shape matches
   the one the build stages.
4. Every component the build stages for Antigravity CLI in a tier a setup run
   serves SHALL be present at the install target once that run completes.
5. A setup run SHALL NOT report a component as installed for Antigravity CLI
   unless that component is present at the install target when the run ends.
6. A setup run that finds staged Antigravity components and places none of
   them SHALL report the discrepancy and SHALL NOT complete as though the
   tier had been installed.
7. Every per-component install surface the framework offers for Antigravity
   CLI SHALL place a component at the same location a full setup run places
   it.
8. A setup run on a machine set up under the superseded placement SHALL leave
   no framework-installed skill or agent at the superseded location.
9. A setup run SHALL leave content at the superseded location that the
   framework did not install untouched.
10. Every statement in the framework's CLI capability matrix that records
    where Antigravity skills or agents are placed, staged, or found SHALL
    agree with the observed behaviour of Antigravity CLI.
11. A recorded Antigravity placement that observed behaviour contradicts and
    that cannot be brought into agreement SHALL carry a gap marker whose
    stated evidence is the observation that contradicts it.
12. The framework's record of Antigravity discovery SHALL state, for each
    component kind, whether the discovery claim rests on vendor
    documentation, on observation of the assistant, or on both.
13. The framework SHALL retain a re-runnable procedure that re-establishes
    which locations Antigravity CLI discovers for each component kind.
14. The procedure of requirement 13 SHALL distinguish a component the
    assistant does not find from an assistant that failed to answer, so that
    a transient non-answer is not recorded as absence.

## Scenarios

**Scenario:** a freshly set-up machine offers the framework's Antigravity skills

```text
Given a machine with no prior Antigravity customization root
When  `task setup-antigravity-interactive` completes its component install
      step for the `library` tier
Then  each installed skill is present under `~/.gemini/config/skills/<name>/`
      and a subsequent `agy` session lists that skill among the skills it can
      activate
```

**Scenario:** a freshly set-up machine offers the framework's Antigravity agents

```text
Given the build has staged one or more agents for Antigravity in the
      `library` tier
When  `task setup-antigravity-interactive` completes its component install
      step
Then  each staged agent is present under the same customization root as the
      skills, and `agy agents` lists it
```

**Scenario:** a per-component install lands where the full run lands

```text
Given a named component the framework serves for Antigravity
When  `scripts/manage-antigravity-component.sh` installs it
Then  it is placed at the same location `task setup-antigravity-interactive`
      would place it, and `agy` finds it there
```

**Scenario:** an install step that places nothing does not pass quietly

```text
Given the build has staged one or more agents for Antigravity in a served
      tier
When  a setup run completes its Antigravity component install step and places
      none of those agents at the install target
Then  the run reports the discrepancy and exits non-zero, instead of
      completing silently as though the tier had been installed
```

**Scenario:** a machine set up under the superseded placement is migrated

```text
Given a machine whose `~/.gemini/antigravity-cli/skills/` holds framework
      skills installed under the superseded placement, alongside a directory
      the user placed there themselves
When  `task setup-antigravity-interactive` runs again
Then  no framework-installed skill remains under
      `~/.gemini/antigravity-cli/skills/`, and the user's own directory is
      still present and unmodified
```

**Scenario:** the recorded placement is contradicted by the assistant

```text
Given a re-run of the procedure of requirement 13 shows that a location is
      not a discovery location for a component kind
When  a row of `docs/cli-matrix.md` records that location as where the
      framework installs that kind
Then  the disagreement is reported as a defect against the record, and the
      row is either corrected or carries a `[GAP]` naming that re-run as its
      evidence
```

## Out of scope

- **Registering the superseded location through `skills.json` instead of
  moving the components.** The vendor documents `skills.json` as the escape
  hatch for customizations kept outside the default discovery locations, and
  it is a genuine third option alongside moving and leaving. It is rejected
  here on three grounds: it ranks last in the vendor's own loading
  precedence, below plain global discovery; it introduces a second
  user-owned JSON file the framework would have to merge into without
  clobbering operator entries, a cost the framework already pays once for
  the MCP configuration; and its behaviour has never been observed on this
  assistant, whereas directory discovery under the documented root has been
  observed for both component kinds. Choosing an unobserved mechanism to fix
  a defect caused by trusting documentation over observation would repeat
  the mistake this ticket exists to correct.
- **Keeping agents at `~/.gemini/antigravity-cli/agents/` because that
  location was observed to work.** It was, and so was
  `~/.gemini/config/agents/`; both are discovery locations for agents, so
  moving costs nothing in discoverability. The superseded location is
  application data the vendor never documents as a customization root and is
  free to restructure on any upgrade, and keeping the two halves of one
  install on two roots would leave a placement asymmetry inside a single CLI
  that every later reader must be told is deliberate. Observed-today is not
  contracted-forever; the documented root is preferred for both kinds.
- **Automated enforcement of the discovery claim in continuous
  integration.** Establishing which locations the assistant discovers
  requires the vendor binary, a model-driven session, and minutes of wall
  time, none of which the project's checks have. Requirement 13 mandates a
  re-runnable procedure a human or an agent invokes deliberately, not a
  gate.
- **The placement of Antigravity rules and MCP server declarations.** The
  per-component install surface targets `~/.gemini/antigravity-cli/rules`
  and `~/.gemini/antigravity-cli/settings.json`, while the setup run writes
  its MCP configuration to `~/.gemini/config/mcp_config.json` — a
  disagreement of the same shape as the one this spec resolves for skills
  and agents. It is excluded because no observation covers those two kinds;
  asserting a defect there would rest on exactly the documentation-only
  reasoning that the observation for agents refuted. It warrants its own
  ticket, opened with a probe of its own.
- **The workspace-level customization root.** Per-project customizations
  discovered from a repository's own `.agents/` directory are unaffected;
  this spec concerns only what a setup run places in the user's home.
- **The priority-ordered context files, hooks, settings and history under
  the Antigravity application-data directory.** Those are not discovered as
  customizations: the context files are concatenated into the documented
  root's `AGENTS.md` per spec 0061, and the transcript hooks already deploy
  to the documented root per spec 0116. They stay where they are.
- **The install targets of the three sibling CLIs.** Nothing observed about
  Antigravity CLI says anything about Claude Code, Gemini CLI, or GitHub
  Copilot CLI, and none of their install paths changes here.
- **Whether Antigravity CLI reading the Gemini CLI agent root is desirable.**
  It was observed to do so. The framework neither relies on that coupling
  nor removes it, and this spec leaves the question untouched.

## Open questions

None. Four questions this spec carried while drafting are closed by decision
rather than left open. Whether the two component kinds move together is
settled in favour of a single root, with the reasoning recorded in `Out of
scope` above. Whether registration replaces relocation is settled in favour
of relocation, likewise recorded above. Whether components that are staged
but never placed belong to this ticket is settled by requirements 4 to 6: the
central property — that an installed component is one the assistant finds —
is unverifiable for a kind that is never installed at all, so excluding it
would leave half the spec vacuous. Whether the on-disk shape the build stages
for an agent is the shape the assistant recognizes is settled by requirements
3 and 13 together: the shape is constrained to whatever observation shows the
assistant to accept, and the observation is required to be re-runnable rather
than asserted once here.
