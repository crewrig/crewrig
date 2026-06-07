# Caching reference

`actions/cache` and its first-party language wrappers reduce install
time by persisting directories across runs. The mechanism is simple on
the surface and full of footguns underneath. This document covers the
key/restore-key semantics, scoping rules, eviction, the 10 GB
per-repository limit, and proven recipes for each major language.

## How `actions/cache` works

A step using `actions/cache`:

```yaml
- uses: actions/cache@<sha>  # v4.x
  id: cache
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-
```

The runner performs two operations:

1. **Pre-job restore.** Looks up `key` exactly. If hit, the
   directories at `path:` are restored, `steps.<id>.outputs.cache-hit`
   is set to `'true'`, and the install step can be skipped or
   shortened. If miss, the `restore-keys:` are tried as **prefixes**
   in order; on first prefix match, partial content is restored and
   `cache-hit` stays `'false'`.
2. **Post-job save.** If the pre-job lookup did not hit the exact
   `key`, the cache is uploaded after the job succeeds. Uploads happen
   in a `post:` step that runs even if a later step fails — as long as
   the cache step itself succeeded.

The save is conditional on **exact-key miss**. If you want to refresh
a cache whose content is sensitive to inputs not covered by the key
(e.g., transitive dep changes that the lockfile already pinned), bump
a discriminator in the key.

## Key construction

A cache key is just a string. Build it from:

- A namespace (the cache "kind": `npm`, `maven`, `pip`, …).
- The runner OS (`runner.os`), to avoid cross-OS restores of binary
  caches.
- The architecture (`runner.arch`), if your toolchain ships
  arch-specific binaries.
- A content hash (`hashFiles`) over the lock file(s) that pin
  dependency content.
- Optionally a version discriminator (`v2`, …) to invalidate the
  cache wholesale during a migration.

Worked example for a monorepo with multiple lockfiles:

```yaml
key: pnpm-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('pnpm-lock.yaml', 'packages/*/pnpm-lock.yaml') }}
```

`hashFiles` returns SHA-256 of the concatenated, sorted file contents.
If no file matches the glob, the function returns `''` and the key
becomes degenerate — verify the glob locally before merging.

## `restore-keys` fallback chain

`restore-keys` is a newline-separated list of **prefix** patterns.
The runner walks the list top-down, returning the first cache entry
whose key starts with the given prefix (ordered by recency for ties).

```yaml
restore-keys: |
  pnpm-${{ runner.os }}-${{ runner.arch }}-
  pnpm-${{ runner.os }}-
```

Use restore-keys to get a partial hit on lockfile changes — the saved
`node_modules` is mostly correct, the install step does the
incremental work. Trade-off: a partial restore that ends up with
stale content is its own debugging nightmare. Reset `restore-keys`
when in doubt.

## Scope and visibility

A cache entry is scoped to the **repository**. Cross-ref restore
rules:

- A job on branch `feature/x` can restore caches created on
  `feature/x` **and** on the **default branch** (typically `main`).
- A job on `main` restores only `main` caches.
- A job triggered by a `pull_request` from a fork uses the
  **base** repository's cache scope, but **cannot write** to it —
  prevents cache poisoning by an outside contributor.

The base-branch fallback means caches built on `main` are the
canonical source for feature branches. Build a "warm-up" workflow on
`main` if your default branch rarely runs the slow install path.

## Limits

- **10 GB total per repository.** Eviction is least-recently-used
  once the cap is hit.
- **A cache entry is immutable.** You cannot overwrite a key; you must
  invalidate by changing the key.
- **Unused entries are evicted after 7 days.** A cache that hasn't
  been read in a week is gone, regardless of total usage.

Monitor usage via the Actions UI (`Caches` tab in repo settings) or
the REST API (`GET /repos/{owner}/{repo}/actions/caches`). The CLI
`gh cache list` enumerates entries; `gh cache delete <id>` removes
one.

## Cross-OS pitfalls

