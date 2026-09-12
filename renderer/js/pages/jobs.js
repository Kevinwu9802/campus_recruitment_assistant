'use strict';
/* jobs.js — 校招求职看板（手动导入语雀导出的 Excel 后分析） */
window.PageJobs = {
  state: { q: '', channel: '', status: '' },

  async render(container) {
    const d = await window.lcAPI.getJobsDashboard();
    const has = d && d.records && d.records.length;

    if (!has) {
      container.innerHTML = `
        <div class="page-title">🎯 校招求职看板</div>
        <div class="page-sub">手动导入语雀导出的 Excel（《校招求职进度表》），工具自动分析投递漏斗、渠道与时间趋势</div>
        <div class="card">
          <h3>📥 导入表格</h3>
          <p class="muted" style="line-height:1.8">支持从语雀导出/下载的 <b>.xlsx / .xls / .csv</b>。自动识别「校招进度明细」表，按“公司名称 / 岗位名称 / 投递渠道 / 投递时间 / 简历状态 / 笔试结果 / 面试结果 / Offer状态 / 薪资 / 地点”等列做分析。</p>
          <div class="row" style="margin-top:10px">
            <button class="btn-primary" data-act="import">📥 选择 Excel 文件导入</button>
          </div>
        </div>`;
      this.bind(container);
      return;
    }

    const s = d.stat;
    const total = s.applied || 1;
    const pct = (n) => ((n / total) * 100).toFixed(1) + '%';

    container.innerHTML = `
      <div class="row spread" style="margin-bottom:6px">
        <div>
          <div class="page-title">🎯 校招求职看板</div>
          <div class="page-sub">数据来源：${esc(d.source || '—')} · 工作表「${esc(d.sheetName || '')}」 · ${esc(d.records.length)} 条记录${d.updatedAt ? ' · 更新于 ' + fmtTs(d.updatedAt) : ''}</div>
        </div>
        <div class="row">
          <button class="btn-primary" data-act="import">📥 重新导入</button>
          <button class="btn-sm btn-danger" data-act="clear">清空数据</button>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card accent"><div class="v">${s.applied}</div><div class="l">总投递</div></div>
        <div class="stat-card"><div class="v">${s.resumePass}</div><div class="l">简历通过 · ${pct(s.resumePass)}</div></div>
        <div class="stat-card"><div class="v">${s.examPass}</div><div class="l">笔试通过 · ${pct(s.examPass)}</div></div>
        <div class="stat-card orange"><div class="v">${s.interviewPass}</div><div class="l">面试通过 · ${pct(s.interviewPass)}</div></div>
        <div class="stat-card green"><div class="v">${s.offer}</div><div class="l">Offer · ${pct(s.offer)}</div></div>
        <div class="stat-card"><div class="v" style="color:var(--red)">${s.resumeFail + s.examFail + s.interviewFail}</div><div class="l">挂掉（简历${s.resumeFail}/笔试${s.examFail}/面试${s.interviewFail}）</div></div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>📉 投递漏斗</h3>
          ${this.funnelHtml(d.funnel, total)}
        </div>
        <div class="card">
          <h3>📈 投递时间趋势 <span class="muted" style="font-weight:400">（按投递日期）</span></h3>
          <div class="chart-wrap"><canvas id="jobsTimeline" height="190"></canvas></div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>🧭 投递渠道分布</h3>
          ${this.barsHtml(d.byChannel)}
        </div>
        <div class="card">
          <h3>📋 简历状态分布</h3>
          ${this.barsHtml(d.byResumeStatus)}
        </div>
      </div>

      <div class="card">
        <h3>🏢 投递公司 TOP15</h3>
        ${this.barsHtml(d.byCompany)}
      </div>

      <div class="card">
        <div class="row spread" style="margin-bottom:12px">
          <h3 style="margin:0">📄 投递明细</h3>
          <div class="row">
            <input type="text" id="jq" placeholder="搜索公司 / 岗位 / 地点 / 备注…" value="${esc(this.state.q)}" style="width:240px" />
            <select id="jch"><option value="">全部渠道</option>${d.byChannel.map(x => `<option ${this.state.channel === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
            <select id="jst"><option value="">全部状态</option>${d.byResumeStatus.map(x => `<option ${this.state.status === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          </div>
        </div>
        <div id="jobsTable">${this.tableHtml(d.records)}</div>
      </div>
    `;

    this.bind(container);
    this.drawTimeline(d.timeline);
  },

  funnelHtml(funnel, total) {
    return funnel.map((f, i) => {
      const w = Math.max(3, (f.count / total) * 100);
      const prev = i === 0 ? null : funnel[i - 1].count;
      const rate = prev ? `转换率 ${prev ? ((f.count / prev) * 100).toFixed(0) + '%' : ''}` : '';
      const color = i === 0 ? 'var(--accent)' : i === funnel.length - 1 ? 'var(--green)' : 'var(--purple)';
      return `<div class="bar-row">
        <span class="bar-label">${esc(f.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>
        <span class="bar-val">${f.count}</span>
        <span class="muted" style="width:90px;font-size:11px">${esc(rate)}</span>
      </div>`;
    }).join('');
  },

  barsHtml(items) {
    if (!items || !items.length) return '<div class="empty">暂无数据</div>';
    const max = Math.max(...items.map(i => i.count));
    return items.map(t => `
      <div class="bar-row">
        <span class="bar-label" title="${esc(t.name)}">${esc(t.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (t.count / max) * 100)}%"></div></div>
        <span class="bar-val">${t.count}</span>
      </div>`).join('');
  },

  tableHtml(records) {
    const { q, channel, status } = this.state;
    let rows = records;
    if (q) { const k = q.toLowerCase(); rows = rows.filter(r => (r.company + r.position + r.location + r.note).toLowerCase().includes(k)); }
    if (channel) rows = rows.filter(r => (r.channel || '未知') === channel);
    if (status) rows = rows.filter(r => (r.resumeStatus || '未标注') === status);

    const chip = (v) => {
      if (!v) return '<span class="muted">—</span>';
      const cls = /通过|接受|入职/.test(v) ? 'color:var(--green);border-color:rgba(16,185,129,.45)'
        : /挂|淘汰|未通过/.test(v) ? 'color:var(--red);border-color:rgba(239,68,68,.45)'
        : 'color:var(--text2)';
      return `<span class="chip" style="${cls}">${esc(v)}</span>`;
    };
    return `<table class="tbl">
      <thead><tr><th>#</th><th>公司</th><th>岗位</th><th>渠道</th><th>投递时间</th><th>简历</th><th>笔试</th><th>面试</th><th>Offer</th><th>薪资</th><th>地点</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td class="muted">${esc(r.no || '')}</td>
          <td><b>${esc(r.company || '')}</b>${r.link ? ` <a class="qid" style="font-size:11px" href="${esc(r.link)}" title="打开投递链接">🔗</a>` : ''}</td>
          <td>${esc(r.position || '').replace(/\s+/g, ' / ')}</td>
          <td class="muted">${esc(r.channel || '')}</td>
          <td class="muted">${esc(r.appliedAt || '')}</td>
          <td>${chip(r.resumeStatus)}</td>
          <td>${chip(r.examResult)}</td>
          <td>${chip(r.interviewResult)}${r.interviewRound ? `<div class="muted" style="font-size:11px">${esc(r.interviewRound)}</div>` : ''}</td>
          <td>${chip(r.offerStatus)}</td>
          <td class="muted">${esc(r.salary || '')}</td>
          <td class="muted">${esc(r.location || '')}</td>
        </tr>`).join('') || '<tr><td colspan="11"><div class="empty">无匹配记录</div></td></tr>'}
      </tbody></table>
      <div class="muted" style="margin-top:8px">共 ${rows.length} 条${rows.length !== records.length ? `（已筛选，总计 ${records.length}）` : ''}</div>`;
  },

  bind(container) {
    const imp = container.querySelector('[data-act=import]');
    if (imp) imp.addEventListener('click', async () => {
      const r = await window.lcAPI.importJobs();
      if (r.canceled) return;
      if (!r.ok) return toast('导入失败：' + r.error, 'error');
      toast(`已导入 ${r.count} 条记录（工作表：${r.sheetName}）`, 'success');
      this.state = { q: '', channel: '', status: '' };
      this.render(container);
    });
    const cl = container.querySelector('[data-act=clear]');
    if (cl) cl.addEventListener('click', async () => {
      if (!(await confirmDlg('清空数据', '将删除已导入的求职进度数据（不可恢复）。确定？', '清空'))) return;
      await window.lcAPI.clearJobs();
      toast('已清空', 'info');
      this.render(container);
    });

    const q = container.querySelector('#jq');
    if (q) q.addEventListener('input', () => {
      this.state.q = q.value;
      this.refreshTable(container);
      if (window.__jt) clearTimeout(window.__jt);
      window.__jt = setTimeout(() => this.refreshTable(container), 250);
    });
    const ch = container.querySelector('#jch');
    if (ch) ch.addEventListener('change', () => { this.state.channel = ch.value; this.refreshTable(container); });
    const st = container.querySelector('#jst');
    if (st) st.addEventListener('change', () => { this.state.status = st.value; this.refreshTable(container); });
  },

  async refreshTable(container) {
    const d = await window.lcAPI.getJobsDashboard();
    const box = container.querySelector('#jobsTable');
    if (box) box.innerHTML = this.tableHtml(d.records || []);
  },

  drawTimeline(timeline) {
    const canvas = document.getElementById('jobsTimeline');
    if (!canvas || !timeline || !timeline.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 520, H = 190;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const max = Math.max(1, ...timeline.map(t => t.count));
    const padL = 6, padB = 26, padT = 12;
    const bw = (W - padL) / timeline.length;
    timeline.forEach((t, i) => {
      const x = padL + i * bw + bw * 0.2, w = Math.max(3, bw * 0.6);
      const h = (t.count / max) * (H - padT - padB);
      const y = H - padB - h;
      ctx.fillStyle = '#4f8cff';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#93a0bd'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(t.count, x + w / 2, y - 3);
      ctx.fillStyle = '#5d6a8a';
      ctx.fillText(t.date.slice(5), x + w / 2, H - 8);
    });
    ctx.strokeStyle = 'rgba(120,140,180,.35)';
    ctx.beginPath(); ctx.moveTo(0, H - padB + 4); ctx.lineTo(W, H - padB + 4); ctx.stroke();
  },
};
