'use strict';
/* stats.js — 统计页 */
window.PageStats = {
  async render(container) {
    const stats = await window.lcAPI.getStats();
    const sessions = await window.lcAPI.getSessions();

    container.innerHTML = `
      <div class="page-title">统计</div>
      <div class="page-sub">累计数据来自记忆库与每日计划</div>

      <div class="stat-grid">
        <div class="stat-card accent"><div class="v">${stats.total}</div><div class="l">记忆库总题数</div></div>
        <div class="stat-card green"><div class="v">${stats.doneOnce}</div><div class="l">完成过的题目</div></div>
        <div class="stat-card"><div class="v">${stats.totalDone}</div><div class="l">累计完成次数</div></div>
        <div class="stat-card"><div class="v">${stats.totalScheduled}</div><div class="l">累计排期次数</div></div>
        <div class="stat-card orange"><div class="v">${stats.streak}</div><div class="l">连续刷题天数</div></div>
        <div class="stat-card purple"><div class="v">${stats.mastered}</div><div class="l">已掌握题目</div></div>
        <div class="stat-card"><div class="v">${stats.todayDone}<span style="font-size:14px">/${stats.todayTotal}</span></div><div class="l">今日进度${stats.todayRest ? '（休息日）' : ''}</div></div>
        <div class="stat-card accent"><div class="v">${stats.todayFocusMin}</div><div class="l">今日专注分钟</div></div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>近 30 天完成数</h3>
          <div class="chart-wrap"><canvas id="barChart" height="180"></canvas></div>
        </div>
        <div class="card">
          <h3>知识点完成分布（TOP 12）</h3>
          <div id="tagDist">
            ${stats.tagTop.length ? stats.tagTop.map(t => `
              <div class="bar-row">
                <span class="bar-label" title="${esc(t.tag)}">${esc(t.tag)}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, t.count / stats.tagTop[0].count * 100)}%"></div></div>
                <span class="bar-val">${t.count}</span>
              </div>`).join('') : '<div class="empty">完成题目后这里会出现知识点分布</div>'}
          </div>
        </div>
      </div>

      <div class="card">
        <h3>最近专注记录 <span class="muted" style="font-weight:400">（最近 10 条）</span></h3>
        ${sessions.length ? `<table class="tbl mini-table">
          <thead><tr><th>开始时间</th><th>时长</th><th>标签</th><th>状态</th></tr></thead>
          <tbody>${sessions.slice(-10).reverse().map(s => `
            <tr>
              <td>${fmtTs(s.startTs)}</td>
              <td>${s.durationMin} 分钟</td>
              <td>${esc(s.tag || '—')}</td>
              <td>${s.finished ? '<span style="color:var(--green)">✔ 完成</span>' : '<span class="muted">中断</span>'}</td>
            </tr>`).join('')}</tbody></table>`
          : '<div class="empty">还没有专注记录，去「专注计时」刷一题吧 ⏱️</div>'}
      </div>
    `;

    this.drawBar(stats.last30);
  },

  drawBar(last30) {
    const canvas = document.getElementById('barChart');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 600, H = 180;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const max = Math.max(1, ...last30.map(d => d.done));
    const padL = 6, padB = 22, padT = 8;
    const bw = (W - padL) / last30.length;
    const today = todayStr();
    last30.forEach((d, i) => {
      const x = padL + i * bw + bw * 0.18;
      const w = bw * 0.64;
      const h = (d.done / max) * (H - padT - padB);
      const y = H - padB - h;
      const isToday = d.date === today;
      const isWeekend = [0, 6].includes(new Date(d.date + 'T00:00:00').getDay());
      ctx.fillStyle = isToday ? '#6ee7b7' : (d.done > 0 ? '#4f8cff' : (isWeekend ? '#232f50' : '#1b2440'));
      ctx.fillRect(x, y, w, h);
      if (d.done > 0 && (i % 2 === 0 || d.done >= Math.ceil(max / 2))) {
        ctx.fillStyle = '#93a0bd';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(d.done, x + w / 2, y - 3);
      }
      if (i % 5 === 0 || isToday) {
        ctx.fillStyle = isToday ? '#6ee7b7' : '#5d6a8a';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(d.date.slice(5), x + w / 2, H - 7);
      }
    });
    ctx.strokeStyle = '#232f50';
    ctx.beginPath();
    ctx.moveTo(0, H - padB + 4); ctx.lineTo(W, H - padB + 4);
    ctx.stroke();
  },
};
