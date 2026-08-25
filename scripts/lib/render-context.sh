#!/usr/bin/env bash
# scripts/lib/render-context.sh — Shared context renderer for the generic
# `context` declaration subject (spec 0181, issue #1007). Do NOT execute
# directly; source it — same contract as scripts/lib/render-command.sh:109,148.
#
# An extension declares its agent-facing context exactly once, in one
# command-line-tool-neutral Markdown source (spec 0181 R1). This library's
# public entry point, render_context(), turns that single source into one
# target-specific output per call, by resolving a small render-variable
# vocabulary against the target's own knowledge (scripts/lib/extension-targets.json)
# and the extension's own declarations (commands/skills). It is called
# INSIDE each of the four renderers (scripts/build-extension.sh's
# render_gemini, and each of the three plugin builders) the same way
# render_command_gemini/render_command_claude are, because the three
# install-*-plugin.sh scripts invoke the plugin builders directly, bypassing
# build-extension.sh — a centrally-rendered context would be absent from
# every install (see specs/0181-extension-context-pivot.md's *Approach*).
#
# ── Vocabulary (spec 0181 R3/R4) ─────────────────────────────────────────
#
#   ${TOOL}                       the target's display name
#   ${EXTENSION}                  the extension's own `.name`
#   ${COMMAND:<name>}             invocation reference for a DECLARED command
#   ${SKILL:<name>}               invocation reference for a DECLARED skill
#   ${ONLY:<t>[,<t>...]}...${ENDONLY}      span kept only on the named targets
#   ${EXCEPT:<t>[,<t>...]}...${ENDEXCEPT}  span kept on every target EXCEPT those named
#
# `${COMMAND:x}` / `${SKILL:x}` resolve against `scripts/lib/extension-targets.json`'s
# `commandRef` / `skillRef` columns — per-target TEMPLATES using `{ext}` (the
# extension's own `.name`) and `{name}` (the declared entry's own name) as
# placeholders, never a literal namespace or prefix restated here (R4).
#
# ── Pass order — (b)(a)(c)(d)(e), mask first ─────────────────────────────
#
#   (b) replace every literal `$${` with a U+0001 sentinel byte. The render
#       fails up front if the SOURCE already contains a raw U+0001 byte
#       (that byte is reserved for this pass).
#   (a) resolve ${ONLY:...}/${EXCEPT:...} spans (see *Span semantics*).
#   (c) substitute ${TOOL} / ${EXTENSION}.
#   (d) resolve ${COMMAND:x} / ${SKILL:x} against the DECLARED entry set only
#       (commands from `<commands.location>/*.md` frontmatter `name`, skills
#       from `<skills.location>/*/` directory names) — matched by the
#       anchored patterns `\$\{COMMAND:([^}]*)\}` / `\$\{SKILL:([^}]*)\}`,
#       never a generic `${...}` scan. An unresolved reference prints
#       `UNRESOLVED-REFERENCE: <file>:<line> — ${COMMAND:x}` (or SKILL) and
#       fails the render (R5) — every unresolved reference in the source is
#       named, not only the first.
#   (e) unmask U+0001 back to `${`.
#
# Masking first is what lets an author write `$${ONLY:copilot}` as ordinary
# prose: pass (a) sees a U+0001 byte immediately followed by "ONLY:copilot}"
# — no `${` prefix, no marker recognized — and pass (e) restores the two
# literal characters afterward.
#
# ── Span semantics — five rules ──────────────────────────────────────────
#
#   1. Markers may appear anywhere on a line and a span may cross lines.
#   2. Splice. A DROPPED span is removed from the first byte of its opening
#      marker through the last byte of its closing marker INCLUSIVE,
#      newlines included, so the text before the opener and the text after
#      the closer join into ONE output line.
#   3. Consumed line. A source line lying wholly inside a dropped span
#      carries no marker and emits NOTHING (rule 2 has already consumed it).
#   4. A KEPT span has only its two marker tokens removed, and a REMOVAL
#      SENTINEL (U+0002, distinct from pass (b)'s U+0001) is written at BOTH
#      sites — where the opener stood and where the closer stood.
#   5. Blank-line rule. After the pass, a line that is whitespace-only AND
#      carries a removal sentinel is deleted with its newline; a line that
#      was already blank in the source has no sentinel and survives.
#
# Nesting is forbidden: any opener encountered while a span is already open
# is NESTED-BLOCK by construction (no stack, no second state variable — this
# also turns a CROSSING pair, e.g.
# `${ONLY:a}...${EXCEPT:b}...${ENDONLY}...${ENDEXCEPT}`, into a diagnostic
# rather than three silently divergent renders).
#
# ── Diagnostics — eight, every one non-zero, naming file and line ────────
#
#   UNKNOWN-TARGET        a name that is no row of the descriptor
#   EMPTY-TARGET-LIST      ${ONLY:} / ${EXCEPT:} — checked BEFORE the list is
#                          split (splitting an empty string yields zero
#                          elements, so a per-element check never runs)
#   SPAN-KEPT-NOWHERE      an ${EXCEPT:...} naming every descriptor row — a
#                          valid marker that deletes a passage from every
#                          target, the exact failure UNKNOWN-TARGET exists to
#                          prevent, reached with well-formed names
#   UNCLOSED-BLOCK         an opener with no matching closer before EOF
#   STRAY-BLOCK-END        ${ENDONLY} / ${ENDEXCEPT} with no span open
#   MISMATCHED-BLOCK-END   an ${ONLY:...} closed by ${ENDEXCEPT}, or reverse
#   NESTED-BLOCK           containment and crossing alike
#   UNRESOLVED-REFERENCE   R5's undeclared-entry reference
#
# ── Near-miss warning, and its accepted residual ─────────────────────────
#
# After pass (e), any surviving `${IDENT}` / `${IDENT:arg}` whose IDENT
# matches `^[A-Z][A-Z_]*$` and is neither an in-vocabulary member nor a row
# of the committed known-external allow-list (`SKELETON_NAME` today — see
# scripts/create-extension.sh's own `${SKELETON_NAME}` scaffold-time
# substitution, resolved BEFORE this render ever runs, and
# extension-skeleton/EXTENSION-FORMAT.md's *Two substitution layers*) WARNS
# and does not fail: a hard error here would destroy the verbatim-passthrough
# guarantee that is exactly how R4 lets an author write a reference-shaped
# literal, and how `${extensionPath}` survives (it is not even close —
# lowercase). Residual, accepted and recorded: a mixed-case misspelling such
# as `${TOOl}` does not match the shape heuristic and passes through with no
# warning. The heuristic is stated as a heuristic, not a guarantee.
#
# Prerequisites: jq, yq, awk (POSIX-ish; tested against Bash 3.2 + BSD awk
# and GNU awk).

