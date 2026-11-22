---
id: "0315"
slug: org-build-setup-update-commands
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2114
version: 1.1.0
---

# The `build`, `setup` and `update` commands of the organization config repository (WP4 of epic 1822)

Resolves the plan-seat finding of issue 2114 (plan v2, verdict): R12 allows no
CrewRig-specific environment variable except `CREWRIG_RELEASE_BASE_URL`, but the
setup code that the commands reuse reads others. This delta replaces that
sentence of R12 with a closed allowlist and an exact strip list, extends R14
with the tests that verify them, completes the R13 environment row, and adds R15 for one documentation line.

Cumulative effect: R12 is amended in one sentence, R13 gains one clause in its environment row, R14 gains one clause, R15 is
new, and four scenarios are added. Every other requirement and scenario of the
parent is unchanged.

## ADDED

**R15 (TLS documentation line).** The implementation PR SHALL add to `docs/runbooks/custom-ca-tls-trust.md`, next to the `export CREWRIG_TLS_CA=...` example, exactly one line saying that under `crewrig setup` of the organization repository the user sets `NODE_EXTRA_CA_CERTS` or `SSL_CERT_FILE`, not `CREWRIG_TLS_CA`, because the three commands strip the latter (R12). The line SHALL NOT remove or reword the existing `CREWRIG_TLS_CA` guidance, which stays correct for a checkout of the framework.

### Scenario "an allowlisted setting reaches setup"

```text
Given a copy of the template with a locally built archive, and the environment holds MEMPALACE_MCP_HOST=127.0.0.2, MEMPALACE_MCP_PORT=8765, MEMPALACE_CHROMA_HOST=127.0.0.3, MEMPALACE_CHROMA_PORT=8011, MEMPALACE_PALACE_PATH=<a temporary path> and MEMPALACE_PYTHON=<a stub interpreter>
When  the user runs `node crewrig setup --cli claude`
Then  the memory-server and Chroma configuration that setup writes, and the interpreter and palace path it uses, carry those six values, and the endpoint recorded in what setup writes equals the endpoint that a hook, and the Chroma wrapper, resolve from the same environment.
```

### Scenario "a test seam has no effect on setup"

```text
Given the environment holds MEMPALACE_MCP_EVICT_CMD set to a command that creates a marker file, and MEMPALACE_MCP_EXPECTED_PID, MEMPALACE_MCP_LISTENER_PID, MCP_DAEMON_REPLACE_DEADLINE, MEMPALACE_MCP_LABEL, MEMPALACE_MCP_UNIT, CREWRIG_TLS_CA, CREWRIG_USAGE_ROOT and a CREWRIG_TEST_* variable all set
When  the user runs `node crewrig setup --cli claude`, then `node crewrig build`
Then  the marker file does not exist, the daemon label and unit are the defaults, no usage directory is created under CREWRIG_USAGE_ROOT, the result is byte-identical to a run with none of these variables set, and the exit code is the same.
```

### Scenario "update strips the same variables for the run it starts"

```text
Given the environment of the previous scenario plus CREWRIG_RELEASE_BASE_URL naming a local server
When  the user runs `node crewrig update --cli claude`
Then  the launcher run of step (c) of R9 reaches the local server through CREWRIG_RELEASE_BASE_URL, and the setup it starts behaves as in the previous scenario.
```

### Scenario "a stripped variable does not fail the command"

```text
Given the environment holds only CREWRIG_TLS_CA=/nonexistent.pem
When  the user runs `node crewrig setup --cli claude`
Then  the command exits 0 as it does without the variable, and prints no error about the file.
```

### Accepted limits

- With `CREWRIG_USAGE_ROOT` set, `setup` writes the Antigravity status-line marker under the default usage root while the status-line shim reads the custom root. The variable is stripped (R12); a user who relocates the usage root uses a checkout of the framework.
- The allowlist is closed: the six variables are the only `MEMPALACE_*` settings that reach `setup`. A user who sets any other (for example `MEMPALACE_MCP_LABEL`, `MEMPALACE_MCP_UNIT`, or `MEMPALACE_MCP_CHROMA_WAIT`; the table of R12 gives the reason for each) gets the defaults from these commands; adding one needs a delta.
- Corporate certificate authorities remain covered by `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE`, which R12 leaves unaffected; only `CREWRIG_TLS_CA` is unavailable (R15).

## MODIFIED

### R12, last sentence

Original sentence:

```text
The three commands SHALL read no CrewRig-specific environment variable other than `CREWRIG_RELEASE_BASE_URL`, which only the launcher reads, including in the run that `update` starts; the runtime's resolution of the home directory (`HOME`, `USERPROFILE`, 0314 R11), the lookup of `git` and `node` on `PATH`, and the temporary-directory resolution of the runtime are not CrewRig-specific variables and fall outside this rule.
```

Replacement:

