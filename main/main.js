'use strict';
const { app, BrowserWindow, shell, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// 无 GPU 环境（虚拟机 / 远程桌面 / 无显卡驱动）下禁用硬件加速，改用软件渲染，
// 消除 GetVSyncParametersIfAvailable() failed 这类 GL/VSync 报错与白屏/崩溃。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('enable-unsafe-swiftshader'); // 允许 SwiftShader 软件渲染（WebGL/合成），受限环境必备
app.commandLine.appendSwitch('disable-features', 'Vulkan'); // 避免某些环境尝试 Vulkan 失败卡死

const store = require('./store');
const leetcode = require('./leetcode');
const scheduler = require('./scheduler');
const sync = require('./sync');
const { registerIpc } = require('./ipc');

let win = null;
let fetchRunning = false;
let syncTimer = null;
let fetchTimer = null;
let metaDir = null;

const META_FILE = 'lc-helper-meta.json';

function loadMeta() {
  try {
    return JSON.parse(fs.readFileSync(path.join(metaDir, META_FILE), 'utf8'));
  } catch { return {}; }
}
function saveMeta(m) {
  try { fs.writeFileSync(path.join(metaDir, META_FILE), JSON.stringify(m, null, 1)); } catch (e) {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 660,
    title: 'LeetCode 每日刷题助手',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#0f1420',
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 外链一律交给系统浏览器（含题目跳转）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL() && /^https?:\/\//.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.on('closed', () => { win = null; });

  // 渲染进程异常时自动重载，避免无 GPU/受限环境下白屏卡死
  win.webContents.on('render-process-gone', (e, details) => {
    console.warn('[main] 渲染进程退出：', details && details.reason);
    if (win && !win.isDestroyed() && details && details.reason !== 'clean-exit') {
      try { win.reload(); } catch (err) { console.error(err); }
    }
  });
  win.webContents.on('unresponsive', () => {
    console.warn('[main] 页面无响应，尝试重载');
    if (win && !win.isDestroyed()) { try { win.reload(); } catch (e) {} }
  });
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch (e) {}
}

function broadcast(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------------- 抓取 ----------------
async function runFetch(reason) {
  if (fetchRunning) return { ok: false, error: '抓取正在进行中' };
  fetchRunning = true;
  broadcast('fetchStatus', { running: true, step: '开始抓取', reason });
  const start = Date.now();
  try {
    const config = store.get('config') || {};
    const slug = config.userSlug || leetcode.parseSlug(config.profileUrl);
    if (!slug) {
      // 未配置主页：不当作错误，仅提示（首次使用先去配置）
      return { ok: false, error: '尚未配置个人主页：请到「题单管理」填入你的 LeetCode 主页链接' };
    }
    const lists = store.get('lists') || { lists: [], updatedAt: null };
    broadcast('fetchStatus', { running: true, step: `抓取用户 ${slug} 的公开题单…` });
    const { lists: remoteLists } = await leetcode.getUserLists(slug);
    let fetched = 0;
    const updated = [];
    for (const l of remoteLists) {
      broadcast('fetchStatus', { running: true, step: `抓取「${l.name}」${l.questionNumber} 题…`, list: l.name });
      const detail = await leetcode.getListQuestions(l.slug, (got, total) => {
        broadcast('fetchStatus', { running: true, step: `抓取「${l.name}」${got}/${total}…`, list: l.name, got, total });
      });
      const old = lists.lists.find(x => x.slug === l.slug);
      lists.lists = lists.lists.filter(x => x.slug !== l.slug);
      lists.lists.push(Object.assign({}, l, {
        questions: detail.questions,
        fetchedAt: new Date().toISOString(),
        questionNumber: detail.totalLength,
        prevQuestionNumber: old ? old.questionNumber : null,
      }));
      fetched += detail.questions.length;
      updated.push(l.name);
    }
    lists.updatedAt = new Date().toISOString();
    store.set('lists', lists);
    // 记忆库对账（跨题单去重，识别旧题）
    const history = store.get('history') || { questions: {} };
    const r = scheduler.reconcileHistory(lists.lists, history);
    store.set('history', history);
    store.flush();
    const cfg2 = store.get('config') || {};
    cfg2.lastFetchAt = new Date().toISOString();
    store.set('config', cfg2);
    // 抓取成功后：若今日计划因“池子为空”被固化成了空计划，则作废让其重新生成
    try {
      const planFile = store.get('plan') || {};
      const now = new Date();
      const todayDs = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (planFile[todayDs] && planFile[todayDs].items.length === 0 && !planFile[todayDs].rest) {
        delete planFile[todayDs];
        store.set('plan', planFile);
      }
    } catch (e) {}
    notify('题单抓取完成', `更新 ${updated.length} 个题单，共 ${fetched} 题；记忆库新增 ${r.added}、更新 ${r.updated}`);
    return { ok: true, lists: updated, fetched, added: r.added, updated: r.updated, ms: Date.now() - start };
  } catch (e) {
    notify('题单抓取失败', e.message);
    return { ok: false, error: e.message, ms: Date.now() - start };
  } finally {
    fetchRunning = false;
    broadcast('fetchStatus', { running: false });
  }
}

// ---------------- 题目池（新题候选） ----------------
async function runPoolFetch(reason) {
  broadcast('fetchStatus', { running: true, step: '抓取 LeetCode 题目池（新题候选）…', reason });
  try {
    const config = store.get('config') || {};
    const slug = config.userSlug || leetcode.parseSlug(config.profileUrl);
    if (!slug) return { ok: false, error: '尚未配置个人主页' };
    const r = await leetcode.getProblemPool();
    store.set('pool', { updatedAt: new Date().toISOString(), total: r.total, problems: r.problems });
    store.flush();
    notify('题目池已更新', `共 ${r.problems.length} 道候选新题`);
    broadcast('fetchStatus', { running: false });
    return { ok: true, count: r.problems.length, total: r.total };
  } catch (e) {
    broadcast('fetchStatus', { running: false });
    return { ok: false, error: e.message };
  }
}

function poolStale() {
  const p = store.get('pool');
  if (!p || !p.updatedAt) return true;
  const probs = p.problems || [];
  // 旧缓存不含 paidOnly 字段 → 视为过期，重新抓取以支持“跳过会员题”
  if (probs.length && !Object.prototype.hasOwnProperty.call(probs[0], 'paidOnly')) return true;
  return (Date.now() - new Date(p.updatedAt).getTime()) > 24 * 3600 * 1000;
}

function shouldFetchToday() {
  const config = store.get('config') || {};
  if (!config.fetch || config.fetch.enabled === false) return false;
  const now = new Date();
  const ds = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if ((config.lastFetchAt || '').startsWith(ds)) return false;
  const [hh, mm] = (config.fetch.time || '08:00').split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= hh * 60 + (mm || 0);
}

function startTimers() {
  // 定时抓取：每 30 分钟检查一次是否到了今天的抓取时间
  fetchTimer = setInterval(() => {
    if (shouldFetchToday() && !fetchRunning) runFetch('定时任务');
  }, 30 * 60 * 1000);
  // 定时同步：每分钟脉冲，按配置的间隔执行
  let lastSyncAt = Date.now();
  syncTimer = setInterval(() => {
    const config = store.get('config') || {};
    if (!config.sync || !config.sync.enabled) { lastSyncAt = Date.now(); return; }
    const interval = (config.sync.intervalMin || 30) * 60 * 1000;
    if (Date.now() - lastSyncAt < interval) return;
    lastSyncAt = Date.now();
    sync.syncNow({ report: m => broadcast('syncStatus', { running: true, msg: m }) })
      .then(r => { if (!r.ok) console.warn('[sync]', r.error); broadcast('syncStatus', { running: false, ...r }); });
  }, 60 * 1000);
}

app.whenReady().then(() => {
  metaDir = app.getPath('userData');
  const meta = loadMeta();
  const dataDir = meta.dataDir || path.join(app.getPath('userData'), 'data');
  store.init(dataDir);
  store.onSaved = () => {
    const config = store.get('config') || {};
    if (config.sync && config.sync.enabled) {
      sync.syncNow().catch(() => {});
    }
  };
  registerIpc({ win: () => win, broadcast, notify });
  createWindow();
  startTimers();

  // 启动后：题单过期则静默抓取（未配置主页则不抓，交由界面提示）
  const config = store.get('config') || {};
  const lists = store.get('lists');
  const stale = lists && lists.updatedAt
    ? (Date.now() - new Date(lists.updatedAt).getTime()) > (config.fetch?.staleHours || 12) * 3600 * 1000
    : true;
  if (stale && (config.userSlug || leetcode.parseSlug(config.profileUrl || ''))) runFetch('启动时题单过期');
  if (poolStale()) runPoolFetch('启动时题目池过期');
  // 启动时同步一次
  if (config.sync && config.sync.enabled) sync.syncNow({ report: () => {} });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 供 ipc.js 使用
module.exports = { broadcast, runFetch, runPoolFetch };
