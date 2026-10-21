# Plan fixture

## PLAN v1 - fixture

### Approach

Mentions `ci/ignored.yml` outside Steps, which must not count.

### Steps

1. Edit `artifacts/core/skills/architect/SKILL.md`.
2. Rebuild `.claude/skills/architect/SKILL.md`.
3. Rebuild `.gemini/skills/architect/SKILL.md`.
4. Rebuild `.github/skills/architect/SKILL.md`.
5. Rebuild `.agents/skills/architect/SKILL.md`.

### Blast radius

- Components: skill:architect
- Also mentions `specs/ignored.md` outside Steps.

### Risks

None.
