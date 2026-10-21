# Plan fixture

## PLAN v1 - fixture

### Approach

Mentions `ci/ignored.yml` outside Steps, which must not count.

### Steps

1. Edit `artifacts/core/agents/architect/AGENT.md`.
2. Rebuild `.claude/agents/architect.md`.
3. Rebuild `.gemini/agents/architect.md`.
4. Rebuild `.github/agents/architect.md`.
5. Rebuild `.agents/agents/architect/AGENT.md`.

### Blast radius

- Components: agent:architect
- Also mentions `specs/ignored.md` outside Steps.

### Risks

None.
