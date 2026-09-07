'use strict';
/**
 * store.js — JSON 数据持久化
 * 数据文件位于 dataDir（默认 app.getPath('userData')/data，可在设置中修改）。
 * 全部数据以 JSON 文件保存，便于 WebDAV 同步与手工备份。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILES = {
  config: 'config.json',
  lists: 'lists.json',
  history: 'history.json',
  plan: 'plan.json',
  sessions: 'sessions.json',
  kaoyan: 'kaoyan.json',
  syncState: 'syncState.json',
};

let dataDir = null;
const cache = {}; // file -> object
let dirty = new Set();
let saveTimer = null;
let onSaved = null; // callback after flush (for sync trigger)

function defaultConfig() {
  return {
    version: 1,
    profileUrl: 'https://leetcode.cn/u/kevinwu-z/',
    userSlug: 'kevinwu-z',
    scheduleStart: '2026-09-01', // 计划开始日期（此前的日期不生成题单）
    listEnabled: {},            // slug -> true/false，null 表示全部启用
    monthPlans: {},             // 'YYYY-MM' -> MonthPlan，缺省回退到 getMonthPlanDefault
    restDates: {},              // 'YYYY-MM-DD' -> true(休息) / false(强制刷题)
    fetch: { enabled: true, time: '08:00', staleHours: 12 },
    sync: {
      enabled: false,
      server: 'https://dav.jianguoyun.com/dav',
      username: '',
      password: '',
      remotePath: '/LeetCodeDailyHelper',
      intervalMin: 30,
    },
    timer: { defaultMinutes: 25, sessionTag: '刷题' },
    llm: {
      mode: 'similarity',          // similarity | llm | none
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',      // 可改为 deepseek-v4-flash 等
      timeout: 45,                  // 秒
      cleanCards: true,            // 导入时用 LLM 再审阅、组合/拆分/补充知识点
    },
    ui: { theme: 'dark' },           // dark | light | auto（跟随系统）
  };
}

function defaultMonthPlan() {
  return {
    enabled: true,
    newMin: 1, newMax: 1,
    reviewMin: 2, reviewMax: 3,
    restWeekdays: [0, 6], // 0=周日 ... 6=周六；空数组 = 每天都刷
  };
}

/** 按月份返回内置默认计划（9/10/11 为招聘冲刺节奏，其余月份为日常节奏） */
function getMonthPlanDefault(monthKey /* 'YYYY-MM' */) {
  const m = Number(monthKey.slice(5, 7));
  const p = defaultMonthPlan();
  if (m === 9) {        // 冲刺预热：新 2 + 复习 3
    p.newMin = 2; p.newMax = 2;
    p.reviewMin = 3; p.reviewMax = 3;
    p.restWeekdays = [0];
  } else if (m === 10) { // 笔试面试高峰：新 1~2 + 复习 3~4
    p.newMin = 1; p.newMax = 2;
    p.reviewMin = 3; p.reviewMax = 4;
    p.restWeekdays = [0];
  } else if (m === 11) { // 以复习为主，少量新题保手感
    p.newMin = 0; p.newMax = 1;
    p.reviewMin = 3; p.reviewMax = 5;
    p.restWeekdays = [0];
  } else {
    p.newMin = 1; p.newMax = 1;
    p.reviewMin = 2; p.reviewMax = 3;
    p.restWeekdays = [0, 6];
  }
  return p;
}

function init(dir) {
  dataDir = dir;
  fs.mkdirSync(dataDir, { recursive: true });
  for (const key of Object.keys(FILES)) loadFile(key);
  // 首次运行写默认配置
  if (!cache.config || !cache.config.profileUrl) {
    cache.config = Object.assign(defaultConfig(), cache.config || {});
    dirty.add('config');
    flush();
  }
}

function filePath(key) { return path.join(dataDir, FILES[key]); }

function loadFile(key) {
  const p = filePath(key);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    cache[key] = JSON.parse(raw);
  } catch (e) {
    cache[key] = null;
  }
}

function get(key) {
  if (!(key in cache)) loadFile(key);
  return cache[key];
}

function set(key, value) {
  cache[key] = value;
  dirty.add(key);
  scheduleSave();
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => flush(), 300);
}

/** 立即落盘（同步）。返回写失败的文件列表 */
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const failed = [];
  for (const key of dirty) {
    const p = filePath(key);
    try {
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cache[key], null, 1), 'utf8');
      fs.renameSync(tmp, p);
    } catch (e) {
      console.error('[store] 保存失败', key, e.message);
      failed.push(key);
    }
  }
  dirty = new Set();
  if (onSaved) { try { onSaved(); } catch (e) { console.error(e); } }
  return failed;
}

function setDataDir(dir) {
  init(dir);
  return flush();
}

function getDataDir() { return dataDir; }

/** 导出全部数据（用于手动备份 / 迁移） */
function exportAll() {
  flush();
  const out = {};
  for (const key of Object.keys(FILES)) out[key] = cache[key];
  return out;
}

/** 导入全部数据（覆盖，先备份现有文件） */
function importAll(bundle) {
  flush();
  const backupDir = path.join(dataDir, 'backup-' + Date.now());
  fs.mkdirSync(backupDir, { recursive: true });
  const imported = [];
  for (const key of Object.keys(FILES)) {
    if (!(key in bundle)) continue;
    const p = filePath(key);
    if (fs.existsSync(p)) {
      try { fs.copyFileSync(p, path.join(backupDir, FILES[key])); } catch (e) {}
    }
    cache[key] = bundle[key];
    dirty.add(key);
    imported.push(FILES[key]);
  }
  flush();
  return { imported, backupDir };
}

module.exports = {
  FILES, init, get, set, flush, setDataDir, getDataDir,
  exportAll, importAll, getMonthPlanDefault, defaultConfig,
  set onSaved(fn) { onSaved = fn; },
};
