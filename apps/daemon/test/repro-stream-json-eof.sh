#!/bin/bash
# Regression repro for: OD runs hang forever at the "requesting" stage.
#
# Root cause: claude-code >= 2.1.x in `--input-format stream-json` blocks until
# it sees stdin EOF before finalizing a turn. The daemon used to keep stdin OPEN
# (to inject a later AskUserQuestion tool_result), so the agent never saw EOF and
# every run stalled. This script demonstrates the CLI behavior the fix relies on:
#   - stdin held OPEN  -> result only arrives after stdin finally closes (~HOLD s)
#   - stdin closed EOF -> result arrives promptly (a few seconds)
#
# PASS (bug present in CLI, fix justified): open-stdin run is slow, EOF run is fast.
# Run manually; needs a working `claude` + Anthropic auth/profile in the env.
set -u
CLAUDE="${CLAUDE_BIN:-claude}"
MSG='{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Reply with exactly: OK"}]}}'
ARGS="-p --input-format stream-json --output-format stream-json --verbose --permission-mode bypassPermissions"
HOLD=20

run_open() { # writes msg, holds stdin open HOLD seconds
  local t0=$SECONDS
  { printf '%s\n' "$MSG"; sleep "$HOLD"; } | timeout $((HOLD+25)) $CLAUDE $ARGS >/dev/null 2>&1
  echo $((SECONDS-t0))
}
run_eof() { # writes msg, closes stdin immediately
  local t0=$SECONDS
  printf '%s\n' "$MSG" | timeout 60 $CLAUDE $ARGS >/dev/null 2>&1
  echo $((SECONDS-t0))
}

open_s=$(run_open)
eof_s=$(run_eof)
echo "stdin-open elapsed: ${open_s}s | stdin-EOF elapsed: ${eof_s}s"

# The bug is present iff holding stdin open delays completion to ~HOLD while EOF
# completes quickly. Require open >= HOLD-2 and eof < HOLD-2.
if [ "$open_s" -ge $((HOLD-2)) ] && [ "$eof_s" -lt $((HOLD-2)) ]; then
  echo "PASS: CLI requires stdin EOF -> daemon must close stdin after the prompt."
  exit 0
fi
echo "FAIL: CLI did not show the EOF-gated behavior (open=${open_s}s eof=${eof_s}s)."
exit 1
