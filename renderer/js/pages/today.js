'use strict';
/* today.js — 每日计划页（仅今日可生成/修改，其他日期只读；未来日期不显示题目） */
window.PageToday = {
  currentDate: todayStr(),

  async render(container, params) {
    this.currentDate = (params && params.date) ? params.date : todayStr();
    const date = this.currentDate;
    const today = todayStr();
    const isToday = date === today;
    const isFuture = date > today;
    const [plan, listsData, history, stats, config] = await Promise.all([
      window.lcAPI.getPlan(date),
      APP.metaCache.listsData(),
      window.lcAPI.getHistory(),
      window.lcAPI.getStats(),
      APP.metaCache.configData(),
    ]);
    APP.metaCache.invalidate();

    const readonly = plan.readonly !== false && !isToday; // 非当天一律只读
    const listBy = listIndex(listsData.lists);
    const historyByQid = historyIndex(history); // 供旧卡缺 titleSlug 时兜底

    const done = plan.items.filter(i => i.status === 'done').length;
    const newDone = plan.items.filter(i => i.kind === 'new' && i.status === 'done').length;
    const revDone = plan.items.filter(i => i.kind === 'review' && i.status === 'done').length;
    const newTotal = plan.items.filter(i => i.kind === 'new').length;
    const revTotal = plan.items.filter(i => i.kind === 'review').length;

    // 内容区：按 未开始 / 未来 / 无记录 / 正常 四类
    let content;
    if (plan.notBeforeStart) {
      content = `
        <div class="card">
          <h3>⏳ 计划尚未开始</h3>
          <p class="muted">刷题计划从 <b>${esc(config.scheduleStart || '2026-09-01')}</b> 开始，该日期尚未到开始日，不生成题单。</p>
        </div>`;
    } else if (isFuture) {
      content = `
        <div class="card">
          <h3>📝 ${esc(date)} 当日安排</h3>
          <div class="empty">该日计划将在当天自动生成，暂不预览。</div>
        </div>`;
    } else if (date < today && plan.items.length === 0) {
      content = `
        <div class="card">
          <h3>🗂️ ${esc(date)} 刷题记录</h3>
          <div class="empty">该日没有刷题记录。</div>
        </div>`;
    } else {
      content = `
      <div class="card">
        <div class="row spread">
          <div class="row" style="gap:18px">
            ${plan.rest ? `
              <span style="font-size:15px;font-weight:700">🛌 休息日 · 不安排刷题</span>
            ` : `
              <span>新题 <b class="muted">${newDone}/${newTotal}</b> <span class="chip kind-new" style="margin-left:4px">新题</span></span>
              <span>复习 <b class="muted">${revDone}/${revTotal}</b> <span class="chip kind-review">复习</span></span>
              <span>总进度 <b style="color:var(--green)">${done}/${plan.items.length}</b></span>
            `}
            <span class="muted">⏱️ 今日专注 ${stats.todayFocusMin} 分钟</span>
          </div>
          ${
            isToday ? `
            <div class="row">
              <button class="btn-sm" data-act="rest">${plan.rest ? '取消休息' : '设为休息日'}</button>
              <button class="btn-sm" data-act="allDone">全部完成</button>
              <button class="btn-sm" data-act="allReset">全部重置</button>
              <button class="btn-sm" data-act="regen">↻ 重新生成</button>
            </div>` : ''
          }
        </div>
        ${plan.note ? `<div class="muted" style="margin-top:10px">⚠️ ${esc(plan.note)}</div>` : ''}
      </div>

      ${plan.rest ? `
        <div class="card">
          <h3>休息日</h3>
          <p class="muted" style="line-height:1.8">今天不安排刷题（可点击「取消休息」强制安排，或点击「重新生成」）。适度休息也是冲刺的一部分，明天继续 💪</p>
        </div>
      ` : `
        <div class="card">
          <h3>🆕 新题 <span class="muted">（${newTotal} 道，难度以中等为主）</span></h3>
          ${newTotal === 0 ? '<div class="empty">新题池为空 — 去「题单管理」抓取更多题单，或取消部分题的「已掌握」标记</div>' : ''}
          ${plan.items.filter(i => i.kind === 'new').map(i => problemRowHtml(i, listBy, historyByQid, readonly)).join('')}
        </div>
        <div class="card">
          <h3>🔁 复习 <span class="muted">（${revTotal} 道，按上次复习时间由久到近）</span></h3>
          ${revTotal === 0 ? '<div class="empty">复习池为空 — 完成一些新题后，它们会自动进入复习队列</div>' : ''}
          ${plan.items.filter(i => i.kind === 'review').map(i => problemRowHtml(i, listBy, historyByQid, readonly)).join('')}
        </div>
      `}`;
    }

    // 会员专享题提示（历史计划里可能已排入）
    const paidItems = plan.items.filter(i => i.paidOnly);
    const paidBanner = paidItems.length
      ? `<div class="card" style="border-color:rgba(251,191,36,.5)">
          <div class="row spread">
            <span>⚠️ 该日有 <b style="color:var(--orange)">${paidItems.length}</b> 道 LeetCode 会员专享题（${paidItems.map(i => i.qid).join('、')}），没有会员可能做不了。</span>
            <button class="btn-sm btn-danger" data-act="purgePaid">🧹 一键移除会员题</button>
          </div>
        </div>` : '';

    // 顶部提示横幅
    let banner = '';
    if (plan.notBeforeStart) {
      banner = `<div class="muted" style="margin-bottom:10px">该日期早于计划开始日期，仅可查看。</div>`;
    } else if (isFuture) {
      banner = `<div class="muted" style="margin-bottom:10px">🔮 未来日期 · 该日计划将在当天自动生成，此处仅作预览占位。</div>`;
    } else if (date < today) {
      banner = `<div class="muted" style="margin-bottom:10px">🗂️ 历史刷题记录 · 只读。如需回顾，请前往「记忆库」。</div>`;
    }

    container.innerHTML = `
      <div class="row spread" style="margin-bottom:6px">
        <div>
          <div class="page-title">${isToday ? '今日计划' : '每日计划（只读）'}</div>
          <div class="page-sub">${esc(weekdayCn(date))} · ${esc(date)} · 新题按类别轮转，复习按间隔重复${isToday ? ' · 仅当天可编辑' : ''}</div>
        </div>
        <div class="row">
          <button class="btn-sm" data-act="prev">‹ 前一天</button>
          <button class="btn-sm" data-act="today">回到今天</button>
          <button class="btn-sm" data-act="next">后一天 ›</button>
        </div>
      </div>

      ${banner}
      ${paidBanner}
      ${content}
    `;

    this.bind(container, date, isToday);
  },

  bind(root, date, isToday) {
    // 顶部导航始终可用（无状态 / 无日期限制）
    root.querySelectorAll('[data-act=prev],[data-act=next],[data-act=today]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'prev') locationset(date, -1);
        else if (act === 'next') locationset(date, 1);
        else location.hash = '#/today';
      });
    });

    // 会员题一键移除（任何日期都可执行）
    const pb = root.querySelector('[data-act=purgePaid]');
    if (pb) pb.addEventListener('click', async () => {
      if (!(await confirmDlg('移除所有会员题', '将从记忆库、每日计划与题目池中移除所有会员专享题。确定？', '移除'))) return;
      const r = await window.lcAPI.purgePaid();
      toast(`已移除：记忆库 ${r.removedHistory} 道、计划 ${r.removedPlanItems} 条、题目池 ${r.removedPool} 道`, 'success');
      APP.metaCache.invalidate();
      this.render(root, { date });
    });

    // 仅当天可编辑：其余日期（含未来）状态按钮为 disabled，无需绑定
    if (!isToday) return;

    root.querySelectorAll('[data-act=rest],[data-act=allDone],[data-act=allReset],[data-act=regen]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        try {
          if (act === 'regen') {
            if (!(await confirmDlg('重新生成', '重新生成会按当前题单与记忆库状态重新排布该日题目（原有完成状态将被清空）。确定？', '重新生成'))) return;
            await window.lcAPI.regeneratePlan(date);
            toast('已重新生成', 'success');
            this.render(root, { date });
            return;
          }
          if (act === 'rest') {
            const cur = !(await window.lcAPI.getPlan(date)).rest;
            if (cur) {
              await window.lcAPI.setRest(date, true);
              toast('已设为休息日', 'success');
            } else {
              if (!(await confirmDlg('取消休息', '取消休息日，将按当月配置生成今日计划。', '取消休息'))) return;
              await window.lcAPI.setRest(date, false);
              toast('已恢复为刷题日', 'success');
            }
            this.render(root, { date });
            return;
          }
          if (act === 'allDone') {
            await window.lcAPI.setAllStatus(date, 'done');
            toast('已全部标记完成 🎉', 'success');
            this.render(root, { date });
            return;
          }
          if (act === 'allReset') {
            await window.lcAPI.setAllStatus(date, 'todo');
            toast('已全部重置', 'info');
            this.render(root, { date });
            return;
          }
        } catch (e) { toast('操作失败：' + e.message, 'error'); }
      });
    });

    root.querySelectorAll('.qitem .status-btns button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const qid = btn.parentElement.dataset.qid;
        const st = btn.dataset.st;
        try {
          await window.lcAPI.setStatus(date, qid, st);
          this.render(root, { date });
        } catch (e) { toast('更新失败：' + e.message, 'error'); }
      });
    });
  },
};

function locationset(date, n) {
  location.hash = '#/today?date=' + addDays(date, n);
}
