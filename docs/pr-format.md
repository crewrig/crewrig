<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Pull Request Format

<!-- crewrig-doc: published=false -->

Every PR must follow this structure:

## Title

A concise, descriptive title.

## Body

```markdown
<Two sentences maximum explaining the purpose of this PR for a human reader.>

## How to read this PR?

<A reading guide to help reviewers navigate the changeset. Highlight key files,
the order in which to read them, and any non-obvious design decisions.>

## How to test this PR?

<Step-by-step instructions to test the proposed changes locally.
Include prerequisites, commands to run, and expected outcomes.>

## Detailed description (for agents)

<A thorough, structured description of every change made in this PR.
This section is intended for AI agents that will analyze the PR.
Be explicit about what was added, modified, or removed and why.>
```

## Continuous Integration directives

GitHub concatenates all branch commit bodies into the default squash commit
message when merging a PR. Continuous integration platforms (including GitHub
Actions) honor skip directives (such as `[skip ci]`, `[ci skip]`, `[skip actions]`)
appearing **anywhere** within a push commit message on `main`.

**Rule — never write unescaped CI skip directives.** Branch commit messages and
PR bodies SHALL NOT contain literal unescaped CI skip directives (e.g. `[skip ci]`).
When referring to CI skip behaviors in prose, documentation, or commit descriptions,
always use an escaped or descriptive form (such as `skip-ci` or `[skip-ci]`) to
prevent accidental suppression of build, test, analysis, and release pipelines
on `main`.
