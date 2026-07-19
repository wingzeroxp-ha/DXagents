@echo off
setlocal
chcp 65001 >nul

set "AGENT_DIR=%~dp0"
set "NODE_ROOT=%PORTABLE_ROOT%\runtime\node-win-x64"
set "PATH=%NODE_ROOT%;%NODE_ROOT%\node_modules\npm\bin;%AGENT_DIR%node_modules\.bin;%PATH%"

if not exist "%AGENT_DIR%node_modules\.bin\openclaw.cmd" (
  echo 未找到 OpenClaw 便携安装：%AGENT_DIR%node_modules\.bin\openclaw.cmd
  exit /b 1
)

if not exist "%AGENT_HOME%" mkdir "%AGENT_HOME%"
if not exist "%AGENT_WORKSPACE%" mkdir "%AGENT_WORKSPACE%"
if not exist "%AGENT_MEMORY%" mkdir "%AGENT_MEMORY%"
if not exist "%AGENT_LOG_DIR%" mkdir "%AGENT_LOG_DIR%"

set "OPENCLAW_HOME=%AGENT_HOME%"
set "OPENCLAW_STATE_DIR=%AGENT_HOME%"
set "OPENCLAW_CONFIG_PATH=%AGENT_HOME%\openclaw.json"
set "OPENCLAW_MEMORY_PATH=%AGENT_MEMORY%"
set "OPENCLAW_WORKSPACE=%AGENT_WORKSPACE%"
set "NPM_CONFIG_CACHE=%PORTABLE_ROOT%\data\openclaw\npm-cache"
set "USERPROFILE=%AGENT_HOME%"
set "TEMP=%AGENT_HOME%\tmp"
set "TMP=%AGENT_HOME%\tmp"

cd /d "%AGENT_DIR%"

call "%AGENT_DIR%node_modules\.bin\openclaw.cmd" gateway run --allow-unconfigured --bind loopback --auth none --port %AGENT_PORT%

