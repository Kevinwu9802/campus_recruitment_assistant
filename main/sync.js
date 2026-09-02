'use strict';
/**
 * sync.js — WebDAV 数据同步（兼容坚果云等）
 *
 * 同步文件：config.json / lists.json / history.json / plan.json / sessions.json
 * 策略（按文件逐一处理，Last-Modified 与本地 mtime 比较）：
 *   - 远端比本地新  → 拉取远端（本地先备份 .conflict-*）
 *   - 本地比远端新  → 推送本地
 *   - 相差极小/相同 → 跳过
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');

const SYNC_FILES = ['config', 'lists', 'history', 'plan', 'sessions'];
const TOLERANCE_MS = 2500; // Last-Modified 只有秒级精度，容差 2.5s

let busy = false;

function authHeader(cfg) {
  const u = (cfg.sync.username || '').trim();
  const p = cfg.sync.password || '';
  if (!u) return null;
  return 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
}

async function dav(method, url, cfg, body) {
  const auth = authHeader(cfg);
  if (!auth) throw new Error('未配置 WebDAV 用户名');
  const headers = { 'user-agent': 'LeetCodeDailyHelper/1.0' };
  if (auth) headers.authorization = auth;
  if (body != null) headers['content-type'] = 'application/octet-stream';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function davUrl(cfg, file) {
  const base = (cfg.sync.server || '').replace(/\/+$/, '');
  const dir = (cfg.sync.remotePath || '/LeetCodeDailyHelper').replace(/\/+$/, '');
  return `${base}${dir}/${file}`;
}

function localMtime(file) {
  try { return fs.statSync(path.join(store.getDataDir(), store.FILES[file])).mtimeMs; }
  catch { return 0; }
}

async function ensureRemoteDir(cfg) {
  const base = (cfg.sync.server || '').replace(/\/+$/, '');
  const dir = (cfg.sync.remotePath || '/LeetCodeDailyHelper').replace(/\/+$/, '');
  let cur = base;
  for (const s of dir.split('/').filter(Boolean)) {
    cur += '/' + s;
    try {
      const r = await dav('MKCOL', cur, cfg);
      if (r.status === 405 || r.status === 301) continue;
    } catch (e) { /* 忽略已存在 */ }
  }
}

async function handleFile(cfg, state, file, report) {
  const url = davUrl(cfg, file);
  const res = await dav('GET', url, cfg);
  if (res.status === 404) {
    // 远端不存在 → 推送本地
    const local = localMtime(file);
    if (local > 0) {
      const buf = fs.readFileSync(path.join(store.getDataDir(), store.FILES[file]));
      const put = await dav('PUT', url, cfg, buf);
      if (put.status >= 200 && put.status < 300) {
        state[file] = { remoteMtime: Date.now(), lastSyncAt: Date.now() };
        return { pushed: 1 };
      }
      report(`${file}: 上传失败 HTTP ${put.status}`);
    }
    return {};
  }
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const remoteMtime = new Date(res.headers.get('last-modified') || 0).getTime();
  const local = localMtime(file);
  const prev = state[file] || { remoteMtime: 0 };

  if (remoteMtime > local + TOLERANCE_MS) {
    // 远端更新 → 拉取
    const buf = Buffer.from(await res.arrayBuffer());
    const localPath = path.join(store.getDataDir(), store.FILES[file]);
    if (local > 0) {
      const bak = localPath + '.conflict-' + Date.now();
      try { fs.copyFileSync(localPath, bak); } catch (e) {}
    }
    fs.writeFileSync(localPath, buf);
    store.set(file, JSON.parse(buf.toString('utf8') || '{}'));
    state[file] = { remoteMtime, lastSyncAt: Date.now() };
    return { pulled: 1 };
  }
  if (local > remoteMtime + TOLERANCE_MS || local > 0 && remoteMtime === 0) {
    // 本地更新（或远端无 Last-Modified 且本地有数据）→ 推送
    const buf = fs.readFileSync(path.join(store.getDataDir(), store.FILES[file]));
    const put = await dav('PUT', url, cfg, buf);
    if (put.status >= 200 && put.status < 300) {
      state[file] = { remoteMtime: Date.now(), lastSyncAt: Date.now() };
      return { pushed: 1 };
    }
    report(`${file}: 上传失败 HTTP ${put.status}`);
    return {};
  }
  // 一致：仅记录远端 mtime
  state[file] = { remoteMtime: Math.max(remoteMtime, local), lastSyncAt: Date.now() };
  return {};
}

/** 执行一次完整同步 */
async function syncNow(opts = {}) {
  if (busy) return { ok: false, error: '同步正在进行中' };
  busy = true;
  const cfg = opts.config || store.get('config') || {};
  const report = opts.report || (() => {});
  try {
    if (!cfg.sync || !cfg.sync.enabled) return { ok: false, error: '未启用同步' };
    if (!cfg.sync.server || !cfg.sync.username) return { ok: false, error: '同步配置不完整' };
    await ensureRemoteDir(cfg);
    const state = store.get('syncState') || {};
    let pulled = 0, pushed = 0, failed = [];
    for (const file of SYNC_FILES) {
      try {
        const r = await handleFile(cfg, state, file, report);
        pulled += r.pulled || 0;
        pushed += r.pushed || 0;
      } catch (e) {
        failed.push(file + ':' + e.message);
        report(file + ' 同步失败: ' + e.message);
      }
    }
    store.set('syncState', state);
    store.flush();
    return { ok: true, pulled, pushed, failed, at: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    busy = false;
  }
}

async function testConnection(input) {
  // 兼容两种传入：完整 config（含 sync）或扁平 {server,username,...}
  const s = (input && input.sync) || input || {};
  const server = (s.server || '').trim();
  const username = (s.username || '').trim();
  const password = s.password || '';
  const remotePath = (s.remotePath || '/LeetCodeDailyHelper').trim();
  if (!server || !username) {
    return { ok: false, error: '配置不完整：请填写「服务器地址」与「用户名」' };
  }
  // 归一化成 dav/ensureRemoteDir 期望的结构
  const cfg = Object.assign({}, input, { sync: { enabled: true, server, username, password, remotePath, intervalMin: s.intervalMin || 30 } });
  try {
    await ensureRemoteDir(cfg);
    const url = davUrl(cfg, '.probe');
    const res = await dav('PUT', url, cfg, Buffer.from('ok'));
    if (res.status >= 200 && res.status < 300) return { ok: true, msg: '连接成功（已可读写远程目录）' };
    if (res.status === 401 || res.status === 403) return { ok: false, error: '认证失败：请检查用户名（坚果云为邮箱）与「应用密码」——注意不是登录密码' };
    if (res.status === 404) return { ok: false, error: '服务器返回 404：请确认服务器地址以 /dav 结尾（如 https://dav.jianguoyun.com/dav）' };
    if (res.status === 405) return { ok: false, error: '服务器不允许该方法（405）：请确认服务器地址正确' };
    return { ok: false, error: 'HTTP ' + res.status + '：请检查服务器地址与网络' };
  } catch (e) {
    return { ok: false, error: '连接异常：' + e.message };
  }
}

module.exports = { syncNow, testConnection, SYNC_FILES };
