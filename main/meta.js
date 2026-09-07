'use strict';
/**
 * meta.js — 记录「不随数据同步」的本机信息（数据目录、LLM API Key 等）。
 * 该文件位于 userData 根目录（不在被 WebDAV 同步的数据目录内），
 * 因此 LLM API Key 永远不会被同步到云端。
 * 兼容纯 Node 环境（无 Electron 时使用临时目录兜底，便于单元测试）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const META_FILE = 'lc-helper-meta.json';

// 解析 userData 根目录（Electron 主进程内优先）
let USER_DATA = null;
try {
  // 注：纯 Node 下 require('electron') 返回的是可执行文件路径字符串，故解构得到 undefined
  const { app } = require('electron');
  if (app && typeof app.getPath === 'function') USER_DATA = app.getPath('userData');
} catch (e) { /* 非 Electron 环境 */ }
if (!USER_DATA) USER_DATA = process.env.LC_USER_DATA || path.join(os.tmpdir(), 'lc-helper-meta');

function metaPath() {
  return path.join(USER_DATA, META_FILE);
}

function load() {
  try { return JSON.parse(fs.readFileSync(metaPath(), 'utf8')); } catch { return {}; }
}

function save(m) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(metaPath(), JSON.stringify(m, null, 1));
  } catch (e) { console.error('[meta] 写入失败', e.message); }
}

function getDataDir(defaultDir) {
  return (load().dataDir || defaultDir || '').trim();
}

function saveDataDir(dir) {
  const m = load();
  m.dataDir = dir;
  save(m);
}

function getApiKey() {
  return load().llmApiKey || '';
}

function saveApiKey(key) {
  const m = load();
  m.llmApiKey = key || '';
  save(m);
}

module.exports = { getDataDir, saveDataDir, getApiKey, saveApiKey };
