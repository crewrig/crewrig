#!/usr/bin/env bash
# scripts/lib/extension-manifest.sh — Shared manifest accessors and validator
# for the generic extension declaration model (spec 0173).
#
# Do NOT execute directly; source it. Requires: jq.
#
# An extension declares its whole cross-CLI surface once in `extension.json`
# (spec 0173 R1): each declaration subject (`commands`, `skills`, `agents`,
# `hooks`, `mcpServers`, `context`) lives in a generic top-level section, and a
# per-CLI section (`gemini`, `claude`, `copilot`, `antigravity`) carries only
# the keys that fail to generalize (R2/R3). The accessors below resolve the
# generic section FIRST, falling back to the legacy `components.<subject>.*`
# shape when the generic section is absent — the interim spec 0173's *Out of
# scope* grants until the clean-break migration (S5, issue #1008) removes the
# fallback chain. This is the ONE place that fallback is decided; every
# caller (the three plugin builders, scripts/build-extension.sh) reads through
# it rather than re-implementing the two-shape read.
#
# Under the generic schema a subject has NO enablement toggle (R5): its
# presence as a top-level section IS its enablement. Under the legacy
# `components.*` shape a subject is enabled by `components.<subject>.enabled`.

EXT_MANIFEST_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_MCP_TARGETS_JSON="$EXT_MANIFEST_LIB_DIR/extension-targets.json"

# scripts/lib/common.sh is sourced here (spec 0180 PLAN v5 step 3) rather than
# from scripts/build-extension.sh: this is the ONE file all four entry points
# already load (build-extension.sh, build-claude-plugin.sh,
# build-copilot-plugin.sh, build-antigravity-extension.sh), so the three
# standalone install-*-plugin.sh invocations that source this file directly
# get org_mcp_to_native for free too. Safe: common.sh's only top-level
# statements are variable assignments (no top-level command runs at source
# time), and it shares zero function names with this file, build-extension.sh
# or extension-hooks.sh (verified with `comm -12` over both symbol sets).
# shellcheck source=common.sh
. "$EXT_MANIFEST_LIB_DIR/common.sh"