RENDER_CONTEXT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER_CONTEXT_TARGETS_JSON="${RENDER_CONTEXT_TARGETS_JSON:-$RENDER_CONTEXT_LIB_DIR/extension-targets.json}"

# Guard against double-sourcing clobbering identically-named helpers a caller
# may already have loaded — same idiom as render-command.sh.
if ! declare -F extract_frontmatter >/dev/null 2>&1; then
  # shellcheck source=render-command.sh
  . "$RENDER_CONTEXT_LIB_DIR/render-command.sh"
fi
if ! declare -F ext_subject_present >/dev/null 2>&1; then
  # shellcheck source=extension-manifest.sh
  . "$RENDER_CONTEXT_LIB_DIR/extension-manifest.sh"
fi

# Known-external allow-list (near-miss warning residual) — one row today.
RENDER_CONTEXT_KNOWN_EXTERNAL=" SKELETON_NAME "
# In-vocabulary identifiers — never a near-miss, escaped or not.
RENDER_CONTEXT_VOCAB=" TOOL EXTENSION COMMAND SKILL ONLY EXCEPT ENDONLY ENDEXCEPT "

# render_context_target_column <target> <column> — echoes one column's raw
# value for <target> from the descriptor table, or empty when absent.
render_context_target_column() {
  local target="$1" column="$2"
  jq -r --arg t "$target" --arg c "$column" '.[$t][$c] // empty' "$RENDER_CONTEXT_TARGETS_JSON" 2>/dev/null
}

