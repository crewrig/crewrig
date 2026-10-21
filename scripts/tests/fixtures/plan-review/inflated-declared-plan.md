# Plan fixture

## PLAN v1 - fixture

### Approach

Mentions `ci/ignored.yml` outside Steps, which must not count.

### Steps

1. Edit `scripts/foo.ts`.
2. Edit `docs/x.md`.

### Blast radius

- Components: scripts, docs, ci, specs
- Also mentions `specs/ignored.md` outside Steps.

### Risks

None.
