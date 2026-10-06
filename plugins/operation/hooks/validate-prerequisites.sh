#!/usr/bin/env bash
# validate-prerequisites.sh
# PreToolUse hook for the Operation plugin.
#
# An audit only reads. The audited repository usually belongs to the customer, so the
# agent never writes to it: no commit, no push, no pull request, no comment. The
# detailed report is stored by the publisher (scripts/publish-aihub.mjs), which talks to
# AI Hub (or, opt-in, the GitHub API) itself — not through commands the agent runs.
#
# Also enforced here:
#   - The AI Hub key is read by the publisher from the environment and is never
#     printed or passed on a command line (fitness function F4: no secret in the logs).
#   - The publisher needs Node.js; say so before the run gets that far.
#
# Blocks by printing {"decision": "block", "reason": "..."} and exiting 0, as the
# other Xianix plugins do. Anything not matched is allowed.

set -uo pipefail

INPUT=$(cat)

# The command the agent wants to run. Node parses the hook's JSON properly when it is
# there; otherwise fall back to the first "command" string.
COMMAND=""
if command -v node > /dev/null 2>&1; then
    COMMAND=$(printf '%s' "$INPUT" | node -e '
        let s = "";
        process.stdin.on("data", (d) => (s += d));
        process.stdin.on("end", () => {
            try { process.stdout.write(String(JSON.parse(s)?.tool_input?.command ?? "")); } catch { }
        });' 2>/dev/null || true)
fi
if [ -z "$COMMAND" ]; then
    # A JSON string may hold escaped quotes (node "$PUBLISHER"), so match \" as part of it.
    COMMAND=$(printf '%s' "$INPUT" | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 \
        | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//; s/\\"/"/g' || true)
fi
[ -z "$COMMAND" ] && exit 0

block() {
    # Reasons are fixed strings below: no quotes or backslashes to escape.
    printf '{"decision": "block", "reason": "%s"}\n' "$1"
    exit 0
}

# Start of a command: line start, or after ; & | ( or a backtick, optionally behind
# env assignments, sudo or env.
LEAD='(^|[;&|(`]|\$\()[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|sudo|env)[[:space:]]+)*'

if printf '%s' "$COMMAND" | grep -qE "${LEAD}git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+(commit|push|merge|rebase|tag|reset[[:space:]]+--hard|checkout[[:space:]]+-b|switch[[:space:]]+-c)([[:space:]]|$)"; then
    block "The Operation plugin never writes to the audited repository (no commit, push, merge, rebase, tag or new branch). The publisher stores the detailed report in AI Hub. See commands/operation.md, Publishing to AI Hub."
fi

if printf '%s' "$COMMAND" | grep -qE "${LEAD}gh[[:space:]]+(pr|issue)[[:space:]]+(create|comment|edit|close|merge|reopen)([[:space:]]|$)"; then
    block "The Operation plugin does not open pull requests or comment on issues. Results go to AI Hub through the publisher; a fallback issue, when configured, is written by the publisher itself."
fi

if printf '%s' "$COMMAND" | grep -qE "${LEAD}gh[[:space:]]+api([[:space:]].*)?[[:space:]](-X|--method)[[:space:]]*(POST|PUT|PATCH|DELETE)"; then
    block "The Operation plugin only reads from GitHub. Writing through gh api is not allowed during an audit."
fi

if printf '%s' "$COMMAND" | grep -qE 'AIHUB[_-]API[_-]KEY'; then
    block "Do not read, print or pass the AI Hub key. The publisher reads it from the environment by itself; run it as: node \$PUBLISHER"
fi

if printf '%s' "$COMMAND" | grep -q 'publish-aihub\.mjs\|\$PUBLISHER\|\${PUBLISHER'; then
    if ! command -v node > /dev/null 2>&1; then
        block "Node.js is not installed or not in PATH, and the publisher needs it (Node 20 or later). Results cannot be delivered to AI Hub from this executor."
    fi
fi

exit 0
