#!/bin/sh
# Deterministic provider fixture. Does not invoke Claude or access credentials.
cat >/dev/null
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Fixture completed"}]}}'
printf '%s\n' '{"type":"result","is_error":false,"result":"Fixture completed"}'
