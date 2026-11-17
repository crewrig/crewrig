// Builds ./docs/adr, a throwaway directory for this eval, with three accepted ADRs.
// Usage: node make-adrs.ts   (Node.js 24, no import)

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const dir = "docs/adr";
  fs.mkdirSync(dir, { recursive: true });

  const adr = (n: string, title: string, context: string, decision: string): string =>
    `# ADR-${n}: ${title}

## Status

Accepted

## Context

${context}

## Decision

${decision}

## Consequences

- Positive: callers share one convention.
- Negative: changing it later needs a new ADR.
- Neutral: the choice is documented here.
`;

  fs.writeFileSync(
    `${dir}/0001-use-gitmoji-commits.md`,
    adr(
      "0001",
      "Use Gitmoji commit messages",
      "Commit history was hard to scan. The team wants a visible type at the start of each subject.",
      "We use Gitmoji at the start of every commit subject.",
    ),
  );
  fs.writeFileSync(
    `${dir}/0002-rest-for-internal-apis.md`,
    adr(
      "0002",
      "REST for internal APIs",
      "Internal services need one way to call each other. The team already operates REST gateways and knows the tooling.",
      "We use REST with JSON bodies for every internal service API.",
    ),
  );
  fs.writeFileSync(
    `${dir}/0003-trunk-based-development.md`,
    adr(
      "0003",
      "Trunk-based development",
      "Long-lived branches caused painful merges. Releases are small and frequent.",
      "We merge short-lived branches into main and release from main.",
    ),
  );
})();
