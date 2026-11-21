---
id: "0288"
slug: distribution-model
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2101
version: 1.2.0
---

# Distribution model and release-branch regime (parent spec of epic 1822)

## ADDED

(none)

## MODIFIED

R7 is replaced. Exactly one sentence changes: the last one, the prohibition on
deleting a cached version, which now carves out a single exception. Every
other sentence of R7 is byte-identical.

Rationale: spec 0314 R7 lets the launcher replace a cached entry whose
recorded digest differs from the pin, after a verified download, and calls
that exchange "a narrowing of 0288 R7". A reader of 0288 alone got the
opposite rule: R7 forbade deleting a cached version on the launcher's own
account, and the replacement deletes the old entry. The exception is stated
here so that the parent no longer contradicts the work package that details
it. Spec 0314 R7 remains the place that defines how the exchange is carried
out and how a failed exchange is handled.

Original R7:

```text
7. **R7 (integrity and cache).** Before extracting or running anything it downloaded, the launcher SHALL compute the SHA-256 digest of the downloaded archive bytes and compare it with the pin. On a mismatch it SHALL refuse, print the expected digest, the actual digest and the URL, delete the download, exit non-zero, and cache and execute nothing. No flag, environment variable or configuration key SHALL disable, weaken or bypass this check. A verified archive SHALL be extracted into `~/.crewrig/versions/<version>/` under the user's home directory on every operating system, the entry recording the digest it was verified against, and an entry SHALL become usable only once complete, so that an interrupted run or two concurrent runs never leave a partly extracted version that a later run would execute. When the cache holds the pinned version under a different recorded digest, the launcher SHALL NOT run it and SHALL download and verify again. The launcher SHALL NOT create, change or delete anything under `~/.crewrig/` outside `versions/`, which already holds other CrewRig state (`hooks/`, `system-context/`, `usage/`, `validation.conf`), and SHALL NOT delete a cached version on its own.
```

Replacement R7:

```text
7. **R7 (integrity and cache).** Before extracting or running anything it downloaded, the launcher SHALL compute the SHA-256 digest of the downloaded archive bytes and compare it with the pin. On a mismatch it SHALL refuse, print the expected digest, the actual digest and the URL, delete the download, exit non-zero, and cache and execute nothing. No flag, environment variable or configuration key SHALL disable, weaken or bypass this check. A verified archive SHALL be extracted into `~/.crewrig/versions/<version>/` under the user's home directory on every operating system, the entry recording the digest it was verified against, and an entry SHALL become usable only once complete, so that an interrupted run or two concurrent runs never leave a partly extracted version that a later run would execute. When the cache holds the pinned version under a different recorded digest, the launcher SHALL NOT run it and SHALL download and verify again. The launcher SHALL NOT create, change or delete anything under `~/.crewrig/` outside `versions/`, which already holds other CrewRig state (`hooks/`, `system-context/`, `usage/`, `validation.conf`), and SHALL NOT delete a cached version on its own, except that, after a verified download, it SHALL replace a cached entry whose recorded digest differs from the pin, as spec 0314 R7 details.
```

## REMOVED

(none)