# _render_context_expand_template <template> <ext> <name> — substitutes the
# descriptor's own `{ext}` / `{name}` placeholders (private to this render;
# unrelated to the source file's own `${...}` vocabulary, which has already
# been fully resolved by the time a template is expanded).
_render_context_expand_template() {
  local tmpl="$1" ext="$2" name="$3"
  tmpl="${tmpl//\{ext\}/$ext}"
  tmpl="${tmpl//\{name\}/$name}"
  printf '%s' "$tmpl"
}

# render_context_target_output <target> <ext-name> — echoes the resolved,
# target-relative path of THAT target's own context output (R8/R9/R10/R11:
# the render's own knowledge of where its output lands, never authored).
# Empty when the target's row carries no contextOutput column.
render_context_target_output() {
  local target="$1" ext_name="$2" tmpl
  tmpl="$(render_context_target_column "$target" contextOutput)"
  [ -n "$tmpl" ] || return 0
  _render_context_expand_template "$tmpl" "$ext_name" ""
}

# --- Declared-entry sets (pass (d)'s ONLY source of truth) -----------------

_render_context_declared_commands() {
  local manifest="$1" ext_dir="$2" loc f nm
  [ "$(ext_subject_present "$manifest" commands)" = "true" ] || return 0
  loc="$(ext_subject_location "$manifest" commands "commands/")"
  loc="${loc%/}"
  [ -d "$ext_dir/$loc" ] || return 0
  for f in "$ext_dir/$loc"/*.md; do
    [ -f "$f" ] || continue
    nm="$(yaml_field "$f" name)"
    [ -n "$nm" ] && [ "$nm" != "null" ] && echo "$nm"
  done
}

_render_context_declared_skills() {
  local manifest="$1" ext_dir="$2" loc d
  [ "$(ext_subject_present "$manifest" skills)" = "true" ] || return 0
  loc="$(ext_subject_location "$manifest" skills "skills/")"
  loc="${loc%/}"
  [ -d "$ext_dir/$loc" ] || return 0
  for d in "$ext_dir/$loc"/*/; do
    [ -d "$d" ] || continue
    basename "$d"
  done
}

