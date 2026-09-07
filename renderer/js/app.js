'use strict';
/* app.js — 路由与全局状态 */
(function () {
  const routes = {
    today: { title: '今日计划', page: window.PageToday },
    calendar: { title: '月历排布', page: window.PageCalendar },
    lists: { title: '题单管理', page: window.PageLists },
    history: { title: '记忆库', page: window.PageHistory },
    bawen: { title: '八股文', page: window.PageBawen },
    stats: { title: '统计', page: window.PageStats },
    timer: { title: '专注计时', page: window.PageTimer },
    settings: { title: '设置', page: window.PageSettings },
  };

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, queryStr] = h.split('?');
    const params = {};
    if (queryStr) {
      for (const kv of queryStr.split('&')) {
        const [k, v] = kv.split('=');
        if (k && v) params[decodeURIComponent(k)] = decodeURIComponent(v);
      }
    }
    return { name: routes[name] ? name : 'today', params };
  }

  async function route() {
    const { name, params } = parseHash();
    const container = document.getElementById('content');
    document.querySelectorAll('.nav-item').forEach(a => {
      a.classList.toggle('active', a.dataset.route === name);
    });
    try {
      await routes[name].page.render(container, params);
    } catch (e) {
      console.error(e);
      container.innerHTML = `<div class="empty">页面加载失败：${esc(e.message)}</div>`;
    }
  }

  window.addEventListener('hashchange', route);

  // 全局状态条
  function initStatus() {
    const syncDot = document.getElementById('syncDot');
    const syncText = document.getElementById('syncText');
    const fetchDot = document.getElementById('fetchDot');
    const fetchText = document.getElementById('fetchText');

    window.lcAPI.getConfig().then(cfg => {
      const s = cfg.sync || {};
      if (!s.enabled) { syncDot.classList.remove('on', 'busy'); syncText.textContent = '同步未启用'; }
      else if (s.server && s.username) { syncDot.classList.add('on'); syncText.textContent = '同步已启用'; }
      else { syncDot.classList.remove('on'); syncText.textContent = '同步配置不完整'; }
      if (cfg.lastFetchAt) fetchText.textContent = '题单更新于 ' + fmtDateShort(cfg.lastFetchAt);
    }).catch(() => {});

    window.lcAPI.onSyncStatus(d => {
      if (d.running) { syncDot.classList.add('busy'); syncText.textContent = '同步中…'; return; }
      syncDot.classList.remove('busy');
      if (d.ok) { syncDot.classList.add('on'); syncText.textContent = `已同步 ${d.pulled}拉/${d.pushed}推 ${fmtTs(new Date().toISOString()).slice(11)}`; }
      else if (d.error) { syncDot.classList.remove('on'); syncText.textContent = '同步失败：' + d.error; }
    });

    window.lcAPI.onFetchStatus(d => {
      if (d.running) { fetchDot.classList.add('busy'); fetchText.textContent = d.step || '抓取中…'; }
      else {
        fetchDot.classList.remove('busy'); fetchDot.classList.add('on'); fetchText.textContent = '题单已更新 ' + fmtTs(new Date().toISOString()).slice(11, 16);
        // 抓取完成后刷新当前页面（今日计划可能因此重新生成）
        APP.metaCache.invalidate();
        route();
      }
    });
  }

  let currentTheme = 'dark';
  function initTheme() {
    window.lcAPI.getConfig().then(cfg => {
      currentTheme = (cfg.ui && cfg.ui.theme) || 'dark';
      APP.applyTheme(currentTheme);
      // 跟随系统时，监听系统明暗切换
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          if (currentTheme === 'auto') APP.applyTheme('auto');
        });
      }
    }).catch(() => {});
  }
  window.APP.setTheme = function (theme) {
    currentTheme = theme;
    APP.applyTheme(theme);
  };

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initStatus();
    if (!location.hash) location.hash = '#/today';
    route();
  });
})();
