'use strict';
/* calendar.js — 月历排布页 */
window.PageCalendar = {
  currentMonth: todayStr().slice(0, 7),

  async render(container, params) {
    if (params && params.month) this.currentMonth = params.month.slice(0, 7);
    const month = this.currentMonth;
    const planFile = {}; // 逐日拉取成本高，改由主进程一次返回整月？
    // 简化：逐日获取整月计划（<=31 次 IPC，可接受）
    const [y, m] = month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const firstWeekday = new Date(y, m - 1, 1).getDay();
    const today = todayStr();
    const config = await APP.metaCache.configData();

    const rows = [];
    const daysData = [];
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const plan = await window.lcAPI.getPlan(ds);
      const done = plan.items.filter(i => i.status === 'done').length;
      daysData.push({ ds, plan, done });
    }

    let head = '';
    ['周日', '周一', '周二', '周三', '周四', '周五', '周六'].forEach(w => head += `<div>${w}</div>`);
    let cells = '';
    for (let i = 0; i < firstWeekday; i++) cells += '<div class="cal-cell other-month"></div>';
    for (const { ds, plan, done } of daysData) {
      const isToday = ds === today;
      const isRest = plan.rest;
      const newTotal = plan.newCount, revTotal = plan.reviewCount;
      const beforeStart = plan.notBeforeStart;
      cells += `
        <div class="cal-cell ${isRest ? 'rest' : ''} ${isToday ? 'today' : ''}" data-date="${ds}">
          <span class="d">${Number(ds.slice(8))}</span>
          ${isRest ? '<span class="rest-badge">休</span>' : ''}
          ${beforeStart ? '' : `<button class="btn-sm menu-btn" data-date="${ds}" data-act="rest">${isRest ? '恢复' : '休息'}</button>`}
          <div class="cnt">
            ${beforeStart ? `<span class="muted">未开始</span>` :
              (isRest ? '' : `<span class="n">新${newTotal}</span> · <span class="r">复${revTotal}</span><br>`) +
              (plan.items.length ? `<span class="ok">✔ ${done}/${plan.items.length}</span>` : '')}
          </div>
        </div>`;
    }
    const totalPlanDays = daysData.filter(d => !d.plan.rest && d.plan.items.length > 0 && !d.plan.notBeforeStart).length;
    const doneDays = daysData.filter(d => d.plan.items.length > 0 && d.done === d.plan.items.length).length;

    container.innerHTML = `
      <div class="row spread" style="margin-bottom:6px">
        <div>
          <div class="page-title">月历排布</div>
          <div class="page-sub">点击日期查看该日计划 · 灰色=休息日 · 右上角按钮切换休息状态 · 「未开始」为计划开始日期之前</div>
        </div>
        <div class="row">
          <button class="btn-sm" data-act="prev">‹ 上月</button>
          <b style="font-size:16px;min-width:90px;text-align:center">${y} 年 ${m} 月</b>
          <button class="btn-sm" data-act="next">下月 ›</button>
          <button class="btn-sm" data-act="thisMonth">本月</button>
        </div>
      </div>

      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
        <div class="stat-card"><div class="v">${totalPlanDays}</div><div class="l">本月刷题日</div></div>
        <div class="stat-card green"><div class="v">${doneDays}</div><div class="l">全部完成的日期</div></div>
        <div class="stat-card accent"><div class="v">${daysData.reduce((s, d) => s + d.plan.newCount, 0)}</div><div class="l">本月新题总量</div></div>
        <div class="stat-card purple"><div class="v">${daysData.reduce((s, d) => s + d.plan.reviewCount, 0)}</div><div class="l">本月复习总量</div></div>
      </div>

      <div class="card">
        <div class="cal-head">${head}</div>
        <div class="cal-grid" style="margin-top:6px">${cells}</div>
      </div>
      <div class="muted">📌 当月「新题/复习数量、休息日」等节奏在「设置 → 月份计划」中配置（9/10/11 月有内置冲刺预设）。</div>
    `;

    container.querySelector('[data-act=prev]').onclick = () => location.hash = '#/calendar?month=' + this.shiftMonth(month, -1);
    container.querySelector('[data-act=next]').onclick = () => location.hash = '#/calendar?month=' + this.shiftMonth(month, 1);
    container.querySelector('[data-act=thisMonth]').onclick = () => location.hash = '#/calendar';
    container.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', e => {
        if (e.target.closest('.menu-btn')) return;
        location.hash = '#/today?date=' + cell.dataset.date;
      });
      const mb = cell.querySelector('.menu-btn');
      if (mb) mb.addEventListener('click', async e => {
        e.stopPropagation();
        const ds = mb.dataset.date;
        if (ds < today) {
          toast('日期已过，仅可在当天或未来切换休息状态', 'info');
          return;
        }
        const plan = await window.lcAPI.getPlan(ds);
        const toRest = !plan.rest;
        await window.lcAPI.setRest(ds, toRest);
        toast(toRest ? '已设为休息日' : '已恢复为刷题日', 'success');
        this.render(container, { month }); // setRest 已重建该天计划，重新渲染同步 UI
      });
    });
  },

  shiftMonth(month, n) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },
};
