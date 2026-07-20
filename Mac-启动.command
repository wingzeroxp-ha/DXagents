#!/bin/bash
# 有极智能 Agent · 启动器 (Mac / Apple Silicon)
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "═══════════════════════════════════════════════════════════"
echo "   有极智能 Agent · 启动器"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "项目目录：$ROOT"
echo "正在启动启动器（node launcher/server.js）..."
echo "浏览器将自动打开，若未打开请访问控制台输出的地址（默认 http://127.0.0.1:3800）"
echo ""

cd "$ROOT"
node launcher/server.js --open
