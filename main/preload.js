'use strict';
/**
 * preload.js — 通过 contextBridge 安全暴露主进程能力
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lcAPI', {
  // 通用
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  notify: (title, body) => ipcRenderer.invoke('app:notify', title, body),

  // LeetCode
  parseSlug: (input) => ipcRenderer.invoke('leetcode:parseSlug', input),
  fetchProfile: (url) => ipcRenderer.invoke('profile:fetch', url),
  fetchAllLists: () => ipcRenderer.invoke('lists:fetchAll'),
  getLists: () => ipcRenderer.invoke('lists:get'),
  toggleList: (slug, enabled) => ipcRenderer.invoke('lists:toggle', slug, enabled),
  removeList: (slug) => ipcRenderer.invoke('lists:remove', slug),

  // 计划
  getPlan: (dateStr) => ipcRenderer.invoke('plan:get', dateStr),
  regeneratePlan: (dateStr) => ipcRenderer.invoke('plan:regenerate', dateStr),
  setStatus: (dateStr, qid, status) => ipcRenderer.invoke('plan:setStatus', dateStr, qid, status),
  setAllStatus: (dateStr, status) => ipcRenderer.invoke('plan:setAll', dateStr, status),
  setRest: (dateStr, rest) => ipcRenderer.invoke('plan:setRest', dateStr, rest),

  // 记忆库
  getHistory: () => ipcRenderer.invoke('history:get'),
  updateHistoryMeta: (qid, patch) => ipcRenderer.invoke('history:updateMeta', qid, patch),
  deleteHistory: (qid) => ipcRenderer.invoke('history:delete', qid),

  // 统计
  getStats: () => ipcRenderer.invoke('stats:get'),

  // 计时
  getSessions: () => ipcRenderer.invoke('sessions:get'),
  addSession: (s) => ipcRenderer.invoke('sessions:add', s),
  clearSessions: () => ipcRenderer.invoke('sessions:clear'),

  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  monthDefault: (monthKey) => ipcRenderer.invoke('config:monthDefault', monthKey),

  // 同步
  testSync: (cfg) => ipcRenderer.invoke('sync:test', cfg),
  syncNow: () => ipcRenderer.invoke('sync:now'),

  // 数据
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: (jsonStr) => ipcRenderer.invoke('data:import', jsonStr),
  setDataDir: (dir) => ipcRenderer.invoke('data:setDir', dir),
  getDataDir: () => ipcRenderer.invoke('data:getDir'),

  // 事件（返回取消订阅函数）
  onFetchStatus: (cb) => {
    const fn = (e, d) => cb(d);
    ipcRenderer.on('fetchStatus', fn);
    return () => ipcRenderer.removeListener('fetchStatus', fn);
  },
  onSyncStatus: (cb) => {
    const fn = (e, d) => cb(d);
    ipcRenderer.on('syncStatus', fn);
    return () => ipcRenderer.removeListener('syncStatus', fn);
  },
});
