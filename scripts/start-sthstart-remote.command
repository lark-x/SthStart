#!/bin/zsh

set -u

ROOT="/Volumes/Lark/lark/SthStart"
cd "$ROOT" || exit 1

echo "SthStart Portal + 公共服务"
echo "Portal: http://127.0.0.1:4173"
echo "Service: http://127.0.0.1:4100"
echo "本窗口保持打开即可维持主站。"
echo

npm run start:local
