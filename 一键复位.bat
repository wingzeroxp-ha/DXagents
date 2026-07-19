@echo off
chcp 65001 >nul
title 有极智能Agent - 一键复位

echo ╔═══════════════════════════════════════════════════════════╗
echo ║           有极智能Agent · 一键复位工具                     ║
║                                                               ║
║  本工具将清空以下内容：                                        ║
║    • API Key 和模型配置                                       ║
║    • 用户数据（Hermes 和 OpenClaw 的工作区、记忆等）           ║
║    • 运行时记录（PID、日志、备份）                             ║
║    • 权限设置和语言偏好                                        ║
║                                                               ║
║  保留以下内容：                                                ║
║    • Agent 程序本体                                           ║
║    • 运行时（Node / Python / uv）                             ║
║    • 预置智能体配置和模型市场数据                              ║
║    • 启动器代码                                               ║
║                                                               ║
║  复位后项目恢复到 U 盘新装状态。                                 ║
╚═══════════════════════════════════════════════════════════════╝
echo.

setlocal enabledelayedexpansion

:: 定位项目根目录（脚本所在位置）
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo 项目目录：%ROOT%
echo.

:: ── 确认 ────────────────────────────────────────────────────
set /p confirm="输入 YES 确认复位（输入其他任意内容取消）: "
if /i not "!confirm!"=="YES" (
    echo.
    echo 已取消，未做任何更改。
    pause
    exit /b 0
)

echo.
echo 正在停止运行中的进程...

:: ── 停止 Agent 和启动器 ─────────────────────────────────────
taskkill /f /im node.exe 2>nul
taskkill /f /im python.exe 2>nul
taskkill /f /im hermes.exe 2>nul
timeout /t 2 /nobreak >nul

echo 进程已停止。

:: ── 清空配置 ────────────────────────────────────────────────
echo.
echo 正在清空配置...

if exist "%ROOT%\config\model.json"       del /q "%ROOT%\config\model.json"       & echo   [删除] model.json
if exist "%ROOT%\config\model.openclaw.json" del /q "%ROOT%\config\model.openclaw.json" & echo   [删除] model.openclaw.json
if exist "%ROOT%\config\model.hermes.json"   del /q "%ROOT%\config\model.hermes.json"   & echo   [删除] model.hermes.json
if exist "%ROOT%\config\model-mode.json"   del /q "%ROOT%\config\model-mode.json" & echo   [删除] model-mode.json
if exist "%ROOT%\config\permissions.json"  del /q "%ROOT%\config\permissions.json" & echo   [删除] permissions.json
if exist "%ROOT%\config\language.json"
if exist "%ROOT%\config\custom-presets.json" del /q "%ROOT%\config\custom-presets.json" & echo   [删除] custom-presets.json     del /q "%ROOT%\config\language.json" & echo   [删除] language.json

:: 重置 runtime-ports.json 为空对象
echo {} > "%ROOT%\config\runtime-ports.json"
echo   [重置] runtime-ports.json

:: ── 清空用户数据 ────────────────────────────────────────────
echo.
echo 正在清空用户数据...

if exist "%ROOT%\data\hermes" (
    rmdir /s /q "%ROOT%\data\hermes" 2>nul
    mkdir "%ROOT%\data\hermes" >nul 2>&1
    echo   [重置] data\hermes\
)

if exist "%ROOT%\data\openclaw" (
    rmdir /s /q "%ROOT%\data\openclaw" 2>nul
    mkdir "%ROOT%\data\openclaw" >nul 2>&1
    echo   [重置] data\openclaw\
)

:: ── 清空运行时记录 ──────────────────────────────────────────
echo.
echo 正在清空运行时记录...

if exist "%ROOT%\data\launcher\pids" (
    rmdir /s /q "%ROOT%\data\launcher\pids" 2>nul
    mkdir "%ROOT%\data\launcher\pids" >nul 2>&1
    echo   [重置] data\launcher\pids\
)

if exist "%ROOT%\data\launcher\logs" (
    rmdir /s /q "%ROOT%\data\launcher\logs" 2>nul
    mkdir "%ROOT%\data\launcher\logs" >nul 2>&1
    echo   [重置] data\launcher\logs\
)

if exist "%ROOT%\data\launcher\backups" (
    rmdir /s /q "%ROOT%\data\launcher\backups" 2>nul
    mkdir "%ROOT%\data\launcher\backups" >nul 2>&1
    echo   [重置] data\launcher\backups\
)

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║                   复位完成                                ║
║                                                               ║
║  项目已恢复到新装状态。                                        ║
║                                                               ║
║  请重新运行启动器。                                            ║
╚═══════════════════════════════════════════════════════════════╝
echo.
pause
