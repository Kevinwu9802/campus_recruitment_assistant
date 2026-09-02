'use strict';
/**
 * meta.js — 记录数据目录位置（独立于被同步的数据文件，避免“找不到数据目录”的死锁）
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const META_FILE = 'lc-helper-meta.json';

function metaPath() {
  return path.join(app.getPath('userData'), META_FILE);
}

function load() {
  try { return JSON.parse(fs.readFileSync(metaPath(), 'utf8')); } catch { return {}; }
}

function getDataDir(defaultDir) {
  const m = load();
  return (m.dataDir && m.dataDir.trim()) ? m.dataDir.trim() : defaultDir;
}

function saveDataDir(dir) {
  const m = load();
  m.dataDir = dir;
  fs.writeFileSync(metaPath(), JSON.stringify(m, null, 1));
}

module.exports = { getDataDir, saveDataDir };
