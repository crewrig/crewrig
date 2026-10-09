#!/bin/bash
# Hook: shell-logger (spec 0179 R18 — maps-everywhere example)
#
# Fires before every shell-class tool call, on every supported target: the
# neutral `PreToolUse` event has a counterpart on Claude Code, Gemini CLI,
# GitHub Copilot CLI and the Antigravity CLI. Reads the tool-call payload on
# stdin and echoes it back unchanged, demonstrating a pass-through observer.

read -r PAYLOAD
echo "$PAYLOAD"
