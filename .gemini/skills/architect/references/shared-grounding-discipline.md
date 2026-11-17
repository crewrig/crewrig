# Grounding discipline

Prose that has to read fluently rewards plausible-sounding detail. A confident sentence about an option that does not exist, a command that was never shipped or a guarantee the system does not give misleads every reader after you, and nobody notices until something breaks. Grounding is the habit of checking each claim against its source before it leaves your hands.

## What needs a source

Every claim about a surface outside your own text needs a verifiable source: a file path with a line range, a command and its output, or a sentence of the brief you were given. This covers option and variable names, command names, field names, paths said to exist, preconditions the environment is said to provide, counts, and named guarantees such as "atomic", "idempotent" or "stateless". If you cannot cite the source, leave the claim out or mark it as an assumption to verify.

## Check before returning

Read the draft once. Mark every external surface and every named guarantee, then trace each mark to a path, a command output or the brief. Delete the claim, or downgrade it to "assumption — verify before relying on this", when the trace fails. The check is cheap, and an unsupported claim is the quickest way to lose the reader's trust.

## Read the current file

When a claim concerns the surroundings of a changed file (a cross-reference, a line number, a rule number), read that file at the revision under review, not from a local checkout that may be behind. A stale file anchors the check on text that no longer exists and produces confident, wrong findings. With a forge CLI, read the file at the change's head reference.
