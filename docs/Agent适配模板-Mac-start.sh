#!/bin/bash
set -e

# 这个文件是模板。复制到对应 Agent 目录并改名为 start.sh 后才会被启动器识别。
# OpenClaw: AI-Agent-Portable/agents/openclaw/mac-arm64/start.sh
# Hermes:    AI-Agent-Portable/agents/hermes/mac-arm64/start.sh

echo "AGENT_ID=$AGENT_ID"
echo "AGENT_PORT=$AGENT_PORT"
echo "AGENT_HOME=$AGENT_HOME"
echo "AGENT_WORKSPACE=$AGENT_WORKSPACE"
echo "PORTABLE_MODEL_BASE_URL=$PORTABLE_MODEL_BASE_URL"
echo "PORTABLE_MODEL_NAME=$PORTABLE_MODEL_NAME"

# 在这里启动真正的 Agent。
# 例子：
# "$PORTABLE_ROOT/runtime/node-mac-arm64/bin/node" "$PORTABLE_ROOT/agents/openclaw/mac-arm64/openclaw.js" gateway --port "$AGENT_PORT"
# "$PORTABLE_ROOT/runtime/node-mac-arm64/bin/node" "$PORTABLE_ROOT/agents/hermes/mac-arm64/hermes.js" start --port "$AGENT_PORT"

echo "请把这个模板改成真实 Agent 启动命令。"
exit 1

