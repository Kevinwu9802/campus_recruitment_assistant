'use strict';
/**
 * ipc.js — 渲染进程 ⇄ 主进程通信
 */
const { ipcMain, shell, app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const leetcode = require('./leetcode');
const scheduler = require('./scheduler');
const sync = require('./sync');
const meta = require('./meta');
const kaoyan = require('./kaoyan');

let ctx = null;

function registerIpc({ win, broadcast, notify }) {
  ctx = { win, broadcast, notify };

  // ---------- 通用 ----------
  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: store.getDataDir(),
  }));

  ipcMain.handle('openExternal', (e, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(String(url));
    return true;
  });

  ipcMain.handle('app:notify', (e, title, body) => {
    const { Notification } = require('electron');
    try {
      if (Notification.isSupported()) new Notification({ title: String(title), body: String(body) }).show();
    } catch (err) { console.error(err); }
    return true;
  });

  // ---------- LeetCode 抓取 ----------
  ipcMain.handle('leetcode:parseSlug', (e, input) => leetcode.parseSlug(input));

  ipcMain.handle('profile:fetch', async (e, url) => {
    const slug = leetcode.parseSlug(url || '');
    if (!slug) throw new Error('无法从链接解析 userSlug');
    const profile = await leetcode.getUserProfile(slug);
    const config = store.get('config') || {};
    config.profileUrl = url;
    config.userSlug = slug;
    store.set('config', config);
    return profile;
  });

  ipcMain.handle('lists:fetchAll', () => {
    const { runFetch } = require('./main'); // 惰性 require，避免循环依赖
    return runFetch('手动抓取');
  });

  ipcMain.handle('lists:get', () => {
    const lists = store.get('lists') || { lists: [] };
    const config = store.get('config') || {};
    return {
      lists: lists.lists || [],
      updatedAt: lists.updatedAt,
      lastFetchAt: config.lastFetchAt || null,
      enabled: config.listEnabled || {},
      profileUrl: config.profileUrl || '',
      userSlug: config.userSlug || '',
    };
  });

  ipcMain.handle('lists:toggle', (e, slug, enabled) => {
    const config = store.get('config') || {};
    config.listEnabled = Object.assign({}, config.listEnabled, { [slug]: !!enabled });
    store.set('config', config);
    return true;
  });

  ipcMain.handle('lists:remove', (e, slug) => {
    const lists = store.get('lists') || { lists: [] };
    lists.lists = (lists.lists || []).filter(l => l.slug !== slug);
    store.set('lists', lists);
    return true;
  });

  // ---------- 每日计划 ----------
  ipcMain.handle('plan:get', (e, dateStr) => scheduler.getPlan(dateStr));

  ipcMain.handle('plan:regenerate', (e, dateStr) => scheduler.regeneratePlan(dateStr));

  ipcMain.handle('plan:setStatus', (e, dateStr, qid, status) => scheduler.setProblemStatus(dateStr, qid, status));

  ipcMain.handle('plan:setAll', (e, dateStr, status) => scheduler.setAllStatus(dateStr, status));

  ipcMain.handle('plan:setRest', (e, dateStr, rest) => scheduler.setRest(dateStr, rest));

  // ---------- 记忆库 ----------
  ipcMain.handle('history:get', () => {
    const h = store.get('history') || { questions: {} };
    return Object.values(h.questions).sort((a, b) => {
      const d = (b.timesScheduled || 0) - (a.timesScheduled || 0);
      if (d !== 0) return d;
      return String(a.frontendId).localeCompare(String(b.frontendId), 'en', { numeric: true });
    });
  });

  ipcMain.handle('history:updateMeta', (e, qid, patch) => scheduler.updateHistoryMeta(qid, patch));

  ipcMain.handle('history:delete', (e, qid) => {
    const history = store.get('history') || { questions: {} };
    delete history.questions[String(qid)];
    history.updatedAt = new Date().toISOString();
    store.set('history', history);
    return true;
  });

  // ---------- 统计 ----------
  ipcMain.handle('stats:get', () => scheduler.getStats());

  // ---------- 计时记录 ----------
  ipcMain.handle('sessions:get', () => (store.get('sessions') || { sessions: [] }).sessions);

  ipcMain.handle('sessions:add', (e, s) => {
    const f = store.get('sessions') || { sessions: [] };
    f.sessions.push(Object.assign({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 8) }, s));
    if (f.sessions.length > 2000) f.sessions = f.sessions.slice(-2000);
    store.set('sessions', f);
    return f.sessions.length;
  });

  ipcMain.handle('sessions:clear', () => {
    store.set('sessions', { sessions: [] });
    return true;
  });

  // ---------- 八股文 ----------
  ipcMain.handle('kaoyan:pickFiles', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [
      { name: '八股文件', extensions: ['pdf', 'docx', 'txt', 'md'] },
      { name: '所有文件', extensions: ['*'] },
    ] });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('kaoyan:addSourceFile', async (e, filePath) => {
    try { return await kaoyan.addSourceFile(filePath); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('kaoyan:addSourceUrl', async (e, url, opts) => {
    try {
      return await kaoyan.addSourceUrl(url, Object.assign({}, opts || {}, {
        onProgress: (msg) => { if (ctx && ctx.broadcast) ctx.broadcast('kaoyanProgress', { msg }); },
      }));
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('kaoyan:reparseSource', async (e, id) => {
    try { return await kaoyan.reparseSource(id); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('kaoyan:previewSourceFile', async (e, filePath, opts) => {
    try { return await kaoyan.previewSource(filePath, 'file', opts || {}); }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('kaoyan:previewSourceUrl', async (e, url, opts) => {
    try {
      return await kaoyan.previewSource(url, 'url', Object.assign({}, opts || {}, {
        onProgress: (msg) => { if (ctx && ctx.broadcast) ctx.broadcast('kaoyanProgress', { msg }); },
      }));
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('kaoyan:commitPending', (e, token, acceptedIdx) => kaoyan.commitPending(token, acceptedIdx));
  ipcMain.handle('kaoyan:discardPending', (e, token) => kaoyan.discardPending(token));
  ipcMain.handle('kaoyan:previewReclean', async (e, sourceId) => {
    try { return await kaoyan.previewReclean(sourceId); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('kaoyan:removeSource', (e, id) => kaoyan.removeSource(id));

  ipcMain.handle('kaoyan:listSources', () => kaoyan.listSources());

  ipcMain.handle('kaoyan:listCards', (e, filter) => kaoyan.listCards(filter || {}));

  ipcMain.handle('kaoyan:getCard', (e, id) => kaoyan.getCard(id));

  ipcMain.handle('kaoyan:submitAnswer', async (e, cardId, userAns) => kaoyan.submitAnswer(cardId, userAns));

  ipcMain.handle('kaoyan:viewCard', (e, cardId) => kaoyan.viewCard(cardId));

  ipcMain.handle('kaoyan:setCardStatus', (e, cardId, status) => kaoyan.setCardStatus(cardId, status));

  ipcMain.handle('kaoyan:progress', () => kaoyan.progress());

  // ---------- LLM 评分 ----------
  ipcMain.handle('llm:getKey', () => meta.getApiKey());
  ipcMain.handle('llm:setKey', (e, key) => { meta.saveApiKey(key || ''); return true; });
  ipcMain.handle('llm:test', (e, cfg) => {
    const full = Object.assign({}, cfg || {}, { apiKey: meta.getApiKey() || (cfg && cfg.apiKey) });
    return require('./llm').testConnection(full);
  });

  // ---------- 配置 ----------
  ipcMain.handle('config:get', () => store.get('config') || store.defaultConfig());

  ipcMain.handle('config:save', (e, patch) => {
    const old = store.get('config') || store.defaultConfig();
    const next = Object.assign({}, old, patch);
    store.set('config', next);
    return next;
  });

  ipcMain.handle('config:monthDefault', (e, monthKey) => store.getMonthPlanDefault(monthKey));

  // ---------- 同步 ----------
  ipcMain.handle('sync:test', (e, cfg) => sync.testConnection(cfg));
  ipcMain.handle('sync:now', () => sync.syncNow({
    report: m => { if (ctx && ctx.broadcast) ctx.broadcast('syncStatus', { running: true, msg: m }); },
  }).then(r => { if (ctx && ctx.broadcast) ctx.broadcast('syncStatus', { running: false, ...r }); return r; }));

  // ---------- 数据 ----------
  ipcMain.handle('data:export', () => JSON.stringify(store.exportAll(), null, 1));

  ipcMain.handle('data:import', (e, jsonStr) => {
    const bundle = JSON.parse(jsonStr);
    return store.importAll(bundle);
  });

  ipcMain.handle('data:setDir', (e, dir) => {
    if (!dir || typeof dir !== 'string' || !dir.trim()) throw new Error('目录无效');
    const abs = path.resolve(dir.trim());
    const oldDir = store.getDataDir();
    // 迁移现有数据文件到新目录
    if (oldDir && oldDir !== abs) {
      fs.mkdirSync(abs, { recursive: true });
      for (const key of Object.keys(store.FILES)) {
        const src = path.join(oldDir, store.FILES[key]);
        try {
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(abs, store.FILES[key]));
        } catch (e) { /* 忽略单个文件失败 */ }
      }
    }
    meta.saveDataDir(abs);
    store.setDataDir(abs);
    return abs;
  });

  ipcMain.handle('data:getDir', () => store.getDataDir());
}

module.exports = { registerIpc };
