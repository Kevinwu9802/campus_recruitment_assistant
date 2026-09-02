#!/usr/bin/env bash
# LeetCode 每日刷题助手 - Linux 启动脚本
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js，请先安装 Node.js 18+（https://nodejs.org）"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行，安装依赖（Electron 较大，请耐心等待）..."
  npm install --no-audit --no-fund
fi

exec npx electron .
