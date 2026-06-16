#!/usr/bin/env bash
# scripts/lib/render-command.sh — Shared command renderer for the pivot source
# format. Do NOT execute directly; source it.
#
# A "command" pivot source is a Markdown file with YAML frontmatter:
#
#   ---
#   name: <name>
#   description: "<description>"
#   type: command
#   metadata:                 # optional
#     provenance:
#       version: "..."
#       canonical: "..."
#       feedback: "..."
#   ---
#   <body — becomes the command prompt>
#
# This library exposes two pure render functions that take the path of a pivot
# `.md` source and print the rendered consumed form to stdout:
#
#   render_command_gemini <source.md>   → Gemini CLI `.toml` form
#   render_command_claude <source.md>   → Claude Code `SKILL.md` form
#
# Both `scripts/build-components.sh` (for artifacts/ commands) and
# `scripts/build-extension-pivot.sh` (for extension commands) call these, so the
# command render logic lives in exactly one place (spec 0042 R1/R2). The
# extraction is byte-for-byte faithful to the prior inline implementation in
# build-components.sh `build_commands()` so the artifacts/ outputs stay
# byte-identical (asserted by `build-components.sh --target all --check`).
#
# ── Carrier (spec 0042 R5), FORMAT-SPECIFIC ───────────────────────────────────
# Any metadata a target tool does not accept in native frontmatter must travel
# in a form that tool accepts, so a render never produces a source the tool
# rejects. The command→TOML path uses a TOML COMMENT line:
#
#   # crewrig-provenance: version="..." canonical="..." feedback="..."
#
# A bare HTML comment between TOML keys is a TOMLDecodeError, so the HTML-comment
# carrier (used on the skill/agent→Markdown paths via gemini_provenance_comment)
# is NOT transferable to TOML. The `#` line is valid TOML and is placed at the
# top level (above `description`), never inside the `prompt = """…"""` string,
# so it does not leak into the prompt text the model reads. The content of the
# provenance fields is sibling-spec 0043 scope; this library ships only the
# format-safe carrier MECHANISM.
#
# Prerequisites: yq (for frontmatter field extraction).

# Guard against double-sourcing clobbering identically-named helpers already
# defined by a caller (build-components.sh defines its own extract_frontmatter /
# extract_body / yaml_field). The definitions below are byte-equivalent in
# behavior, but we only define them if absent so a caller's versions win and the
# single-source guarantee is not silently broken.

if ! declare -F extract_frontmatter >/dev/null 2>&1; then
  # Extract YAML frontmatter from a Markdown file (between first two ---)
  extract_frontmatter() {
    awk 'NR==1 && /^---$/{inblk=1; next} inblk && /^---$/{exit} inblk{print}' "$1"
  }
fi

if ! declare -F extract_body >/dev/null 2>&1; then
  # Extract body from a Markdown file (everything after second ---)
  extract_body() {
    awk 'BEGIN{c=0} /^---$/{c++; if(c==2){found=1; next}} found{print}' "$1"
  }
fi

if ! declare -F yaml_field >/dev/null 2>&1; then
  # Read a YAML field from frontmatter
  yaml_field() {
    local file="$1" field="$2"
    extract_frontmatter "$file" | yq -r ".$field" 2>/dev/null || echo ""
  }
fi

# render_command_toml_provenance_comment <frontmatter>
# Returns the TOML provenance comment line for the command→TOML carrier, or
# empty if the frontmatter carries no metadata.provenance block. Mirrors the
# field-extraction of gemini_provenance_comment() in build-components.sh but
# emits a TOML `#` comment instead of an HTML comment (HTML comments are not
# valid TOML). The trailing newline is included so the caller can splice it as a
# standalone line.
render_command_toml_provenance_comment() {
  local frontmatter="$1"
  local has_prov
  has_prov=$(printf '%s\n' "$frontmatter" | yq -r '.metadata // {} | has("provenance")' 2>/dev/null || echo "false")
  if [ "$has_prov" != "true" ]; then
    return 0
  fi
  local version canonical feedback
  version=$(printf '%s\n' "$frontmatter" | yq -r '.metadata.provenance.version // ""' 2>/dev/null)
  canonical=$(printf '%s\n' "$frontmatter" | yq -r '.metadata.provenance.canonical // ""' 2>/dev/null)
  feedback=$(printf '%s\n' "$frontmatter" | yq -r '.metadata.provenance.feedback // ""' 2>/dev/null)
  printf '# crewrig-provenance: version="%s" canonical="%s" feedback="%s"\n' \
    "$version" "$canonical" "$feedback"
}

# render_command_gemini <source.md>
# Print the Gemini CLI `.toml` form of a command pivot source to stdout.
#
# Byte-identical to the prior build-components.sh `build_commands` Gemini block
# WHEN the source carries no provenance (the only case present under artifacts/
# today). When the source carries a metadata.provenance block, a TOML
# `# crewrig-provenance:` comment line is prepended above `description` (R5
# carrier). The emitted string carries NO trailing newline — callers add one
# (build-components.sh's check_or_write uses `echo`, build-extension-pivot.sh
# uses `printf '%s\n'`), matching the prior behavior exactly.
render_command_gemini() {
  local source="$1"
  local description body frontmatter prov_comment
  description=$(yaml_field "$source" "description")
  body=$(extract_body "$source")
  frontmatter=$(extract_frontmatter "$source")
  prov_comment=$(render_command_toml_provenance_comment "$frontmatter")

  # No provenance → byte-identical to the historical emitter.
  if [ -z "$prov_comment" ]; then
    printf '%s' "description = \"$description\"

prompt = \"\"\"
$body
\"\"\""
    return 0
  fi

  # Provenance present → splice the TOML comment line at top level, above
  # `description`. `tomllib` parses a leading `#` comment cleanly and the prompt
  # body is untouched.
  printf '%s' "$prov_comment
description = \"$description\"

prompt = \"\"\"
$body
\"\"\""
}

# render_command_claude <source.md>
# Print the Claude Code `SKILL.md` form of a command pivot source to stdout.
#
# Byte-identical to the prior build-components.sh `build_commands` Claude block.
# The Claude target is Markdown, so provenance (when present) is carried via the
# standard `metadata:` frontmatter splice performed by the caller's
# inject_provenance — this function emits the base frontmatter + body only,
# exactly as the historical inline code did (the caller then splices provenance,
# as build-components.sh does by passing $source to check_or_write). The emitted
# string carries NO trailing newline.
render_command_claude() {
  local source="$1"
  local name description body
  name=$(yaml_field "$source" "name")
  description=$(yaml_field "$source" "description")
  body=$(extract_body "$source")

  local claude_frontmatter="name: $name
description: \"$description\"
user-invocable: true"

  local allowed_tools
  allowed_tools=$(extract_frontmatter "$source" | yq -r '.claude.allowed-tools // [] | .[]' 2>/dev/null)
  if [ -n "$allowed_tools" ]; then
    claude_frontmatter="$claude_frontmatter
allowed-tools:"
    while IFS= read -r tool; do
      claude_frontmatter="$claude_frontmatter
  - $tool"
    done <<< "$allowed_tools"
  fi

  printf '%s' "---
$claude_frontmatter
---

$body"
}
