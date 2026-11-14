---
name: init-personal-profile
description: "Builds the user's personal profile file config/PROFILE.md through a guided interview and a scaffold script that renders and checks it. Use when a user wants to create or refresh their personal profile, personalize the AI assistant, or types /init-personal-profile. Trigger terms: personal profile, PROFILE.md, onboarding interview, identity, tooling preferences, growth plan, working philosophy. Not for team or role files (init-team, init-expertise) or the agent identity file (init-soul)."
type: command
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.1.0"
claude:
  allowed-tools:
    - Read
    - Write
    - Bash
    - AskUserQuestion
  user-invocable: true
---

Help the user write `config/PROFILE.md`, the file that tells the assistant who they are and how they
work. You run the interview, which is judgement; a script renders the file in the template shape and
checks it.

## Interaction rules

- Closed questions with a bounded set of choices go through your host CLI's structured-question
  tool: `AskUserQuestion` on Claude Code, `ask_user` on Gemini CLI, `ask_question` on Antigravity
  CLI. GitHub Copilot CLI has none, so present the same choices as a labeled plain-text list there.
  On the other CLIs a plain-text menu is skipped or misread.
- Open-ended content is free-form chat.
- A structured question takes 1 to 4 questions of 2 to 4 options; the tool adds "Other" itself, so
  leave it out of your lists. Keep `header` labels under 12 characters.

## Interview

Ask in the language the user picks; the file itself is written in the language they prefer.
Never assume an answer: an invented fact in a profile steers every later session.

1. **Language.** Detect the locale with `echo $LANG`; confirm the conversation language with
   `header: "Language"`, the detected one first as "(Recommended)", English second.
2. **Identity.** Read `git config user.name` and `git config user.email`; confirm them (options "Use as
   is", "Edit name", "Edit email", "Edit both"). Ask Team, Role, Department and Location in chat.
3. **Tooling.** Editor and plugins, terminal and shell: chat. Communication channels: multi-select
   (`header: "Channels"`: Slack, Email, Video call, Chat). Work rhythm (`header: "Rhythm"`: Deep focus
   blocks, Frequent short bursts, Async-first, Meeting-heavy).
4. **Active projects.** Loop: name, responsibility and objective in chat, then `header: "Add project"`
   ("Add another", "Done").
5. **Growth plan.** Chat: primary focus for the next six months, concrete goals.
6. **Working philosophy.** Chat: core values, collaboration preferences, notes. Propose a polished
   summary and confirm it ("Approve", "Tweak wording", "Rewrite from scratch").

## Generation

1. Write the answers to a scratch JSON file as `{identity: {full_name, email, language, team, role,
   department, location}, tooling: {editor, terminal, communication, rhythm}, projects: [{name,
   responsibility, objective}], growth: {focus, goals}, philosophy: {values, collaboration, notes}}`;
   leave out what the user skipped.
2. Run the dry-run command, show `data.content`, and confirm with `header: "Finalize"` ("Save as
   is", "Edit a section", "Discard draft").
3. Save, run the linter, and close with a short encouraging message.

## Scaffold scripts

A command cannot bundle files, so the scripts ship with the `init-team` skill, installed beside
this command on every CLI. Locate them once before writing:

```sh
find . ~/.claude ~/.gemini ~/.copilot ~/.agents ~/.github -maxdepth 6 \
  -path '*/skills/init-team/scripts/scaffold-config-file.ts' 2>/dev/null | head -1
```

If nothing is found, stop and tell the user to install the `init-team` skill: writing the file by
hand would skip the shape check. Below, `<scripts>` is the directory of that path. Both scripts
exit `0` (ok), `1` (finding), `2` (usage error) or `3` (precondition failed), and take `--json`.

| When | Command | Exit `1` means |
|---|---|---|
| To show the draft | `node <scripts>/scaffold-config-file.ts --kind profile --answers <answers.json> --dry-run` (draft in `data.content`) | An answers field is missing or malformed; the finding names it. |
| To save | the same without `--dry-run`; add `--force` only when the user chose to replace an existing file | `target-exists`: `config/PROFILE.md` exists and was not written; ask the user whether to overwrite. |
| After saving | `node <scripts>/lint-config-file.ts --kind profile config/PROFILE.md` | A section is missing, empty or still a placeholder; fix the answers and save again. |

The answers file is JSON written to a scratch location; its fields are listed by
`node <scripts>/scaffold-config-file.ts --help`.
