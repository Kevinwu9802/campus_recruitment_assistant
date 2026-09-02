@echo off
rem LeetCode 每日刷题助手 - Windows 启动脚本
cd /d "%~dp0\.."

where node >nul 2>nul
if errorlevel 1 (
  echo 错误：未找到 Node.js，请先安装 Node.js 18+ (https://nodejs.org)
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，安装依赖（Electron 较大，请耐心等待）...
  call npm install --no-audit --no-fund
)

call npx electron .
