﻿@echo off
setlocal
chcp 65001 >nul

set "AGENT_DIR=%~dp0"
set "HERMES_APP=%AGENT_DIR%hermes-agent"
set "HERMES_VENV=%HERMES_APP%\venv"
set "HERMES_EXE=%HERMES_VENV%\Scripts\hermes.exe"
set "PORTABLE_UV=%PORTABLE_ROOT%\runtime\uv-win-x64\uv.exe"
set "NODE_ROOT=%PORTABLE_ROOT%\runtime\node-win-x64"

:check_venv
if exist "%HERMES_EXE%" goto :test_venv

echo 未找到 Hermes 虚拟环境，正在自动修复...
goto :repair_venv

:test_venv
"%HERMES_VENV%\Scripts\python.exe" -c "import hermes_cli" >nul 2>&1
if %ERRORLEVEL% equ 0 goto :start_hermes

echo Hermes 虚拟环境已损坏，正在重建...
rmdir /s /q "%HERMES_VENV%" 2>nul

:repair_venv
if not exist "%PORTABLE_UV%" (
  echo 错误：未找到便携 uv：%PORTABLE_UV%
  echo Hermes 依赖 Python 环境，请先安装 uv 或 Python 3.11+
  pause
  exit /b 1
)

set "UV_CACHE_DIR=%PORTABLE_ROOT%\data\hermes\uv-cache"
if not exist "%UV_CACHE_DIR%" mkdir "%UV_CACHE_DIR%"

echo [1/3] 正在创建虚拟环境...
"%PORTABLE_UV%" venv --python 3.11 "%HERMES_VENV%" --cache-dir "%UV_CACHE_DIR%"
if %ERRORLEVEL% neq 0 (
  echo 虚拟环境创建失败。请检查网络连接后重试。
  pause
  exit /b 1
)

echo [2/3] 正在安装 Hermes 依赖...
cd /d "%HERMES_APP%"
"%PORTABLE_UV%" pip install -e ".[web]" --python "%HERMES_VENV%\Scripts\python.exe" --cache-dir "%UV_CACHE_DIR%"
if %ERRORLEVEL% neq 0 (
  echo 依赖安装失败。请检查网络连接后重试。
  pause
  exit /b 1
)

echo [3/3] Hermes 虚拟环境已就绪
goto :start_hermes

:start_hermes
if not exist "%AGENT_HOME%" mkdir "%AGENT_HOME%"
if not exist "%AGENT_WORKSPACE%" mkdir "%AGENT_WORKSPACE%"
if not exist "%AGENT_MEMORY%" mkdir "%AGENT_MEMORY%"
if not exist "%AGENT_LOG_DIR%" mkdir "%AGENT_LOG_DIR%"
if not exist "%AGENT_HOME%\tmp" mkdir "%AGENT_HOME%\tmp"

set "HERMES_HOME=%AGENT_HOME%"
set "HOME=%PORTABLE_ROOT%\data\hermes\userprofile"
set "USERPROFILE=%PORTABLE_ROOT%\data\hermes\userprofile"
set "LOCALAPPDATA=%PORTABLE_ROOT%\data\hermes\localappdata"
set "TEMP=%PORTABLE_ROOT%\data\hermes\tmp"
set "TMP=%PORTABLE_ROOT%\data\hermes\tmp"
set "NPM_CONFIG_CACHE=%PORTABLE_ROOT%\data\hermes\npm-cache"
set "PATH=%NODE_ROOT%;%NODE_ROOT%\node_modules\npm\bin;%HERMES_VENV%\Scripts;%PATH%"

if not exist "%HERMES_HOME%\.env" (
  echo # Hermes portable environment>"%HERMES_HOME%\.env"
)

if not exist "%HERMES_HOME%\config.yaml" (
  echo # Hermes portable config>"%HERMES_HOME%\config.yaml"
  echo workspace: "%AGENT_WORKSPACE:\=/%">>"%HERMES_HOME%\config.yaml"
)

cd /d "%HERMES_APP%"
"%HERMES_EXE%" dashboard --host 127.0.0.1 --port %AGENT_DASHBOARD_PORT% --no-open --skip-build
