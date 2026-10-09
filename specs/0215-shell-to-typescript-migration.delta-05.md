---
id: "0215"
slug: shell-to-typescript-migration
status: approved
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1231
version: 4.2.0
---

# Shell-to-TypeScript migration (parent spec)

*Delta 05 of `specs/0215-shell-to-typescript-migration.md`. Source: ticket #1330
(row D, sub-spec `specs/0252-windows-service-management.md`). Requirement 23 bars a
migrated script from spawning any POSIX-only utility. Row D has to find which process
listens on the MemPalace daemon's port and which process is the ancestor of another, to
keep the listener-owner check of spec 0158; Node.js has no API for either, and the
shell it replaces used `lsof` or `ss`. On Linux the `/proc` file system answers both
without any spawn. On macOS and Windows no file system answers, so a tool of the
operating system itself has to be spawned. The owner decided on 2026-10-09 to allow
exactly that, as a closed list per operating system, and not as a general rule about
"native tools". This delta is owner-approved scope, runs under the release-branch
regime of `specs/0215-shell-to-typescript-migration.delta-04.md`, and its spec-PR
targets `release/1231-ts-migration`. The version is a MINOR bump: requirement 23 is
narrowed in one place and no other requirement changes. Requirement 5 is unchanged: no
POSIX shell becomes a prerequisite on any operating system, and every tool the list
allows on Windows is part of Windows.*

## ADDED

Nothing is added.

## MODIFIED

### Requirement 23 — process and socket inspection (row D)

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 23. **Cross-cutting — External POSIX tools.** A migrated script SHALL NOT spawn
>     `jq`, `yq`, `awk`, `sed`, `grep`, `mktemp`, `curl`, `ln` or any other
>     POSIX-only utility. Spawning Git, npm, the forge CLIs (`gh`, `glab`,
>     `tea`), the four supported CLIs, the Python toolchain for the `mempalace`
>     exception, and the host operating system's service manager is permitted.
>     JSON handling SHALL use the Node.js standard library. YAML handling SHALL
>     use `js-yaml`, the library already pinned in the lockfile (as a
>     `devDependency` at authoring time; the first sub-spec that needs it at
>     runtime SHALL move it to `dependencies` under requirement 6); a sub-spec
>     MAY replace it only with a written justification, and SHALL then migrate
>     every existing use so that one YAML library remains.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 23. **Cross-cutting — External POSIX tools (narrowed at delta-05).** A migrated
>     script SHALL NOT spawn `jq`, `yq`, `awk`, `sed`, `grep`, `mktemp`, `curl`,
>     `ln`, `lsof`, `ss` or any other POSIX-only utility, except as the next
>     sentence but one allows. Spawning Git, npm, the forge CLIs (`gh`, `glab`,
>     `tea`), the four supported CLIs, the Python toolchain for the `mempalace`
>     exception, and the host operating system's service manager is permitted.
>     For process and socket inspection only, and only where Node.js offers no
>     equivalent (the listing of the running tasks of the operating system's own
>     task scheduler, which is service-manager state read through the `powershell`
>     tool, counts as process inspection), a migrated script MAY spawn exactly these
>     tools on exactly these operating systems: on macOS, `netstat` and `ps`; on Windows, `netstat` and
>     `powershell`; on Linux, none (the `/proc` file system answers, and no process is
>     spawned). The list is closed: a tool or an operating system not named here is
>     refused until a delta-spec of this spec names it. Every spawn of a tool of this
>     list SHALL go through one module, `scripts/lib/service/os-inspect.ts`, which no
>     script bypasses and which a script of another row imports instead of spawning
>     the tool itself; the module resolves each tool at the operating system's own
>     absolute path and not through the search path, passes an argument array with no
>     shell, runs `powershell` only with `-NoProfile` and `-NonInteractive` and a
>     constant script that carries no caller-supplied text, bounds the run in time,
>     never passes a credential, and returns the output for the caller to
>     parse in process, so no output is piped to another tool. JSON handling SHALL use
>     the Node.js standard library. YAML handling SHALL use `js-yaml`, the library
>     already pinned in the lockfile (as a `devDependency` at authoring time; the
>     first sub-spec that needs it at runtime SHALL move it to `dependencies` under
>     requirement 6); a sub-spec MAY replace it only with a written justification,
>     and SHALL then migrate every existing use so that one YAML library remains.

## REMOVED

Nothing is removed.