# --- Pass (a) — span resolution --------------------------------------------
#
# One awk pass that accumulates the (masked) file and walks it as a token
# stream: markers may appear anywhere and a span may cross lines, which a
# per-line construct cannot express (spec 0181 step 6's H1 suffix and
# parenthetical both open mid-line).
_render_context_pass_a() {
  # _render_context_pass_a <masked-content-file> <target> <known-targets-space-joined> <source-name-for-diagnostics>
  local content_file="$1" target="$2" known="$3" fname="$4"
  awk -v target="$target" -v known=" $known " -v fname="$fname" -v SENT="$(printf '\x02')" '
    BEGIN { RS = "\003" }
    {
      s = $0
      out = ""
      i = 1
      in_span = 0
      span_keep = 0
      span_kind = ""
      had_error = 0
      while (1) {
        pa_o = index(substr(s, i), "${ONLY:")
        pa_x = index(substr(s, i), "${EXCEPT:")
        pa_co = index(substr(s, i), "${ENDONLY}")
        pa_cx = index(substr(s, i), "${ENDEXCEPT}")
        best = 0; kind = ""
        if (pa_o > 0) { a = i + pa_o - 1; if (best == 0 || a < best) { best = a; kind = "ONLY" } }
        if (pa_x > 0) { a = i + pa_x - 1; if (best == 0 || a < best) { best = a; kind = "EXCEPT" } }
        if (pa_co > 0) { a = i + pa_co - 1; if (best == 0 || a < best) { best = a; kind = "ENDONLY" } }
        if (pa_cx > 0) { a = i + pa_cx - 1; if (best == 0 || a < best) { best = a; kind = "ENDEXCEPT" } }

        if (best == 0) {
          if (in_span) {
            printf "UNCLOSED-BLOCK: %s:%d - %s span opened here has no matching close before end of file\n", fname, open_line, span_kind > "/dev/stderr"
            had_error = 1
          } else {
            out = out substr(s, i)
          }
          break
        }

        prefix = substr(s, i, best - i)

        if (kind == "ONLY" || kind == "EXCEPT") {
          lit_len = (kind == "ONLY") ? 7 : 9   # length("${ONLY:") / length("${EXCEPT:")
          name_start = best + lit_len
          close_rel = index(substr(s, name_start), "}")
          if (close_rel == 0) {
            printf "UNCLOSED-BLOCK: %s:%d - %s marker has no closing brace\n", fname, line_at(best), kind > "/dev/stderr"
            had_error = 1
            break
          }
          targets_raw = substr(s, name_start, close_rel - 1)
          marker_end = name_start + close_rel

          if (in_span) {
            out = out prefix
            printf "NESTED-BLOCK: %s:%d - a new %s span opened while a %s span is already open\n", fname, line_at(best), kind, span_kind > "/dev/stderr"
            had_error = 1
            break
          }

          if (targets_raw == "") {
            printf "EMPTY-TARGET-LIST: %s:%d - ${%s:} names no target\n", fname, line_at(best), kind > "/dev/stderr"
            had_error = 1
            break
          }

          n = split(targets_raw, names, ",")
          delete named
          unknown = ""
          for (k = 1; k <= n; k++) {
            nm = names[k]
            gsub(/^[ \t]+|[ \t]+$/, "", nm)
            named[nm] = 1
            if (index(known, " " nm " ") == 0) unknown = nm
          }
          if (unknown != "") {
            printf "UNKNOWN-TARGET: %s:%d - '\''%s'\'' is not a known render target\n", fname, line_at(best), unknown > "/dev/stderr"
            had_error = 1
            break
          }

          if (kind == "ONLY") {
            keep = (target in named)
          } else {
            keep = !(target in named)
            kept_nowhere = 1
            nk = split(known, kn, " ")
            for (k = 1; k <= nk; k++) {
              if (kn[k] == "") continue
              if (!(kn[k] in named)) { kept_nowhere = 0 }
            }
            if (kept_nowhere) {
              printf "SPAN-KEPT-NOWHERE: %s:%d - ${EXCEPT:%s} names every known target; this span is kept on none of them\n", fname, line_at(best), targets_raw > "/dev/stderr"
              had_error = 1
              break
            }
          }

          out = out prefix
          if (keep) out = out SENT
          in_span = 1
          span_keep = keep
          span_kind = kind
          open_line = line_at(best)
          i = marker_end
          continue
        } else {
          # ENDONLY / ENDEXCEPT
          clen = (kind == "ENDONLY") ? 10 : 12   # length("${ENDONLY}") / length("${ENDEXCEPT}")
          marker_end = best + clen

          if (!in_span) {
            out = out prefix
            printf "STRAY-BLOCK-END: %s:%d - %s with no span open\n", fname, line_at(best), kind > "/dev/stderr"
            had_error = 1
            break
          }
          expected = (span_kind == "ONLY") ? "ENDONLY" : "ENDEXCEPT"
          if (kind != expected) {
            printf "MISMATCHED-BLOCK-END: %s:%d - a %s span closed by %s\n", fname, line_at(best), span_kind, kind > "/dev/stderr"
            had_error = 1
            break
          }

          if (span_keep) {
            out = out prefix SENT
          }
          # dropped: prefix (interior, still inside the dropped span) discarded

          in_span = 0
          i = marker_end
          continue
        }
      }

      if (had_error) { print "" > "/dev/null"; exit 1 }

      # Rule 5 — blank-line cleanup, line by line.
      nlines = split(out, lines, "\n")
      oi = 0
      for (li = 1; li <= nlines; li++) {
        line = lines[li]
        clean = line
        cnt = gsub(SENT, "", clean)
        is_ws = (clean ~ /^[ \t\r]*$/)
        if (cnt > 0 && is_ws) continue
        oi++
        out_lines[oi] = clean
      }
      result = ""
      for (j = 1; j <= oi; j++) {
        result = result out_lines[j]
        if (j < oi) result = result "\n"
      }
      printf "%s", result
      exit 0
    }
    function line_at(pos,    tmp, cnt) {
      tmp = substr(s, 1, pos - 1)
      cnt = gsub(/\n/, "\n", tmp)
      return cnt + 1
    }
  ' "$content_file"
}

