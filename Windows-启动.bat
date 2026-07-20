@echo off
chcp 65001 >nul
title 有极智能Agent - 启动器
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ╔═══════════════════════════════════════════════════════════╗
echo ║           有极智能 Agent · 启动器                          ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
echo 项目目录：%ROOT%
echo 正在启动启动器（node launcher/server.js）...
echo 浏览器将自动打开，若未打开请访问控制台输出的地址（默认 http://127.0.0.1:3800）
echo.

pushd "%ROOT%"
node launcher/server.js --open
popd

if errorlevel 1 (
  echo.
  echo 启动失败：请确认 runtime/ 下已包含 Node.js 运行环境，或系统已安装 Node.js。
  pause
)
