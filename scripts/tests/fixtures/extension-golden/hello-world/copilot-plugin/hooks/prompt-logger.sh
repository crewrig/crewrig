#!/bin/bash
# Hook: prompt-logger (spec 0179 R18 — maps-partially example)
#
# Fires on a user-prompt-submission moment: Claude Code, Gemini CLI and
# GitHub Copilot CLI each express one, but the Antigravity CLI does not — its
# complete event set (PreToolUse, PostToolUse, PreInvocation, PostInvocation,
# Stop) has no counterpart for it. That gap is declared in
# extensions/core/hello-world/accepted-gaps.json. Reads the payload on stdin
# and echoes it back unchanged.

read -r PAYLOAD
echo "$PAYLOAD"
