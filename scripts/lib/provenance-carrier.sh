# shellcheck shell=bash
# provenance-carrier.sh — Shared parser for the crewrig-provenance HTML-comment
# carrier (spec 0043).
#
# Extension skills/agents are consumed IN PLACE with no render seam, and Gemini
# CLI 0.42.0+ rejects any frontmatter key outside `name`/`description`, so the
# provenance for an extension component rides on an HTML-comment carrier placed
# as the FIRST BODY LINE (immediately after the frontmatter close):
#
#   <!-- crewrig-provenance: version="…" canonical="…" feedback="…" -->
#
# Two pure, side-effect-free functions are factored here so the presence guard
# (scripts/check-extension-provenance.sh, spec 0043) and the version-bump guard
# (scripts/check-extension-version-bump.sh, spec 0044) share ONE parser and
# cannot drift if the carrier shape evolves. Both functions are verbatim moves
# from the original inline helper block of check-extension-provenance.sh — their
# behaviour MUST stay byte-identical (the 0043 regression test backstops it).
#
# Usage:
#   source "<repo>/scripts/lib/provenance-carrier.sh"
#   line="$(first_body_line path/to/SKILL.md)"
#   version="$(carrier_field "$line" version)"

# Extract the FIRST body line (first non-frontmatter line) of a Markdown file.
# Mirrors the awk used by test-gemini-agent-frontmatter.sh: skip the frontmatter
# block (first two `---` fences) and print the first non-empty line after it.
first_body_line() {
  awk '/^---$/{c++; next} c==2 && NF{print; exit}' "$1"
}

# Extract a quoted field value from a crewrig-provenance carrier line.
#   carrier_field '<carrier line>' canonical  →  the value between the quotes
# Returns empty if the field is absent or empty.
carrier_field() {
  local line="$1" field="$2"
  printf '%s\n' "$line" \
    | sed -n "s/.*${field}=\"\([^\"]*\)\".*/\1/p"
}
