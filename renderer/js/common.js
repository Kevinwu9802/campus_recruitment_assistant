'use strict';
/* common.js — 全局工具函数 */
window.APP = window.APP || {};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 主题解析：dark/light/auto(auto 按系统 prefers-color-scheme) */
APP.applyTheme = function (theme) {
  let resolved = theme || 'dark';
  if (resolved === 'auto') {
    resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', resolved);
  return resolved;
};

function fmtDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() { return fmtDate(new Date()); }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }

function weekdayCn(dateStr) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(dateStr + 'T00:00:00').getDay()];
}

function fmtTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
}

const DIFF_CN = { EASY: '简单', MEDIUM: '中等', HARD: '困难' };

function toast(msg, type = 'info', ms = 3200) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'err' : type === 'success' ? 'ok' : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms - 300);
  setTimeout(() => el.remove(), ms);
}

function openModal({ title, body, okText = '确定', cancelText = '取消', danger = false, onOk, width }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" ${width ? `style="width:${width}"` : ''}>
        <h3>${esc(title)}</h3>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          ${cancelText ? `<button class="btn-ghost" data-act="cancel">${esc(cancelText)}</button>` : ''}
          <button class="${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(okText)}</button>
        </div>
      </div>`;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close(null);
    });
    overlay.querySelector('[data-act=cancel]')?.addEventListener('click', () => close(null));
    overlay.querySelector('[data-act=ok]')?.addEventListener('click', () => {
      const v = onOk ? onOk(overlay.querySelector('.modal-body')) : true;
      if (v !== false) close(v === true ? 'ok' : v);
    });
    root.appendChild(overlay);
    function close(val) { overlay.remove(); resolve(val); }
  });
}

async function confirmDlg(title, text, okText = '确定') {
  return !!(await openModal({ title, body: `<p style="line-height:1.7;color:var(--text2)">${text}</p>`, okText, danger: true }));
}

function openProblem(titleSlug) {
  if (window.lcAPI) window.lcAPI.openExternal(`https://leetcode.cn/problems/${titleSlug}/`);
}

/* 全局题目元数据缓存（由今日/日历等页面共享，懒加载） */
APP.metaCache = {
  lists: null,
  history: null,
  config: null,
  async listsData() {
    if (!this.lists) this.lists = await window.lcAPI.getLists();
    return this.lists;
  },
  async historyData() {
    if (!this.history) this.history = await window.lcAPI.getHistory();
    return this.history;
  },
  async configData() {
    if (!this.config) this.config = await window.lcAPI.getConfig();
    return this.config;
  },
  invalidate() { this.lists = null; this.history = null; this.config = null; },
};

/** 生成单个题目的行 HTML（今日计划 / 日历详情共用）。readonly 时禁用状态按钮 */
function problemRowHtml(item, listBySlug, historyByQid, readonly = false) {
  const h = historyByQid ? historyByQid[item.qid] : null;
  const listName = listBySlug && listBySlug[item.listSlug] ? listBySlug[item.listSlug].name : (item.listSlug || '');
  const titleSlug = item.titleSlug || (h && h.titleSlug) || '';
  const title = item.translatedTitle || (h && h.translatedTitle) || `${item.qid}`;
  const en = item.title || (h && h.title) || '';
  const tags = (item.tags && item.tags.length ? item.tags : (h && h.tags || []));
  const diff = item.difficulty || (h && h.difficulty) || '';
  const cls = item.status === 'done' ? 'done' : item.status === 'doing' ? 'doing' : '';
  const dis = readonly ? ' disabled' : '';
  return `
  <div class="qitem ${cls}" data-qid="${esc(item.qid)}">
    <a class="qid" style="${titleSlug ? '' : 'pointer-events:none;color:var(--text3)'}" href="${titleSlug ? 'https://leetcode.cn/problems/' + esc(titleSlug) + '/' : '#'}" title="点击跳转到题目">${esc(item.qid)}</a>
    <div class="qtitle">
      ${esc(title)}
      ${en && en !== title ? `<span class="en">${esc(en)}</span>` : ''}
    </div>
    <div class="meta">
      ${item.kind === 'new' ? '<span class="chip kind-new">新题</span>' : '<span class="chip kind-review">复习</span>'}
      ${item.paidOnly ? '<span class="chip" style="color:var(--orange);border-color:rgba(251,191,36,.5)">会员</span>' : ''}
      ${diff ? `<span class="chip diff-${diff}">${DIFF_CN[diff] || diff}</span>` : ''}
      ${tags.slice(0, 3).map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}
      ${listName ? `<span class="chip src">📚${esc(listName)}</span>` : ''}
      <span class="status-btns" data-qid="${esc(item.qid)}">
        <button class="btn-sm st-todo ${item.status === 'todo' ? 'on-todo' : ''}" data-st="todo"${dis}>未开始</button>
        <button class="btn-sm st-doing ${item.status === 'doing' ? 'on-doing' : ''}" data-st="doing"${dis}>进行中</button>
        <button class="btn-sm st-done ${item.status === 'done' ? 'on-done' : ''}" data-st="done"${dis}>已完成</button>
      </span>
    </div>
  </div>`;
}

/** 全局委托：LeetCode 外链一律交给系统浏览器（避免被 CSP/窗口拦截） */
document.addEventListener('click', function (e) {
  const a = e.target.closest && e.target.closest('a[href^="https://leetcode.cn"]');
  if (a) {
    e.preventDefault();
    if (window.lcAPI) window.lcAPI.openExternal(a.href);
  }
});

/** 将列表数组转 slug->list 映射 */
function listIndex(lists) { return (lists || []).reduce((m, l) => { m[l.slug] = l; return m; }, {}); }
function historyIndex(hs) { return (hs || []).reduce((m, h) => { m[h.frontendId] = h; return m; }, {}); }
