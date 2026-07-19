#!/bin/bash
# 有极智能Agent · 一键复位（Mac 版）

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           有极智能Agent · 一键复位工具                     ║"
echo "║                                                           ║"
echo "║  本工具将清空以下内容：                                    ║"
echo "║    • API Key 和模型配置                                   ║"
echo "║    • 用户数据（Hermes 和 OpenClaw 的工作区、记忆等）       ║"
echo "║    • 运行时记录（PID、日志、备份）                         ║"
echo "║    • 权限设置和语言偏好                                    ║"
echo "║                                                           ║"
echo "║  保留以下内容：                                            ║"
echo "║    • Agent 程序本体                                       ║"
echo "║    • 运行时（Node / Python）                              ║"
echo "║    • 预置智能体配置和模型市场数据                          ║"
echo "║    • 启动器代码                                           ║"
echo "║                                                           ║"
echo "║  复位后项目恢复到 U 盘新装状态。                             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "项目目录：$ROOT"
echo ""

read -p "输入 YES 确认复位（输入其他任意内容取消）: " confirm
if [ "$confirm" != "YES" ]; then
    echo ""
    echo "已取消，未做任何更改。"
    exit 0
fi

echo ""
echo "正在停止运行中的进程..."

pkill -f "node server.js" 2>/dev/null
pkill -f hermes 2>/dev/null
pkill -f openclaw 2>/dev/null
sleep 2

echo "进程已停止。"

echo ""
echo "正在清空配置..."

[ -f "$ROOT/config/model.json" ] && rm "$ROOT/config/model.json" && echo "  [删除] model.json"
[ -f "$ROOT/config/model.openclaw.json" ] && rm "$ROOT/config/model.openclaw.json" && echo "  [删除] model.openclaw.json"
[ -f "$ROOT/config/model.hermes.json" ] && rm "$ROOT/config/model.hermes.json" && echo "  [删除] model.hermes.json"
[ -f "$ROOT/config/model-mode.json" ] && rm "$ROOT/config/model-mode.json" && echo "  [删除] model-mode.json"
[ -f "$ROOT/config/permissions.json" ] && rm "$ROOT/config/permissions.json" && echo "  [删除] permissions.json"
[ -f "$ROOT/config/language.json" ]
[ -f "$ROOT/config/custom-presets.json" ] && rm "$ROOT/config/custom-presets.json" && echo "  [删除] custom-presets.json" && rm "$ROOT/config/language.json" && echo "  [删除] language.json"

echo '{}' > "$ROOT/config/runtime-ports.json"
echo "  [重置] runtime-ports.json"

echo ""
echo "正在清空用户数据..."

if [ -d "$ROOT/data/hermes" ]; then
    rm -rf "$ROOT/data/hermes"
    mkdir -p "$ROOT/data/hermes"
    echo "  [重置] data/hermes/"
fi

if [ -d "$ROOT/data/openclaw" ]; then
    rm -rf "$ROOT/data/openclaw"
    mkdir -p "$ROOT/data/openclaw"
    echo "  [重置] data/openclaw/"
fi

echo ""
echo "正在清空运行时记录..."

if [ -d "$ROOT/data/launcher/pids" ]; then
    rm -rf "$ROOT/data/launcher/pids"
    mkdir -p "$ROOT/data/launcher/pids"
    echo "  [重置] data/launcher/pids/"
fi

if [ -d "$ROOT/data/launcher/logs" ]; then
    rm -rf "$ROOT/data/launcher/logs"
    mkdir -p "$ROOT/data/launcher/logs"
    echo "  [重置] data/launcher/logs/"
fi

if [ -d "$ROOT/data/launcher/backups" ]; then
    rm -rf "$ROOT/data/launcher/backups"
    mkdir -p "$ROOT/data/launcher/backups"
    echo "  [重置] data/launcher/backups/"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                   复位完成                                ║"
echo "║                                                          ║"
echo "║  项目已恢复到新装状态。                                    ║"
echo "║                                                          ║"
echo "║  请重新运行启动器。                                        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
