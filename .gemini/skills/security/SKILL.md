---
name: security
description: "Security review skill for threat modeling, dependency audit, secret hygiene, and code review through a security lens. Activate when a change touches authentication, authorization, secrets, cryptography, input parsing, deserialization, network calls, or upgrades to dependencies."
license: Apache-2.0
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.1.2"
---


# Security

A focused review skill, not an exhaustive checklist. The goal is to
catch the realistic next exploit — not to enumerate the OWASP Top 10
every time.

## When to activate

Mandatory triggers:

- Authentication, authorization, or session-handling code changes.
- Secret / credential / token storage or transmission paths.
- Cryptographic primitive use (hashing, signing, encryption, RNG).
- External input parsing (HTTP bodies, CLI args, file uploads, IPC).
- Deserialization of untrusted data.
- Outbound network calls (URLs from user input, redirects, SSRF surface).
- Dependency additions or upgrades touching the surface above.

Optional but encouraged: any code review on a security-adjacent module
(payment, PII, audit log) — even when the diff itself looks innocuous.

## Operating mode

### 1. Trust boundary first

Before reading the diff, draw the trust boundary in your head:

- What input is **untrusted** here? (User input, network, file from
  another process, env var passed in by the user.)
- What is **inside** the boundary? (Internal config, signed messages,
  vetted constants.)
- The bug class to look for is the one that *crosses* the boundary
  without proper handling.

### 2. Realistic threat, not paranoid theater

Ask: *what would the next attacker actually try here?* Two concrete
threats with credible exploit paths beat a list of twenty generic
risks. Examples of credible threats per surface:

- HTTP handler reading from JSON: prototype pollution, type confusion,
  unbounded length / depth.
- File path from user: traversal, symlink, race.
- SQL: parameterized? If yes, also check ORDER BY / LIMIT / table
  name interpolation, which most ORMs do *not* parameterize.
- Crypto: AEAD with reused nonce, hash truncation, padding oracle, RNG
  not from a CSPRNG.
- Deserialization: gadget chains, auto-instantiation.

### 3. Verify, do not assume

For each suspected issue, verify by:

- Reading the relevant function end-to-end (not just the diff hunk).
- Tracing the data flow from boundary to sink.
- Checking the test suite — if no test exists for the threat path,
  flag the absence as part of the finding.

Do not flag a "potential" issue without showing how the data could
flow there. Speculation costs the user time and erodes credibility.

### 4. Output format

Report findings as a numbered list:

```text
1. [SEV] <one-line summary>
   Where: <file:line>
   Threat: <what an attacker would do>
   Evidence: <code snippet or trace>
   Fix: <concrete recommendation>
```

Severity scale: `BLOCKER` / `HIGH` / `MED` / `LOW` / `INFO`. Reserve
`BLOCKER` for issues that must be fixed before merge (e.g. credential
leak, RCE, auth bypass).

## Secret hygiene

- Never commit `.env`, `credentials.json`, `*.pem`, or any file under
  a vault path.
- Never echo a secret in logs, even at debug level. Even if the log is
  ephemeral, the transcript may be persisted.
- If you find a leaked secret in the repo or transcript, rotate
  guidance is **part of the finding** — flag the secret as compromised
  the moment it touches a non-secret-grade store.

## Dependency audit

When asked to review a dependency upgrade:

- Read the upstream changelog between current and target versions.
- Check the GitHub Security Advisory database for known CVEs.
- For minor / patch bumps, focus on transitive changes and license drift.
- For major bumps, flag breaking changes and require a migration note.

## Friction reporting

When a recognition signal fires (see `config/TOOLS.md` →
*Friction Reporting → Recognition signals*), invoke the
`harness-report` skill rather than reimplementing the protocol
inline. The reporter walks you through identifying the offender,
picking the room, and filling the payload.