# --- Pass (d) — ${COMMAND:x} / ${SKILL:x} resolution -----------------------

_render_context_pass_d() {
  # _render_context_pass_d <content-file> <ext-name> <cmd-tmpl> <skill-tmpl> <declared-cmds-space-joined> <declared-skills-space-joined> <source-name-for-diagnostics>
  local content_file="$1" ext_name="$2" cmd_tmpl="$3" skill_tmpl="$4" cmds="$5" skills="$6" fname="$7"
  awk -v extname="$ext_name" -v cmd_tmpl="$cmd_tmpl" -v skill_tmpl="$skill_tmpl" \
      -v cmds=" $cmds " -v skills=" $skills " -v fname="$fname" '
    BEGIN { RS = "\003" }
    {
      s = $0
      out = ""
      i = 1
      had_error = 0
      while (1) {
        pc = index(substr(s, i), "${COMMAND:")
        ps = index(substr(s, i), "${SKILL:")
        best = 0; kind = ""
        if (pc > 0) { a = i + pc - 1; if (best == 0 || a < best) { best = a; kind = "COMMAND" } }
        if (ps > 0) { a = i + ps - 1; if (best == 0 || a < best) { best = a; kind = "SKILL" } }
        if (best == 0) { out = out substr(s, i); break }

        out = out substr(s, i, best - i)
        lit_len = (kind == "COMMAND") ? 10 : 8   # length("${COMMAND:") / length("${SKILL:")
        name_start = best + lit_len
        close_rel = index(substr(s, name_start), "}")
        if (close_rel == 0) { out = out substr(s, best); break }
        nm = substr(s, name_start, close_rel - 1)
        marker_end = name_start + close_rel

        declared = (kind == "COMMAND") ? cmds : skills
        if (index(declared, " " nm " ") > 0) {
          tmpl = (kind == "COMMAND") ? cmd_tmpl : skill_tmpl
          val = tmpl
          gsub(/\{ext\}/, extname, val)
          gsub(/\{name\}/, nm, val)
          out = out val
        } else {
          printf "UNRESOLVED-REFERENCE: %s:%d - ${%s:%s}\n", fname, line_at(best), kind, nm > "/dev/stderr"
          had_error = 1
        }
        i = marker_end
      }
      printf "%s", out
      exit (had_error ? 1 : 0)
    }
    function line_at(pos,    tmp, cnt) {
      tmp = substr(s, 1, pos - 1)
      cnt = gsub(/\n/, "\n", tmp)
      return cnt + 1
    }
  ' "$content_file"
}

# --- Near-miss warning (non-fatal) ------------------------------------------

_render_context_warn_near_miss() {
  local final_file="$1" fname="$2" ln token ident
  # `grep -noE` — a warning-only sweep, never assertable content; a
  # variable-content check elsewhere in this codebase uses `[[ == * ]]`, not
  # this, but a FILE-argument grep for a diagnostic scan is the established
  # idiom (scripts/lib/extension-manifest.sh's own token scans use it).
  while IFS=: read -r ln token; do
    [ -z "$token" ] && continue
    ident="${token#\$\{}"
    ident="${ident%\}}"
    ident="${ident%%:*}"
    case " $RENDER_CONTEXT_VOCAB " in *" $ident "*) continue ;; esac
    case "$RENDER_CONTEXT_KNOWN_EXTERNAL" in *" $ident "*) continue ;; esac
    case "$ident" in
      [A-Z]*)
        if [[ "$ident" =~ ^[A-Z][A-Z_]*$ ]]; then
          echo "Warning: $fname:$ln — '$token' has the shape of a vocabulary token but matches none; passed through verbatim" >&2
        fi
        ;;
    esac
  done < <(grep -noE '\$\{[A-Za-z_]+(:[^}]*)?\}' "$final_file")
}

