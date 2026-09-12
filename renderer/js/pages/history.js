'use strict';
/* history.js — 记忆库（核心记忆功能） */
window.PageHistory = {
  state: { q: '', filter: 'all', tag: '' },

  async render(container) {
    const all = await window.lcAPI.getHistory();
    const { q, filter, tag } = this.state;
    let rows = all;

    if (q) rows = rows.filter(h => (h.translatedTitle + h.title + h.frontendId).toLowerCase().includes(q.toLowerCase()));
    if (tag) rows = rows.filter(h => (h.tags || []).includes(tag));
    if (filter === 'new') rows = rows.filter(h => (h.timesScheduled || 0) === 0 && !h.mastered);
    else if (filter === 'review') rows = rows.filter(h => ((h.timesScheduled || 0) > 0 || (h.timesCompleted || 0) > 0) && !h.mastered);
    else if (filter === 'done') rows = rows.filter(h => (h.timesCompleted || 0) > 0);
    else if (filter === 'mastered') rows = rows.filter(h => h.mastered);
    else if (filter === 'paid') rows = rows.filter(h => h.paidOnly);

    const tagSet = {};
    for (const h of all) for (const t of (h.tags || [])) tagSet[t] = 1;
    const tags = Object.keys(tagSet).sort();

    const total = all.length;
    const newCount = all.filter(h => (h.timesScheduled || 0) === 0 && !h.mastered).length;
    const revCount = all.filter(h => ((h.timesScheduled || 0) > 0 || (h.timesCompleted || 0) > 0) && !h.mastered).length;
    const mastered = all.filter(h => h.mastered).length;

    container.innerHTML = `
      <div class="page-title">记忆库</div>
      <div class="page-sub">按题号去重的全局记忆：同一道题出现在多个题单或后来被加入新题单时，自动识别为旧题进入复习，不会被当作新题</div>

      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
        <div class="stat-card accent"><div class="v">${total}</div><div class="l">记忆库总题数</div></div>
        <div class="stat-card"><div class="v">${newCount}</div><div class="l">待刷新题</div></div>
        <div class="stat-card purple"><div class="v">${revCount}</div><div class="l">复习队列</div></div>
        <div class="stat-card green"><div class="v">${mastered}</div><div class="l">已掌握</div></div>
      </div>

      <div class="card">
        <div class="row" style="margin-bottom:12px">
          <input type="text" id="hq" class="grow" placeholder="搜索题号 / 标题 / 类别…" value="${esc(q)}" />
          <div class="seg" id="hfilter">
            ${[['all', '全部'], ['new', '待刷新题'], ['review', '复习'], ['done', '已刷过'], ['mastered', '已掌握'], ['paid', '会员题']].map(([k, l]) =>
              `<button data-f="${k}" class="${filter === k ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <button class="btn-sm" data-act="markLearned" title="把当前筛选结果标记为「已学过/已做过」，之后不再作为新题">✅ 标记已学过</button>
          <button class="btn-sm btn-danger" data-act="purgePaid" title="从记忆库、每日计划与题目池中移除所有会员专享题">🧹 移除所有会员题</button>
        </div>
        ${tags.length ? `<div class="tag-cloud" style="margin-bottom:12px">
          <button class="chip" data-tag="" style="${!tag ? 'border-color:var(--accent);color:var(--accent)' : ''};cursor:pointer;background:var(--bg2)">全部类别</button>
          ${tags.slice(0, 20).map(t => `<button class="chip tag" data-tag="${esc(t)}" style="cursor:pointer;${tag === t ? 'border-color:var(--accent);color:var(--accent)' : ''}">${esc(t)}</button>`).join('')}
        </div>` : ''}
        <table class="tbl">
          <thead><tr><th>题号</th><th>标题</th><th>难度</th><th>类别</th><th>首次出现</th><th>排期/完成</th><th>上次复习</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>
            ${rows.slice(0, 500).map(h => `
              <tr data-qid="${esc(h.frontendId)}">
                <td><a class="qid" href="https://leetcode.cn/problems/${esc(h.titleSlug)}/">${esc(h.frontendId)}</a></td>
                <td>${esc(h.translatedTitle)}<div class="muted" style="font-size:11px">${esc(h.title || '')}</div></td>
                <td><span class="chip diff-${h.difficulty}">${DIFF_CN[h.difficulty] || h.difficulty}</span>${h.paidOnly ? ' <span class="chip" style="color:var(--orange);border-color:rgba(251,191,36,.5)">会员</span>' : ''}</td>
                <td>${(h.tags || []).slice(0, 2).map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}</td>
                <td class="muted">${fmtDateShort(h.firstSeenAt)}</td>
                <td><b>${h.timesScheduled || 0}</b> / <b style="color:var(--green)">${h.timesCompleted || 0}</b></td>
                <td class="muted">${fmtDateShort(h.lastReviewedDate || h.lastScheduledDate)}</td>
                <td>${h.mastered ? '<span class="chip" style="color:var(--green);border-color:rgba(52,211,153,.4)">已掌握</span>'
                  : (h.timesScheduled || 0) === 0 ? '<span class="chip kind-new">新题</span>'
                  : '<span class="chip kind-review">复习</span>'}</td>
                <td style="text-align:right;white-space:nowrap">
                  ${h.mastered
                    ? `<button class="btn-sm" data-act="unmaster">取消掌握</button>`
                    : `<button class="btn-sm" data-act="master">标记掌握</button>
                       <button class="btn-sm" data-act="doneBefore" title="标记为：加入工具前已经刷过">标记已做过</button>`}
                  <button class="btn-sm btn-danger" data-act="del">删除</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="9"><div class="empty">没有匹配的记录</div></td></tr>'}
          </tbody>
        </table>
        ${rows.length > 500 ? `<div class="muted" style="margin-top:8px">仅显示前 500 条，请用搜索/筛选缩小范围</div>` : ''}
      </div>
    `;

    // 绑定
    container.querySelector('#hq').addEventListener('input', e => {
      this.state.q = e.target.value;
      debounce(() => this.render(container), 250);
    });
    container.querySelectorAll('#hfilter button').forEach(b => b.addEventListener('click', () => {
      this.state.filter = b.dataset.f;
      this.render(container);
    }));
    container.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => {
      this.state.tag = this.state.tag === b.dataset.tag ? '' : b.dataset.tag;
      this.render(container);
    }));
    const learnedBtn = container.querySelector('[data-act=markLearned]');
    if (learnedBtn) learnedBtn.addEventListener('click', async () => {
      if (!rows.length) return toast('当前没有可标记的题', 'info');
      if (!(await confirmDlg('批量标记已学过', `把当前筛选的 ${rows.length} 道题全部标记为「已学过/已做过」？之后它们不再作为“新题”，只按“复习”排布。`, '标记'))) return;
      const r = await window.lcAPI.markLearned(rows.map(h => h.frontendId));
      toast(`已标记 ${r.marked} 道题为「已学过」`, 'success');
      APP.metaCache.invalidate();
      this.render(container);
    });
    const purgeBtn = container.querySelector('[data-act=purgePaid]');
    if (purgeBtn) purgeBtn.addEventListener('click', async () => {
      const paidCount = all.filter(h => h.paidOnly).length;
      if (!(await confirmDlg('移除所有会员题', `将从记忆库、每日计划与题目池中移除所有 LeetCode 会员专享题（当前记忆库有 ${paidCount} 道）。确定？`, '移除'))) return;
      const r = await window.lcAPI.purgePaid();
      toast(`已移除：记忆库 ${r.removedHistory} 道、计划 ${r.removedPlanItems} 条、题目池 ${r.removedPool} 道`, 'success');
      APP.metaCache.invalidate();
      this.render(container);
    });
    container.querySelectorAll('tr[data-qid]').forEach(tr => {
      tr.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const qid = tr.dataset.qid;
          const act = btn.dataset.act;
          try {
            if (act === 'master') { await window.lcAPI.updateHistoryMeta(qid, { mastered: true }); toast('已标记为掌握，不再进入新题/复习队列', 'success'); }
            if (act === 'unmaster') { await window.lcAPI.updateHistoryMeta(qid, { mastered: false }); toast('已取消掌握', 'info'); }
            if (act === 'doneBefore') {
              await window.lcAPI.updateHistoryMeta(qid, {
                timesCompleted: Math.max(1, (await window.lcAPI.getHistory()).find(x => x.frontendId === qid).timesCompleted || 1),
                firstCompletedDate: todayStr(),
                lastCompletedDate: todayStr(),
                lastReviewedDate: todayStr(),
              });
              toast('已标记为「此前刷过」→ 今后按复习题处理', 'success');
            }
            if (act === 'del') {
              if (!(await confirmDlg('删除记忆', `确认删除题号 ${qid} 的记忆记录？之后它可能重新作为新题出现。`))) return;
              await window.lcAPI.deleteHistory(qid);
              toast('已删除', 'info');
            }
            APP.metaCache.invalidate();
            this.render(container);
          } catch (e) { toast('操作失败：' + e.message, 'error'); }
        });
      });
    });
  },
};

let _dbTimer = null;
function debounce(fn, ms) {
  clearTimeout(_dbTimer);
  _dbTimer = setTimeout(fn, ms);
}
