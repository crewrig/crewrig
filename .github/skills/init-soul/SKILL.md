---
name: init-soul
description: "Customizes the agent identity file config/SOUL.md section by section through guided conversation and a scaffold script that renders and checks it. Use when a user wants to personalize the agent's personality, tone or values, or types /init-soul. Trigger terms: SOUL.md, agent identity, agent personality, SOUL-E framework, stance, origin, understanding, lineage, error handling. Not for the personal profile (init-personal-profile) or team and role files (init-team, init-expertise)."
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.1.0"
---


Walk the user through a personalized `config/SOUL.md`, starting from `config/SOUL.md.template`. The
file governs the agent's tone, decision-making style, values and error-handling philosophy, so every
change is the user's choice and gets a safety review. A script renders the file and checks its shape.

## Interaction rules

- Closed questions with a bounded set of choices go through your host CLI's structured-question
  tool: `AskUserQuestion` on Claude Code, `ask_user` on Gemini CLI, `ask_question` on Antigravity
  CLI. GitHub Copilot CLI has none, so present the same choices as a labeled plain-text list there.
  On the other CLIs a plain-text menu is skipped or misread.
- Open-ended content is free-form chat.
- A structured question takes 1 to 4 questions of 2 to 4 options; the tool adds "Other" itself, so
  leave it out of your lists. Keep `header` labels under 12 characters.

## Interview

1. **Language.** If `config/PROFILE.md` exists, read it for the user's preferred language and hold the
   conversation in it. The SOUL.md itself is always written in English, so translate the user's
   wording faithfully.
2. **Template.** Read `config/SOUL.md.template`; its sections are Stance, Origin, Understanding,
   Lineage and Error Handling & Tenacity.
3. **Each section, one at a time.** Show the current template wording, then ask (`header` = the
   section name): "Accept as-is", "Refine" (you propose a targeted adjustment, such as a more
   assertive tone, and the user approves or tweaks it: "Approve", "Tweak", "Try another angle"), or
   "Rewrite freely" (the user writes the wording in chat; confirm with "Approve" or "Edit again").
   Wait for the answer before the next section.
4. **Safety review.** Compare the draft with the template. Reject a change that introduces biased,
   harmful or manipulative behavior, undermines organizational security or compliance standards, or
   compromises the dignity of individuals. Explain the problem in the user's language and offer
   "Revert to template", "Soften wording" or "Discuss alternative".

## Generation

1. Write the answers to a scratch JSON file: `{sections: {stance, origin, understanding, lineage,
   error_handling}}`, each value the markdown that goes under its heading (the template's bullets
   and paragraphs, accepted or changed). The script supplies the title, the opening quote and the
   closing line of the template; pass `title`, `preamble` or `closing` only when the user changed them.
2. Run the dry-run command, show `data.content`, and confirm with "Validate and save", "Edit a
   specific section" or "Discard draft".
3. Save, run the linter, and invite the user to fine-tune the file by hand.

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
| To show the draft | `node <scripts>/scaffold-config-file.ts --kind soul --answers <answers.json> --dry-run` (draft in `data.content`) | An answers field is missing or malformed; the finding names it. |
| To save | the same without `--dry-run`; add `--force` only when the user chose to replace an existing file | `target-exists`: `config/SOUL.md` exists and was not written; ask the user whether to overwrite. |
| After saving | `node <scripts>/lint-config-file.ts --kind soul config/SOUL.md` | A section is missing, empty or still a placeholder; fix the answers and save again. |

The answers file is JSON written to a scratch location; its fields are listed by
`node <scripts>/scaffold-config-file.ts --help`.