# --- Public entry point -----------------------------------------------------

# render_context <source.md> <target> <manifest> <ext_dir>
# Thin wrapper: allocates a scratch dir, delegates to _render_context_impl,
# and guarantees cleanup on every path (success, a diagnostic failure, or an
# early return) WITHOUT a `RETURN` trap — bash 3.2 supports one, but the
# wrapper/impl split is simpler and needs no signal-name trap at all.
render_context() {
  local work rc
  work="$(mktemp -d)" || return 1
  _render_context_impl "$1" "$2" "$3" "$4" "$work"
  rc=$?
  rm -rf "$work"
  return "$rc"
}

_render_context_impl() {
  local source="$1" target="$2" manifest="$3" ext_dir="$4" work="$5"

  # Preserve the source's exact trailing-newline structure through command
  # substitution (which strips ALL trailing newlines) via the append/strip
  # sentinel trick.
  local raw
  raw="$(cat "$source"; printf 'X')"
  raw="${raw%X}"

  case "$raw" in
    *$'\x01'*)
      echo "ERROR: $source — source already contains a reserved control byte (U+0001); cannot render" >&2
      return 1
      ;;
  esac

  # Pass (b) — mask literal $${ before any marker recognition.
  local masked="${raw//\$\$\{/$'\x01'}"
  printf '%s' "$masked" > "$work/b.txt"

  local known_targets
  # `_*` keys (e.g. `_readme`) are the descriptor's own metadata, never a
  # render target — excluded here, not just in the row lookups, so
  # SPAN-KEPT-NOWHERE's "every known target" test is not vacuously
  # unreachable against a name no author could ever legitimately write.
  known_targets="$(jq -r '[keys_unsorted[] | select(startswith("_") | not)] | join(" ")' "$RENDER_CONTEXT_TARGETS_JSON")"

  # Pass (a) — span resolution. Written straight to a FILE (never through a
  # `$(...)` capture) because command substitution unconditionally strips
  # trailing newlines, which would silently break the R7/step-6
  # byte-preservation guarantee on every render. The exit status therefore
  # comes from the redirected command itself, not from a substitution.
  _render_context_pass_a "$work/b.txt" "$target" "$known_targets" "$source" > "$work/a.txt" || return 1
  local spanned
  spanned="$(cat "$work/a.txt"; printf 'X')"
  spanned="${spanned%X}"

  # Pass (c) — ${TOOL} / ${EXTENSION}.
  local tool_name ext_name
  tool_name="$(render_context_target_column "$target" displayName)"
  ext_name="$(jq -r '.name' "$manifest")"
  local substituted="${spanned//\$\{TOOL\}/$tool_name}"
  substituted="${substituted//\$\{EXTENSION\}/$ext_name}"
  printf '%s' "$substituted" > "$work/c.txt"

  # Pass (d) — ${COMMAND:x} / ${SKILL:x} against the declared entry set only.
  # Same file-redirect discipline as pass (a), same reason.
  local cmd_tmpl skill_tmpl declared_cmds declared_skills
  cmd_tmpl="$(render_context_target_column "$target" commandRef)"
  skill_tmpl="$(render_context_target_column "$target" skillRef)"
  declared_cmds="$(_render_context_declared_commands "$manifest" "$ext_dir" | tr '\n' ' ')"
  declared_skills="$(_render_context_declared_skills "$manifest" "$ext_dir" | tr '\n' ' ')"
  _render_context_pass_d "$work/c.txt" "$ext_name" "$cmd_tmpl" "$skill_tmpl" "$declared_cmds" "$declared_skills" "$source" > "$work/d.txt" || return 1
  local resolved
  resolved="$(cat "$work/d.txt"; printf 'X')"
  resolved="${resolved%X}"

  # Pass (e) — unmask U+0001 back to ${.
  local final="${resolved//$'\x01'/\$\{}"
  printf '%s' "$final" > "$work/e.txt"

  _render_context_warn_near_miss "$work/e.txt" "$source"

  cat "$work/e.txt"
}
