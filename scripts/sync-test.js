'use strict';
/* 同步逻辑单元测试：用桩 WebDAV 服务验证“远端空目录→建目录→上传→再同步幂等” */
const os = require('os');
const path = require('path');
const fs = require('fs');

const store = require('../main/store');
const sync = require('../main/sync');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-sync-test-'));
store.init(path.join(tmpData, 'data'));

// 造一点数据，确保各文件存在
const cfg = store.get('config');
cfg.sync = { enabled: true, server: 'https://dav.example.test/dav', username: 'u@example.test', password: 'app-pass', remotePath: '/D', intervalMin: 30 };
store.set('config', cfg);
store.set('lists', { updatedAt: new Date().toISOString(), lists: [{ slug: 'x', name: 'X', questions: [{ questionFrontendId: '1', titleSlug: 'a' }] }] });
store.set('history', { updatedAt: new Date().toISOString(), questions: {} });
store.set('plan', {});
store.set('sessions', { sessions: [] });
store.flush(); // 确保 5 个数据文件全部落盘

// 桩 WebDAV：模拟 GET/PUT/MKCOL
const remoteFiles = new Map(); // file -> lastModifiedTs
function FakeResponse(status, body, lastModified) {
  this.status = status;
  this._body = body;
  this._lastModified = lastModified;
  this.headers = { get: (k) => (k.toLowerCase() === 'last-modified' && this._lastModified ? new Date(this._lastModified).toUTCString() : null) };
  Object.defineProperty(this, 'ok', { get: () => this.status >= 200 && this.status < 300 });
  this.arrayBuffer = async () => Buffer.from(this._body || '').buffer.slice(0);
  this.text = async () => String(this._body || '');
}

let uploadedCount = 0;
global.fetch = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  const u = String(url);
  const file = u.split('/').pop();
  if (method === 'MKCOL') return new FakeResponse(201);
  if (method === 'PUT') {
    uploadedCount++;
    remoteFiles.set(file, Date.now());
    return new FakeResponse(201);
  }
  if (method === 'GET') {
    if (remoteFiles.has(file)) return new FakeResponse(200, '{"x":1}', remoteFiles.get(file));
    return new FakeResponse(404);
  }
  return new FakeResponse(405);
};

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); }

(async () => {
  // 1) 首次同步：远端空 → 应上传全部 5 个文件
  let r = await sync.syncNow();
  check('首次同步 ok', r.ok);
  check('推送了全部文件', r.pushed === 5, `pushed=${r.pushed} uploaded=${uploadedCount}`);
  check('无拉取', r.pulled === 0, `pulled=${r.pulled}`);
  check('远端已有数据', remoteFiles.has('config') && remoteFiles.has('lists') && remoteFiles.size === 5, [...remoteFiles.keys()].join(','));

  // 2) 再次同步：均已一致 → 幂等，无变化
  const before = uploadedCount;
  r = await sync.syncNow();
  check('二次同步 ok 且幂等', r.ok && r.pushed === 0 && uploadedCount === before, `pushed=${r.pushed} added=${uploadedCount - before}`);

  // 3) 关闭启用 → 未启用同步
  const c = store.get('config'); c.sync.enabled = false; store.set('config', c);
  r = await sync.syncNow();
  check('未启用同步守卫', !r.ok && r.error === '未启用同步', r.error);

  // 4) 缺用户名 → 配置不完整
  c.sync.enabled = true; c.sync.username = ''; store.set('config', c);
  r = await sync.syncNow();
  check('缺用户名守卫', !r.ok && r.error === '同步配置不完整', r.error);

  console.log(`\n${fail === 0 ? '✅ 同步逻辑全部通过' : '❌ ' + fail + ' 项失败'}（${pass} 通过）`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常', e); process.exit(1); });
