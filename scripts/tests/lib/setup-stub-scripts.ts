// setup-stub-scripts.ts — the POSIX-shell texts of the setup stubs written by
// setup-stubs.ts (spec 0256, plan v2 step A3). Strings only: test fixtures
// generated at runtime, never tracked .sh files.

const prelude = (state: string): string => `S=${JSON.stringify(state)}
. "$S/stub.conf"
TAB="$(printf '\\t')"
jstr() { printf '%s' "$1" | tr '\\n\\t\\r' '   ' | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g'; }
jargv() { s=''; for a in "$@"; do s="$s\${s:+,}\\"$(jstr "$a")\\""; done; printf '[%s]' "$s"; }
rec() { printf '{"argv":%s%s}\\n' "$(shift; jargv "$@")" "$EXTRA" >> "$S/$1.jsonl"; }
EXTRA=''`;

const FZF = `header=''
preview=''
prev=''
for a in "$@"; do
  case "$prev" in --header|--prompt) [ -z "$header" ] && header="$a" ;; esac
  case "$a" in --header=*) header="\${a#--header=}" ;; --prompt=*) [ -z "$header" ] && header="\${a#--prompt=}" ;; esac
  case "$prev" in --preview) preview="$a" ;; esac
  prev="$a"
done
# The catalogue picker has no header: its --preview command names the catalogue directory.
[ -z "$header" ] && header="$preview"
input="$(cat)"
answer=''; found=0; cancelled=0
while IFS="$TAB" read -r key val; do
  [ -n "$key" ] || continue
  case "$header" in *"$key"*) answer="$val"; found=1; break ;; esac
done < "$S/fzf-answers.tsv"
unscripted=false
if [ "$found" -eq 0 ]; then unscripted=true; answer="$(printf '%s\\n' "$input" | head -n 1)"; fi
[ "$answer" = "$cancel" ] && cancelled=1
opts=''
while IFS= read -r line; do opts="$opts\${opts:+,}\\"$(jstr "$line")\\""; done <<EOT
$input
EOT
canc=false; [ "$cancelled" -eq 1 ] && canc=true
printf '{"argv":%s,"header":"%s","options":[%s],"answer":"%s","unscripted":%s,"cancelled":%s}\\n' \\
  "$(jargv "$@")" "$(jstr "$header")" "$opts" "$(jstr "$answer")" "$unscripted" "$canc" >> "$S/fzf.jsonl"
[ "$cancelled" -eq 1 ] && exit 130
printf '%s\\n' "$answer" | tr '|' '\\n'`;

const CLAUDE = `rec claude "$@"
db="$S/claude-mcp.tsv"
[ "$1" = "--version" ] && { echo "2.0.0 (Claude Code)"; exit 0; }
[ "$1" = "mcp" ] || exit 0
sub="$2"; shift 2
case "$sub" in
  list)
    if [ -s "$db" ]; then
      while IFS="$TAB" read -r n c; do echo "$n: $c - ✓ Connected"; done < "$db"
    else echo "No MCP servers configured. Use \\\`claude mcp add\\\` to add a server."; fi ;;
  add)
    name=''
    while [ $# -gt 0 ]; do
      case "$1" in --scope) shift 2; continue ;; --) shift; break ;; *) [ -z "$name" ] && name="$1" ;; esac
      shift
    done
    if grep -q "^$name$TAB" "$db" 2>/dev/null; then echo "MCP server $name already exists in user config" >&2; exit 1; fi
    printf '%s\\t%s\\n' "$name" "$*" >> "$db"; echo "Added stdio MCP server $name" ;;
  remove)
    name=''
    while [ $# -gt 0 ]; do case "$1" in --scope) shift ;; *) name="$1" ;; esac; shift; done
    grep -q "^$name$TAB" "$db" 2>/dev/null || { echo "No MCP server found with name: $name" >&2; exit 1; }
    grep -v "^$name$TAB" "$db" > "$db.new"; mv "$db.new" "$db"; echo "Removed MCP server $name" ;;
esac
exit 0`;

const NPM = `rec npm "$@"
if [ "$1" = "ci" ]; then
  if [ -n "$npm_fail" ]; then echo "$npm_fail" >&2; exit 1; fi
  mkdir -p node_modules
  [ -n "$npm_fixture" ] && cp -R "$npm_fixture"/. node_modules/
fi
exit 0`;

const PYTHON3 = `rec python3 "$@"
if [ "$1" = "-c" ]; then
  case "$2" in
    *importlib.metadata*)
      if [ "$mp_missing" = 1 ]; then echo "importlib.metadata.PackageNotFoundError: mempalace" >&2; exit 1; fi
      echo "$mp_version"; exit 0 ;;
  esac
  exit 0
fi
if [ "$1" = "-" ]; then
  src="$(cat)"
  [ "$mp_missing" = 1 ] && exit 1
  [ "$no_packaging" = 1 ] && { echo "ModuleNotFoundError: No module named 'packaging'" >&2; exit 1; }
  mn="$(printf '%s\\n' "$src" | sed -n 's/^mn = Version("\\(.*\\)")$/\\1/p')"
  mx="$(printf '%s\\n' "$src" | sed -n 's/^mx = Version("\\(.*\\)")$/\\1/p')"
  awk -v v="$mp_version" -v mn="$mn" -v mx="$mx" 'function n(s,  a,i,r){split(s,a,"."); r=0; for(i=1;i<=3;i++) r=r*100000+(a[i]+0); return r}
    BEGIN{exit (n(mn)<=n(v) && n(v)<n(mx)) ? 0 : 1}'
  exit $?
fi
exit 0`;

const CURL = `cfg="$(cat 2>/dev/null)"
bearer="$(printf '%s' "$cfg" | sed -n 's/.*Bearer \\([^"]*\\)".*/\\1/p' | head -n 1)"
url=''
for a in "$@"; do case "$a" in http://*|https://*) url="$a" ;; esac; done
EXTRA=",\\"url\\":\\"$(jstr "$url")\\",\\"bearer\\":\\"$(jstr "$bearer")\\""
rec curl "$@"
accept=0
case "$probe" in
  0) [ -n "$bearer" ] && [ "$bearer" != "$placeholder" ] && accept=1 ;;
  2) [ "$bearer" = "$placeholder" ] && accept=1 ;;
esac
case "$url" in */healthz) [ "$probe" = 1 ] || accept=1 ;; esac
if [ "$accept" -eq 1 ]; then printf '200'; exit 0; fi
printf '000'; exit 7`;

/** name -> script body (the shebang is added by the caller). */
export function stubScripts(state: string): Record<string, string> {
  const p = prelude(state);
  const out: Record<string, string> = {
    fzf: `${p}\n${FZF}`,
    claude: `${p}\n${CLAUDE}`,
    npm: `${p}\n${NPM}`,
    python3: `${p}\n${PYTHON3}`,
    curl: `${p}\n${CURL}`,
    pipx: `${p}\nrec pipx "$@"\n[ "$1" = "list" ] && echo "package mempalace $mp_version"\nexit 0`,
  };
  for (const name of ["agy", "gh", "copilot", "systemctl", "launchctl"]) {
    out[name] = `${p}\nrec ${name} "$@"\nexit 0`;
  }
  return out;
}
