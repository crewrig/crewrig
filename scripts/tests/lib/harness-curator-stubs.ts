// harness-curator-stubs.ts — the stub tools of the curator differential (spec 0258 R28, R29, PLAN v2
// step 19): `gh`, the recording interpreter, `pipx`, `uname`, `fzf`, `crontab`, `systemctl`,
// `launchctl`. They are written into a sandbox's `bin/` at test time (never tracked) by
// harness-curator-observe.ts; `{ROOT}` is the sandbox root and `{CALLS}` its argv log.

/** A stub tool: `path` is relative to the sandbox root, `{ROOT}` and `{CALLS}` are substituted. */
export interface StubFile {
  readonly path: string;
  /** Logged first as `<name> <arg1> <arg2>`; an empty name logs nothing. */
  readonly name: string;
  readonly body: string;
}

export const log = (name: string): string =>
  name === ""
    ? ""
    : `printf '%s' '${name}' >> '{CALLS}'\nfor a in "$@"; do printf ' <%s>' "$a" >> '{CALLS}'; done\nprintf '\\n' >> '{CALLS}'\n`;

export const stub = (name: string, body: string, where = `bin/${name}`): StubFile => ({
  path: where,
  name,
  body,
});

/** `gh`: `auth status` exits `authExit`; the n-th `label create` (1-based) fails when `failNth` is set. */
export const ghStub = (opts: { failNth?: number; authExit?: number } = {}): StubFile =>
  stub(
    "gh",
    `case "$1" in\n  auth) exit ${opts.authExit ?? 0} ;;\n  label)\n    n=$(cat '{ROOT}/bin/.gh-count' 2>/dev/null || echo 0)\n    n=$((n + 1))\n    echo "$n" > '{ROOT}/bin/.gh-count'\n    ${opts.failNth === undefined ? ":" : `[ "$n" = "${opts.failNth}" ] && exit 1`}\n    ;;\nesac\nexit 0\n`,
  );

const ENV_VARS = [
  "FRICTION_WING",
  "THRESHOLD",
  "MAX_ISSUES",
  "TARGET_REPO_OVERRIDE",
  "FROM_STDIN_FILE",
  "DEEP_MODE",
  "DEEP_WINDOW",
];

/**
 * An interpreter that records its argv, then for `curate.py` the seven environment variables and
 * the stdin file (permissions, checksum, carriage returns), for `apply.py` its standard input.
 * It prints `out`, writes `err` to stderr and exits `exit` (`applyExit` for `apply.py`).
 */
export function pythonStub(
  opts: { out?: string; err?: string; exit?: number; applyExit?: number; where?: string } = {},
): StubFile {
  const env = ENV_VARS.map(
    (v) => `printf '  env ${v}=<%s>\\n' "\${${v}-<unset>}" >> '{CALLS}'`,
  ).join("\n    ");
  const body =
    `case "$1" in\n  *curate.py)\n    ${env}\n` +
    `    if [ -n "\${FROM_STDIN_FILE-}" ] && [ -f "$FROM_STDIN_FILE" ]; then\n` +
    `      printf '  stdin-file mode=%s cksum=%s cr=%s\\n' "$(ls -l "$FROM_STDIN_FILE" | cut -c1-10)" "$(cksum < "$FROM_STDIN_FILE")" "$(tr -cd '\\015' < "$FROM_STDIN_FILE" | wc -c | tr -d ' ')" >> '{CALLS}'\n    fi\n    ;;\n` +
    `  *apply.py)\n    printf '  stdin: ' >> '{CALLS}'\n    cat >> '{CALLS}'\n${
      opts.applyExit === undefined ? "" : `    exit ${opts.applyExit}\n`
    }    ;;\nesac\n` +
    `${opts.out === undefined ? "" : `cat <<'HC_OUT'\n${opts.out}\nHC_OUT\n`}` +
    `${opts.err === undefined ? "" : `cat >&2 <<'HC_ERR'\n${opts.err}\nHC_ERR\n`}` +
    `exit ${opts.exit ?? 0}\n`;
  return stub("python", body, opts.where ?? "bin/python3");
}

/** `pipx environment --value PIPX_HOME` prints `{ROOT}/pipx`. */
export const pipxStub = (): StubFile =>
  stub(
    "pipx",
    `case "$*" in\n  "environment --value PIPX_HOME") printf '%s\\n' '{ROOT}/pipx' ;;\nesac\nexit 0\n`,
  );

/** `uname -s` prints `os`; not logged (the entry never asks). */
export const unameStub = (os = "Linux"): StubFile =>
  stub("", `printf '%s\\n' '${os}'\n`, "bin/uname");

/** `fzf` answers its first call `weekly` and its second `09`; not logged (the entry has built-in prompts). */
export const fzfStub = (): StubFile =>
  stub(
    "",
    `cat > /dev/null\nn=$(cat '{ROOT}/bin/.fzf-count' 2>/dev/null || echo 0)\nn=$((n + 1))\necho "$n" > '{ROOT}/bin/.fzf-count'\nif [ "$n" = 1 ]; then echo weekly; else echo 09; fi\n`,
    "bin/fzf",
  );

/**
 * `crontab -l` exits 1 with no crontab (`crontab -` logs its input), as on a clean machine. The
 * shell leg runs both in one pipeline, so `crontab -` waits (a bounded spin, no `sleep` on the
 * sandbox PATH) until `crontab -l` has logged: the argv log order is then one order, not a race.
 */
export const crontabStub = (): StubFile =>
  stub(
    "",
    `case "$1" in\n  -l)\n${log("crontab")}` +
      `    : > '{ROOT}/bin/.crontab-l'\n    echo 'no crontab for user' >&2; exit 1 ;;\n` +
      `  -)\n    i=0\n    while [ ! -e '{ROOT}/bin/.crontab-l' ] && [ "$i" -lt 200000 ]; do i=$((i + 1)); done\n` +
      `${log("crontab")}    printf '  cron-input:\\n' >> '{CALLS}'; cat >> '{CALLS}' ;;\nesac\nexit 0\n`,
    "bin/crontab",
  );

/** `systemctl` and `launchctl` succeed and log their argv. */
export const managerStub = (name: "systemctl" | "launchctl"): StubFile => stub(name, "exit 0\n");