```text
The three commands SHALL read, from their environment, no variable of the following classes, and SHALL remove them from their own environment before any other step and so from the environment of every child process they start, including the run that `update` starts in step (c) of R9: (a) every variable whose name begins with `CREWRIG_`, other than `CREWRIG_RELEASE_BASE_URL`, which only the launcher reads; this covers `CREWRIG_TLS_CA`, `CREWRIG_USAGE_ROOT` and every `CREWRIG_TEST_*`; (b) every variable whose name begins with `MEMPALACE_`, other than the closed allowlist below; this covers the other settings named in the table below, the test seams `MEMPALACE_MCP_EXPECTED_PID`, `MEMPALACE_MCP_LISTENER_PID` and `MEMPALACE_MCP_EVICT_CMD` (which the daemon-replacement code runs as a shell command), and the daemon names `MEMPALACE_MCP_LABEL` and `MEMPALACE_MCP_UNIT`; (c) `MCP_DAEMON_REPLACE_DEADLINE`. The closed allowlist of documented user settings, which the three commands SHALL pass through unchanged, is exactly `MEMPALACE_MCP_HOST`, `MEMPALACE_MCP_PORT`, `MEMPALACE_CHROMA_HOST`, `MEMPALACE_CHROMA_PORT`, `MEMPALACE_PALACE_PATH` and `MEMPALACE_PYTHON`: the criterion is a setting that a runbook or ADR documents, that `setup` reads, and that code outside `setup` reads again at run time (the hooks read the memory-server host and port, ADR-0027; the Chroma wrapper reads the Chroma host and port, ADR-0006), so that stripping it in `setup` alone would install a daemon on the default endpoint while the run-time readers target the user's endpoint, a silent loss of memory capture. A variable of the allowlist that is unset or empty SHALL leave the default behaviour. The allowlist changes only by a delta of this spec. The runtime's resolution of the home directory (`HOME`, `USERPROFILE`, 0314 R11), the lookup of `git` and `node` on `PATH`, the temporary-directory resolution of the runtime, and the standard trust variables `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE` are not in these classes and are unaffected.
```

Decision per `MEMPALACE_*` variable and for `MCP_DAEMON_REPLACE_DEADLINE`, by the criterion above (documented, read by `setup`, and read at run time outside `setup` means allowlisted; setup-independent, setup-only tuning or test-only means stripped):

| Variable | Decision | Reason |
|---|---|---|
| `MEMPALACE_MCP_HOST`, `MEMPALACE_MCP_PORT` | allowlisted | Documented; baked in by `setup`; read by the hooks at run time. |
| `MEMPALACE_CHROMA_HOST`, `MEMPALACE_CHROMA_PORT` | allowlisted | Documented (`docs/runbooks/chroma-http-server.md`, ADR-0006); read by `setup` (daemon install, Chroma endpoint); read again by the Chroma wrapper at run time. |
| `MEMPALACE_PALACE_PATH`, `MEMPALACE_PYTHON` | allowlisted | Owner decision: documented settings that `setup` and the run-time code share. |
| `MEMPALACE_MCP_CHROMA_WAIT` | stripped | Documented, but read only by the daemon launcher in the service manager's environment, not by `setup`: stripping changes nothing `setup` does. |
| `MEMPALACE_CHROMA_MAX_CONNECTIONS`, `MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS`, `MEMPALACE_CHROMA_ULIMIT_FLOOR` | stripped | Documented, but read only at run time by the wrapper and the Chroma start script, not by `setup`. |
| `MEMPALACE_MCP_HTTP_TOKEN`, `MEMPALACE_MCP_TOKEN_FILE`, `MEMPALACE_MCP_IDLE_HOURS`, `MEMPALACE_LAUNCHER_KILL_AFTER_MS` | stripped | Daemon launcher settings, read in the daemon's own environment, not by `setup`. |
| `MEMPALACE_MCP_LAUNCHER_PATH`, `MEMPALACE_TLS_EXEC_PATH` | stripped | Not documented in `docs/runbooks/`; relocation overrides used by tests. |
| `MEMPALACE_MCP_LABEL`, `MEMPALACE_MCP_UNIT` | stripped | Not documented in `docs/runbooks/`: read by `scripts/lib/service/names.ts` and used by tests to isolate a daemon. |
| `MEMPALACE_MCP_EXPECTED_PID`, `MEMPALACE_MCP_LISTENER_PID`, `MEMPALACE_MCP_EVICT_CMD`, `MCP_DAEMON_REPLACE_DEADLINE` | stripped | Test seams; `MEMPALACE_MCP_EVICT_CMD` is run as a shell command. |

### R14, new final clause

Original final clause:

```text
the hostile-`package.json` matrix of R11 for the entry point and one hook; and the closure test of R10.
```

Replacement:

```text
the hostile-`package.json` matrix of R11 for the entry point and one hook; the closure test of R10; and the environment test of R12: with each of the six allowlisted variables set to a non-default value, `setup` writes the configuration carrying that value; with `MEMPALACE_MCP_EVICT_CMD` set to a command that creates a marker file (the marker SHALL NOT appear), and with each other seam and stripped variable of R12 set, `setup` and `build` produce the same output and exit code as with none set; `update` passes `CREWRIG_RELEASE_BASE_URL` to the launcher and strips the rest; `CREWRIG_TLS_CA` pointing at a nonexistent file does not fail `setup`; and, `CREWRIG_TEST_SERVICE_PLATFORM` and `CREWRIG_TEST_SERVICE_BIN_DIR` being stripped, every `setup` run of the tests stays off the host's service manager by placing stub service-manager executables first on `PATH`, or by an equivalent isolation that leaves no unit, task or daemon on the host, which the test verifies.
```

### R13, environment row

Original line:

```text
    - surface 2, environment variables: the statement that the three commands add none (R12), replacing "any further variable: WP4 spec, pending";
```

Replacement:

```text
    - surface 2, environment variables: the statement that the three commands add none, that they strip the classes of R12 (so that `CREWRIG_TLS_CA`, `CREWRIG_USAGE_ROOT`, every `CREWRIG_TEST_*` and every `MEMPALACE_*` outside the allowlist have no effect on them) and that they pass through exactly the six variables of the R12 allowlist, replacing "any further variable: WP4 spec, pending";
```

## REMOVED

(none)
