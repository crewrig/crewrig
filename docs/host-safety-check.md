<!-- Reference for the test-harness host-safety check (spec 0267). -->

# Host-safety check

<!-- crewrig-doc: published=false -->

**This check is intra-function and would NOT have caught the incident that motivated it.** It flags a destructive `fs` call whose target is derived, inside the same function, from the environment, the arguments, `HOME` or `PATH`. The incident shape — a destructive target that reaches `rmSync` through a parameter, a field or a return value, across `findShared()` → `rewind()`/`settle()` → `restore(dir)` — produces no finding, so a green run is not a guarantee that a harness is safe. The runtime guard that would refuse such a call whatever the call chain is tracked in #1722.

`scripts/check-host-safety.ts` implements the static rule of
[`specs/0267-test-harness-host-safety.md`](../specs/0267-test-harness-host-safety.md).
The instruction that binds every spawned role lives in a single place, the
*Host-safety* clause of
[`docs/agent-team-protocol/worktree-isolation.md`](agent-team-protocol/worktree-isolation.md#worktree-isolation); this page links to it
and does not restate it.

## What it checks

The check parses every scanned file with the TypeScript 7 programmatic API
(parse only: nothing is type-checked, executed or written) and reports each
destructive `fs` call whose target is derived from an untrusted source and is
not contained. Destructive calls are `rm`, `rmdir`, `unlink`, `cp`,
`copyFile` and `rename`, in their sync, callback and `fs/promises` forms. For
`cp`, `copyFile` and `rename` both arguments are checked.

A target is clean when it derives only from `mkdtemp`/`mkdtempSync` or from
`createRoot(...)`, or when an earlier `assertInside(root, <same path>)` or
`isInside` guard in the same function is anchored on such a root. "Only" is
literal: a conditional, `??`, `||` or `&&` is a union, so one untrusted branch
(`process.env.X ?? fs.mkdtempSync(...)`, `cond ? process.env.X : mkdtempSync(...)`)
taints the binding, and a later assignment from an untrusted source taints it
too. A guard root is held to the same rule. Untrusted components inside the
argument of the `mkdtemp` call itself do not matter, because the result is a
fresh directory whatever its prefix. Otherwise a fix is to guard the call with
`assertInside(root, p)` against an `mkdtemp` root.

### Scan roots

- `scripts/tests/`
- `scripts/lib/`
- `scripts/*.ts`

### Rule ids

Each finding is printed as `host-safety: <rule-id>: <path>:<line>: <message>`.

| Rule id | Fires when |
|---|---|
| `env-derived-destructive` | The target derives from `process.env`. |
| `argv-derived-destructive` | The target derives from `process.argv`. |
| `homedir-derived-destructive` | The target derives from `os.homedir()` (or `HOME`). |
| `path-derived-destructive` | The target derives from a `PATH` entry. |
| `allowlist-unjustified` | An allowlist entry has an empty justification. |
| `allowlist-stale` | An allowlist entry matches no current finding. |
| `allowlist-entry-added` | An entry is present that the merge base did not carry. |
| `allowlist-unsorted` | The allowlist is not sorted, or carries a duplicate key. |

## Allowlist

The allowlist is `ci/host-safety-allowlist.txt`. It is shrink-only: after the
bootstrap, an entry cannot be added, so a new legitimate site can only land by
guarding the call. An absent file on the merge base means bootstrap, and the
growth arm is skipped.

Each entry is one line, key and justification separated by a TAB:

```text
<path>::<enclosing-function>::<callee>#<ordinal><TAB><justification>
```

- `<enclosing-function>` is `<module>` at top level and `<anonymous-K>` for an
  unnamed function.
- `<ordinal>` counts calls of the same callee inside the enclosing function.
- Entries are sorted, unique, and carry a non-empty justification.

The key carries no line number, so an entry survives unrelated edits; it
breaks only when calls of the same callee in the same function are reordered,
which is a reviewable change.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No finding. |
| `1` | At least one finding. |
| `2` | A wiring fault: a missing scan root or allowlist, or an unreadable input. |

`CREWRIG_REPO_DIR` and `BASE_REF` override the repository root and the merge
base, as for the sibling checks. Run it locally with `task host-safety`; it
needs `npm ci` first, because it imports `typescript`.

## Known limits

- **Cross-function flow.** Taint is resolved through same-file, scope-aware
  local bindings only. A target passed through a parameter, a field, a return
  value or a closure is not followed. This is the incident shape above.
- **Aliasing.** `const rm = fs.rmSync` and similar renamings hide the sink.
- **Spawned commands.** `rm -rf`, `git clean` and other destructive external
  commands run through `spawnSync` or `exec` are not analysed.
- **Write family.** `writeFileSync`, `appendFileSync` and their forms are
  excluded in v1; adding them later is non-breaking.
- **Scan roots.** Code outside the three roots is not scanned.
- **Parser stability.** The check depends on `typescript/unstable/*`; a
  compiler bump can break it, and the adapter is confined to one file so the
  fix stays local.
