#!/bin/zsh

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_ROOT="$ROOT/upstream/linshe/agent-core"
WEB_ROOT="$ROOT/upstream/linshe/web-ui"
VECTOR_ROOT="$ROOT/upstream/linshe/vector-service"
VECTOR_PYTHON="$VECTOR_ROOT/venv/bin/python"
TUNNEL_NAME="${STHSTART_TUNNEL_NAME:-sthstart}"
TUNNEL_LOG="/private/tmp/sthstart-linshe-tunnel.log"
AGENT_LOG="/private/tmp/sthstart-linshe-agent.log"
WEB_LOG="/private/tmp/sthstart-linshe-web.log"
VECTOR_LOG="/private/tmp/sthstart-linshe-vector.log"

cd "$ROOT" || exit 1
rm -f "$TUNNEL_LOG"
rm -f "$AGENT_LOG" "$WEB_LOG" "$VECTOR_LOG"

run_agent() {
  while true; do
    (cd "$AGENT_ROOT" && npm run dev) >>"$AGENT_LOG" 2>&1
    printf '[supervisor] agent exited (%s), restarting in 2s\n' "$?" >>"$AGENT_LOG"
    sleep 2
  done
}

run_web() {
  while true; do
    (cd "$WEB_ROOT" && npm run dev -- --host 127.0.0.1 --port 5173) >>"$WEB_LOG" 2>&1
    printf '[supervisor] web exited (%s), restarting in 2s\n' "$?" >>"$WEB_LOG"
    sleep 2
  done
}

run_vector() {
  while true; do
    (cd "$VECTOR_ROOT" && "$VECTOR_PYTHON" -m uvicorn server:app --host 127.0.0.1 --port 8765) >>"$VECTOR_LOG" 2>&1
    printf '[supervisor] vector exited (%s), restarting in 2s\n' "$?" >>"$VECTOR_LOG"
    sleep 2
  done
}

run_tunnel() {
  while true; do
    cloudflared tunnel run "$TUNNEL_NAME" 2>&1 | tee -a "$TUNNEL_LOG"
    printf '[supervisor] tunnel exited (%s), retrying in 2s\n' "$?" >>"$TUNNEL_LOG"
    sleep 2
  done
}

echo "SthStart 邻舍远程服务"
echo "Web: http://127.0.0.1:5173"
echo "后端: http://127.0.0.1:3099"
echo "Named Tunnel: $TUNNEL_NAME（按 ~/.cloudflared/config.yml 路由）"
echo "本窗口保持打开即可维持邻舍和受 Access 保护的 Named Tunnel。"
echo

run_agent &
AGENT_PID=$!
run_web &
WEB_PID=$!
run_vector &
VECTOR_PID=$!
run_tunnel &
TUNNEL_PID=$!

cleanup() {
  trap - INT TERM EXIT
  kill "$AGENT_PID" "$WEB_PID" "$VECTOR_PID" "$TUNNEL_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}

trap cleanup INT TERM EXIT
wait
