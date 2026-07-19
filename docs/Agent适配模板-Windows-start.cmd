@echo off
setlocal
chcp 65001 >nul

rem 这个文件是模板。复制到对应 Agent 目录并改名为 start.cmd 后才会被启动器识别。
rem OpenClaw: AI-Agent-Portable\agents\openclaw\win-x64\start.cmd
rem Hermes:    AI-Agent-Portable\agents\hermes\win-x64\start.cmd

echo AGENT_ID=%AGENT_ID%
echo AGENT_PORT=%AGENT_PORT%
echo AGENT_HOME=%AGENT_HOME%
echo AGENT_WORKSPACE=%AGENT_WORKSPACE%
echo PORTABLE_MODEL_BASE_URL=%PORTABLE_MODEL_BASE_URL%
echo PORTABLE_MODEL_NAME=%PORTABLE_MODEL_NAME%

rem 在这里启动真正的 Agent。
rem 例子：
rem "%PORTABLE_ROOT%\runtime\node-win-x64\node.exe" "%PORTABLE_ROOT%\agents\openclaw\win-x64\openclaw.js" gateway --port %AGENT_PORT%
rem "%PORTABLE_ROOT%\runtime\node-win-x64\node.exe" "%PORTABLE_ROOT%\agents\hermes\win-x64\hermes.js" start --port %AGENT_PORT%

echo 请把这个模板改成真实 Agent 启动命令。
exit /b 1