A cache built on Linux often does not work on macOS or Windows
because of native binaries (`node-sass`, `node-gyp` outputs,
`puppeteer` Chromium, `tsx`'s `esbuild` binary, etc.). Always include
`runner.os` in the key. For mixed-arch (x64 + arm64) matrices, also
include `runner.arch`.

## Cache poisoning

A malicious PR cannot write to a cache (forks have read-only cache
access), but a contributor with push access to a feature branch can
write a cache that the default branch later restores (via the
base-branch fallback).

Mitigations:

- Keep the default branch isolated: use a `restore-keys:` set that
  only matches keys built on `main`. Easiest pattern: scope the key
  with `${{ github.ref_name == github.event.repository.default_branch && 'main' || 'fork' }}`
  so fork content never falls within `main`'s prefix chain.
- Treat cached binaries as untrusted. Re-verify checksums after
  restore for security-sensitive tools.

## Language recipes

### npm

```yaml
- uses: actions/setup-node@<sha>  # v4.x
  with:
    node-version-file: .nvmrc
    cache: npm
    cache-dependency-path: package-lock.json
```

`actions/setup-node` does cache management for you when `cache: npm`
is set — keys by lockfile hash, restores to `~/.npm`. Prefer this to
hand-rolled `actions/cache` for the common case.

### pnpm

`pnpm` keeps a content-addressable store; cache `~/.local/share/pnpm/store`
(Linux) / equivalent path on other OSes.

```yaml
- uses: pnpm/action-setup@<sha>  # v4.x
  with:
    run_install: false
- uses: actions/setup-node@<sha>  # v4.x
  with:
    node-version-file: .nvmrc
    cache: pnpm
```

### Yarn (Classic and Berry)

```yaml
- uses: actions/setup-node@<sha>
  with:
    node-version-file: .nvmrc
    cache: yarn
    cache-dependency-path: yarn.lock
```

For Yarn Berry with zero-installs, the `.yarn/cache` directory is
checked into the repo — no `actions/cache` needed.

### Maven

```yaml
- uses: actions/setup-java@<sha>  # v4.x
  with:
    distribution: temurin
    java-version: 21
    cache: maven
```

Keys on `**/pom.xml`. For Gradle, set `cache: gradle` instead — keys
on `**/*.gradle*` and `**/gradle-wrapper.properties`.

### pip

```yaml
- uses: actions/setup-python@<sha>  # v5.x
  with:
    python-version: "3.12"
    cache: pip
    cache-dependency-path: |
      requirements*.txt
      requirements/*.txt
```

For Poetry, drop the built-in cache and use `actions/cache` directly
over `~/.cache/pypoetry` keyed on `poetry.lock`.

### Go modules

```yaml
- uses: actions/setup-go@<sha>  # v5.x
  with:
    go-version-file: go.mod
    cache: true   # default: true
```

`setup-go` caches `~/.cache/go-build` and `~/go/pkg/mod` keyed on
`go.sum`.

### Cargo (Rust)

`Swatinem/rust-cache` is the de facto pattern; it handles the
crate-registry, git deps, target directory, and adapts the key to
the Rust toolchain version.

```yaml
- uses: dtolnay/rust-toolchain@<sha>
  with:
    toolchain: stable
- uses: Swatinem/rust-cache@<sha>
  with:
    workspaces: . -> target
```

### Docker layer cache

Pure `actions/cache` over BuildKit's `--cache-to type=local` is
brittle (it grows unbounded). Prefer the GitHub-native cache backend:

```yaml
- uses: docker/setup-buildx-action@<sha>
- uses: docker/build-push-action@<sha>
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

`type=gha` uses the same 10 GB pool — be conscious of layered-cache
growth and prune periodically by changing the `scope` argument.

### Bazel / Nix / Pants

For Bazel, prefer a remote cache (BuildBuddy, Google Cloud, internal
backend) over `actions/cache` — the local repo cache changes
constantly and overflows the 10 GB cap quickly. For Nix, use the
`cachix/cachix-action` to push to a Cachix store. Pants and Buck2
have similar remote-cache stories.

## Debugging

`cache-hit` is the first thing to check. If always `'false'`, the
key is changing every run — usually a `hashFiles` glob that picks up
generated files. Print the key in a debug step:

```yaml
- run: echo "Computed key: pnpm-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}"
```

If `cache-hit` is `'true'` but the install step still rebuilds from
scratch, the restored directory is incomplete — verify the `path:`
covers everything the toolchain reads (e.g., npm's `~/.npm` versus
`node_modules` versus the workspace's `.next/`).