ext_subject_present() {
  # ext_subject_present <manifest-file> <subject>
  # Echoes "true"/"false".
  local manifest="$1" subject="$2"
  jq -r --arg s "$subject" '
    if (has($s) and (.[$s] != null)) then "true"
    else ((.components[$s].enabled // false) | if type == "boolean" then . else false end | tostring)
    end
  ' "$manifest"
}

ext_subject_location() {
  # ext_subject_location <manifest-file> <subject> <default>
  local manifest="$1" subject="$2" default="$3"
  jq -r --arg s "$subject" --arg d "$default" '
    if (has($s) and (.[$s] != null)) then (.[$s].location // $d)
    else (.components[$s].location // $d)
    end
  ' "$manifest"
}

ext_subject_option() {
  # ext_subject_option <manifest-file> <subject> <option> [<default>]
  local manifest="$1" subject="$2" option="$3" default="${4:-}"
  jq -r --arg s "$subject" --arg o "$option" --arg d "$default" '
    if (has($s) and (.[$s] != null)) then (.[$s][$o] // $d)
    else (.components[$s][$o] // $d)
    end
  ' "$manifest"
}

ext_version() {
  # ext_version <manifest-file> — reads .version from extension.json (R11: the
  # render's own single source, independent of package.json).
  local manifest="$1"
  jq -r '.version // ""' "$manifest"
}

ext_validate_manifest() {
  # ext_validate_manifest <manifest-file> <percli-keys-allowlist-json>
  # Implements R3/R8 as a hard failure: any key inside a per-CLI top-level
  # section (gemini/claude/copilot/antigravity) that is not a row of the
  # allowlist is a manifest validation error. Prints one line per offense to
  # stderr and returns non-zero; returns 0 (silent) when the manifest is
  # clean. Fail-closed: an allowlist row absent or malformed does not admit
  # the key (spec 0173 PLAN step 3).
  #
  # Also calls ext_hooks_validate (spec 0179 R3/R4/R7/R8): a malformed
  # generic `hooks` entry fails the build here too, alongside the per-CLI
  # key check, so both error classes surface from the one validation call
  # sites already invoke.
  local manifest="$1" allowlist="$2"
  local cli errors=0
  for cli in gemini claude copilot antigravity; do
    local keys
    keys=$(jq -r --arg c "$cli" '.[$c] // {} | keys[]?' "$manifest" 2>/dev/null) || continue
    while IFS= read -r key; do
      [ -z "$key" ] && continue
      if ! jq -e --arg k "$cli.$key" 'any(.[]?; .key == $k)' "$allowlist" >/dev/null 2>&1; then
        echo "VALIDATION-ERROR: $manifest — inadmissible per-CLI key '$cli.$key' (not in $allowlist)" >&2
        errors=$((errors + 1))
      fi
    done <<< "$keys"
  done

  # shellcheck source=extension-hooks.sh
  . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/extension-hooks.sh"
  ext_hooks_validate "$manifest" || errors=$((errors + 1))

  # MCP (spec 0180 R1/R5/R12/R15): shape first (closes the fail-open paths),
  # then the positional token rule, then the reserved-name check. Each is a
  # separate function (steps 2/9), not a change to this function's signature.
  ext_validate_mcp_shape "$manifest" || errors=$((errors + 1))
  ext_validate_mcp_tokens "$manifest" || errors=$((errors + 1))
  local reserved_json
  reserved_json="$(jq -cn '$ARGS.positional' --args ${MCP_RESERVED_NAMES[@]+"${MCP_RESERVED_NAMES[@]}"})"
  ext_validate_mcp_names "$manifest" "$reserved_json" || errors=$((errors + 1))

  [ "$errors" -eq 0 ]
}

ext_discover_dirs() {
  # ext_discover_dirs <repo-dir>
  # The single extension-discovery predicate (spec 0173 PLAN v2-F3): every
  # directory extensions/{core,library,org}/*/ carrying an extension.json at
  # its root — R1's own mandatory marker. Called by both the render and the
  # --check walk of scripts/build-extension.sh, so R6's "no second entry point
  # or second drift guard" holds at the discovery layer too. All three tiers
  # are in scope, `org` included (R10 as amended names no tier carve-out).
  local repo_dir="$1" tier ext_dir
  for tier in core library org; do
    [ -d "$repo_dir/extensions/$tier" ] || continue
    for ext_dir in "$repo_dir/extensions/$tier"/*/; do
      [ -f "${ext_dir}extension.json" ] || continue
      (cd "$ext_dir" && pwd)
    done
  done
}

ext_build_dir() {
  # ext_build_dir <repo-dir> <name> — the single place the build-directory
  # layout is decided (spec 0173Δ R7/R22). Render, --check, install-extension.sh
  # and the debugging link task all resolve it through this one function.
  local repo_dir="$1" name="$2"
  echo "$repo_dir/build/extensions/$name"
}

ext_gap_dir() {
  # ext_gap_dir <repo-dir> <name> — the observed gap set lives beside the
  # build directory but OUTSIDE it (spec 0173Δ R22: the installable tree must
  # stay complete with no second render, so build metadata must not ship
  # inside it).
  local repo_dir="$1" name="$2"
  echo "$repo_dir/build/gaps/$name"
}

# --- Extension-scoped MCP server declaration (spec 0180, issue #1006) ------
#
# An extension declares its MCP servers ONCE, in the neutral `mcpServers`
# top-level section (R1) — the SAME vocabulary and translation the org-level
# channel of spec 0091 already uses (R2): transport stdio|http|sse (absent
# means stdio), {command, args?, env?} for stdio, {url, headers?} for
# http/sse. ext_mcp_native below reuses org_mcp_to_native VERBATIM rather
# than minting a second translator.

# ext_validate_mcp_shape <manifest> — R1/R5/R15 as a hard failure (PLAN v5
# step 2). Closes four fail-open paths a pre-validation draft ran live
# against org_mcp_to_native: an unknown transport passed through silently, a
# missing endpoint delivered as a bare `null`, and a non-vocabulary key
# (`cwd`, `timeout`, `trust`, ...) dropped without a trace. R5's clean break
# means a non-conforming declaration is a manifest validation error, not a
# silent transformation. Prints one VALIDATION-ERROR line per offense to
# stderr and returns non-zero; silent and returns 0 when `.mcpServers` is
# absent/null (R1: omitting the section stays valid) or every entry conforms.
ext_validate_mcp_shape() {
  local manifest="$1" errors=0
  jq -e 'has("mcpServers") and (.mcpServers != null)' "$manifest" >/dev/null 2>&1 || return 0

  if ! jq -e '.mcpServers | type == "object"' "$manifest" >/dev/null 2>&1; then
    echo "VALIDATION-ERROR: $manifest — the generic 'mcpServers' section must be an object keyed by server name" >&2
    return 1
  fi

  local names name
  names="$(jq -r '.mcpServers | keys[]' "$manifest" 2>/dev/null)"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    local entry transport key keys
    entry="$(jq -c --arg n "$name" '.mcpServers[$n]' "$manifest")"
    transport="$(jq -r '.transport // "stdio"' <<< "$entry")"

    case "$transport" in
      stdio|http|sse) ;;
      *)
        echo "VALIDATION-ERROR: $manifest — mcpServers.$name declares transport '$transport', outside the admissible set {stdio, http, sse}" >&2
        errors=$((errors + 1))
        continue
        ;;
    esac

    if [ "$transport" = "stdio" ]; then
      jq -e '(.command // "") | length > 0' <<< "$entry" >/dev/null 2>&1 || {
        echo "VALIDATION-ERROR: $manifest — mcpServers.$name (transport stdio) is missing a non-empty 'command'" >&2
        errors=$((errors + 1))
      }
      keys="$(jq -r 'keys[]' <<< "$entry")"
      while IFS= read -r key; do
        [ -z "$key" ] && continue
        case "$key" in
          transport|command|args|env) ;;
          *)
            echo "VALIDATION-ERROR: $manifest — mcpServers.$name (transport stdio) declares inadmissible key '$key' (admissible: transport, command, args, env)" >&2
            errors=$((errors + 1))
            ;;
        esac
      done <<< "$keys"
    else
      jq -e '(.url // "") | length > 0' <<< "$entry" >/dev/null 2>&1 || {
        echo "VALIDATION-ERROR: $manifest — mcpServers.$name (transport $transport) is missing a non-empty 'url'" >&2
        errors=$((errors + 1))
      }
      keys="$(jq -r 'keys[]' <<< "$entry")"
      while IFS= read -r key; do
        [ -z "$key" ] && continue
        case "$key" in
          transport|url|headers) ;;
          *)
            echo "VALIDATION-ERROR: $manifest — mcpServers.$name (transport $transport) declares inadmissible key '$key' (admissible: transport, url, headers)" >&2
            errors=$((errors + 1))
            ;;
        esac
      done <<< "$keys"
    fi
  done <<< "$names"

  [ "$errors" -eq 0 ]
}

# ext_validate_mcp_names <manifest> <reserved-names-json-array> — R12: an
# extension SHALL NOT deliver a server under a framework-reserved MCP server
# name (mirrors spec 0091 R10's framework-wins rule; the reserved set itself
# is never duplicated here — the caller derives <reserved-names-json-array>
# from MCP_RESERVED_NAMES, common.sh's single source). A NEW, separate
# function deliberately, not a change to ext_validate_manifest's signature
# (both sibling tickets are likely to extend that one). Fails naming the
# extension and the reserved name. Fail-closed: an empty or malformed
# reserved-set argument is itself a hard error — a silently-empty set would
# let every name through.
ext_validate_mcp_names() {
  local manifest="$1" reserved_json="$2" errors=0 name ext_name

  if ! jq -e 'type == "array"' <<< "$reserved_json" >/dev/null 2>&1 \
     || [ "$(jq 'length' <<< "$reserved_json" 2>/dev/null || echo 0)" = "0" ]; then
    echo "VALIDATION-ERROR: $manifest — the framework-reserved MCP name set is empty or malformed; refusing to validate mcpServers.* against it (fail-closed)" >&2
    return 1
  fi

  jq -e 'has("mcpServers") and (.mcpServers != null)' "$manifest" >/dev/null 2>&1 || return 0
  ext_name="$(jq -r '.name // "?"' "$manifest")"

  local names
  names="$(jq -r '.mcpServers | keys[]' "$manifest" 2>/dev/null)"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    if jq -e --arg n "$name" 'index($n) != null' <<< "$reserved_json" >/dev/null 2>&1; then
      echo "VALIDATION-ERROR: $manifest — extension '$ext_name' declares MCP server '$name', a framework-reserved name; choose a name outside the reserved set" >&2
      errors=$((errors + 1))
    fi
  done <<< "$names"
  [ "$errors" -eq 0 ]
}

# EXT_MCP_KNOWN_PATH_TOKENS — the five known path tokens (PLAN v5 step 9):
# the neutral token, each target's own root-token spelling, and gemini-cli's
# real `${/}` variable (reference.md:361) — refused inside env/headers
# VALUES, where arbitrary ${...} interpolation is otherwise legitimate (an
# API-key placeholder, gemini-cli's documented ${VAR_NAME} env substitution).
EXT_MCP_KNOWN_PATH_TOKENS='${extensionRoot} ${extensionPath} ${CLAUDE_PLUGIN_ROOT} ${COPILOT_PLUGIN_ROOT} ${/}'

# ext_validate_mcp_tokens <manifest> — R6/R9 positional token rule,
# REPLACING a five-entry denylist (which is fail-open by construction: it
# never covers a token nobody has listed yet, e.g. gemini-cli's own `${/}`).
#   - In `command`/`args`: an ALLOWLIST — the ONLY admissible `${...}` is
#     `${extensionRoot}`. Fail-closed: any other `${...}` token there,
#     known or not, is refused.
#   - In `env`/`headers` VALUES: a small DENYLIST of the five known path
#     tokens above. Any other `${...}` interpolation is admissible.
ext_validate_mcp_tokens() {
  local manifest="$1" errors=0 name
  jq -e 'has("mcpServers") and (.mcpServers != null)' "$manifest" >/dev/null 2>&1 || return 0

  local names
  names="$(jq -r '.mcpServers | keys[]' "$manifest" 2>/dev/null)"
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    local entry leaf token cmdargs envheaders known
    entry="$(jq -c --arg n "$name" '.mcpServers[$n]' "$manifest")"

    cmdargs="$(jq -r '[(.command // empty)] + (.args // []) | .[]' <<< "$entry")"
    while IFS= read -r leaf; do
      [ -z "$leaf" ] && continue
      while IFS= read -r token; do
        [ -z "$token" ] && continue
        if [ "$token" != '${extensionRoot}' ]; then
          echo "VALIDATION-ERROR: $manifest — mcpServers.$name declares '$token' inside command/args; the only admissible path token there is \${extensionRoot}" >&2
          errors=$((errors + 1))
        fi
      done < <(printf '%s' "$leaf" | grep -oE '\$\{[^}]*\}' || true)
    done <<< "$cmdargs"

    envheaders="$(jq -r '[(.env // {}), (.headers // {})] | .[] | .[]?' <<< "$entry" 2>/dev/null)"
    while IFS= read -r leaf; do
      [ -z "$leaf" ] && continue
      while IFS= read -r token; do
        [ -z "$token" ] && continue
        for known in $EXT_MCP_KNOWN_PATH_TOKENS; do
          if [ "$token" = "$known" ]; then
            echo "VALIDATION-ERROR: $manifest — mcpServers.$name declares path token '$token' inside an env/headers value; a path token has no path to resolve against there" >&2
            errors=$((errors + 1))
          fi
        done
      done < <(printf '%s' "$leaf" | grep -oE '\$\{[^}]*\}' || true)
    done <<< "$envheaders"
  done <<< "$names"
  [ "$errors" -eq 0 ]
}

# ext_mcp_delivery <target> — echoes "true"/"false": does <target> receive an
# MCP declaration at all (PLAN v5 step 3, v2-F5)? Read from
# scripts/lib/extension-targets.json's `mcpDelivery` column by BOTH the
# per-CLI emitters and the parent's gap decision, so the two cannot encode
# the same fact twice and drift apart. Fail-closed: a missing/malformed row
# or column reads as "false" (undeliverable) rather than silently assuming
# delivery works.
ext_mcp_delivery() {
  local target="$1"
  jq -r --arg t "$target" '.[$t].mcpDelivery // false | tostring' "$EXT_MCP_TARGETS_JSON" 2>/dev/null
}

# ext_mcp_native <target> <manifest> — PLAN v5 step 3. Reads `.mcpServers`,
# delegates shape translation to org_mcp_to_native "$target" VERBATIM (R2 —
# the same translation the org channel already uses), then rewrites the
# neutral `${extensionRoot}` token to the target's own resolved form via a
# jq walk over every string leaf (R6/R7/R8). Echoes the native JSON object.
#
# extension-targets.json's `rootToken` column is consumed AS-IS for
# gemini/claude/copilot — one fact about the target, shared with the hook
# translator's own resolution (scripts/lib/extension-hooks.sh). Antigravity's
# `rootToken` is `null` there, but MCP and hooks give a null rootToken
# OPPOSITE meanings, because Antigravity's own process CWD at spawn time
# differs by subject (evidenced live:
# docs/runbooks/extension-mcp-token-probe.md's Q2). A hook fires with the
# plugin directory as CWD, so hooks' own resolver strips the token, leaving a
# working-directory-relative command that resolves. An MCP server spawns
# with the CLI's OWN launch directory as CWD (confirmed: an absolute command
# spawned correctly; a relative one, with or without an explicit empty
# `cwd`, was silently never spawned at all), so the same strip would leave
# an unresolvable relative command. For MCP, therefore, a null rootToken
# means "leave `${extensionRoot}` UNRESOLVED" — the render ships the neutral
# token verbatim, and scripts/install-antigravity-extension.sh's post-install
# rewrite (Option A) is the party that resolves it, once it can finally know
# the real installed directory (R7's "named resolver, named moment"). This
# is why ext_mcp_native does NOT call _ext_hooks_resolve_command: the two
# subjects' null-handling is genuinely different, not a shared fact about
# the target, so sharing that function would silently break one of them.
ext_mcp_native() {
  local target="$1" manifest="$2"
  local neutral native root_token
  neutral="$(jq -c '.mcpServers // {}' "$manifest")"
  native="$(org_mcp_to_native "$target" "$neutral")"

  root_token="$(jq -r --arg t "$target" '.[$t].rootToken // empty' "$EXT_MCP_TARGETS_JSON" 2>/dev/null)"
  if [ -n "$root_token" ]; then
    jq -c --arg root "$root_token" \
      'walk(if type == "string" then gsub("\\$\\{extensionRoot\\}"; $root) else . end)' \
      <<< "$native"
  else
    printf '%s' "$native"
  fi
}
