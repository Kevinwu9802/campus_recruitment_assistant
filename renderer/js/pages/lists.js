'use strict';
/* lists.js — 题单管理页 */
window.PageLists = {
  offFetch: null,
  async render(container) {
    if (this.offFetch) { this.offFetch(); this.offFetch = null; }
    const data = await window.lcAPI.getLists();
    const config = await window.lcAPI.getConfig();
    const lists = data.lists || [];
    const pool = await window.lcAPI.getPool();

    // 知识点统计（启用题单）
    const tagCount = {};
    const diffCount = { EASY: 0, MEDIUM: 0, HARD: 0 };
    for (const l of lists) {
      if (config.listEnabled && config.listEnabled[l.slug] === false) continue;
      for (const q of l.questions || []) {
        diffCount[q.difficulty] = (diffCount[q.difficulty] || 0) + 1;
        const t = q.tags && q.tags.length ? q.tags[0].nameTranslated : '未分类';
        tagCount[t] = (tagCount[t] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 16);

    container.innerHTML = `
      <div class="page-title">题单管理</div>
      <div class="page-sub">定时抓取个人主页公开题单，自动更新记忆库，避免“表面是新题、实际是旧题”</div>

      <div class="card">
        <h3>👤 用户主页 <span class="muted" style="font-weight:400">（可配置，抓取该主页公开的题单）</span></h3>
        ${!config.userSlug ? '<div class="muted" style="background:var(--bg2);border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin-bottom:10px">⚠ 首次使用：请在下方填入你的 LeetCode 主页链接，然后点击「保存并抓取题单」。</div>' : ''}
        <div class="row">
          <input type="url" id="profileUrl" class="grow" value="${esc(config.profileUrl || '')}" placeholder="https://leetcode.cn/u/your-username/" />
          <button class="btn-primary" data-act="fetchProfile">保存并抓取题单</button>
        </div>
        <div class="muted" style="margin-top:8px">当前 userSlug：<b class="mono">${esc(config.userSlug || '—')}</b>
          ${data.lastFetchAt ? ` · 最近抓取：${fmtTs(data.lastFetchAt)}` : ''}
        </div>
        <div id="fetchProgress" class="hide" style="margin-top:10px">
          <div class="muted" id="fetchStep" style="margin-bottom:6px"></div>
          <div style="background:var(--bg2);border-radius:8px;height:8px;overflow:hidden">
            <div id="fetchBar" style="height:100%;width:0;background:var(--accent);transition:width .3s"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>🆕 新题候选池 <span class="muted" style="font-weight:400">（<b>新题 = 不在题单、但知识点命中任一题单标签</b>的 LeetCode 题）</span></h3>
        <div class="row spread">
          <span class="muted">${pool.count ? `已抓取 ${pool.count} 道候选` : '尚未抓取'}${pool.updatedAt ? ` · ${fmtTs(pool.updatedAt)}` : ''}</span>
          <button class="btn-sm" data-act="fetchPool">↻ 抓取题目池</button>
        </div>
        <div class="muted" style="margin-top:6px">复习 = 你题单里的题；新题从题目池里挑“未被题单收录、且知识点与题单重合”的中等题。</div>
      </div>

      <div class="card">
        <h3>🧠 知识点覆盖 <span class="muted" style="font-weight:400">（启用题单的首类别标签统计）</span></h3>
        <div class="tag-cloud">${topTags.length ? topTags.map(([t, c]) => `<span class="chip tag">${esc(t)} ${c}</span>`).join('') : '<span class="muted">暂无数据，先抓取题单</span>'}</div>
        <div class="muted" style="margin-top:8px">难度分布：简单 <b>${diffCount.EASY || 0}</b> · 中等 <b style="color:var(--orange)">${diffCount.MEDIUM || 0}</b> · 困难 <b style="color:var(--red)">${diffCount.HARD || 0}</b></div>
      </div>

      <div class="list-grid">
        ${lists.map(l => {
          const enabled = !(config.listEnabled && config.listEnabled[l.slug] === false);
          const dq = { EASY: 0, MEDIUM: 0, HARD: 0 };
          const ltags = {};
          for (const q of l.questions || []) {
            dq[q.difficulty] = (dq[q.difficulty] || 0) + 1;
            const t = q.tags && q.tags.length ? q.tags[0].nameTranslated : '未分类';
            ltags[t] = (ltags[t] || 0) + 1;
          }
          const top = Object.entries(ltags).sort((a, b) => b[1] - a[1]).slice(0, 6);
          const added = l.prevQuestionNumber != null && l.prevQuestionNumber < l.questionNumber
            ? `<span class="chip" style="color:var(--green);border-color:rgba(52,211,153,.4)">+${l.questionNumber - l.prevQuestionNumber} 新</span>` : '';
          return `
          <div class="list-card" data-slug="${esc(l.slug)}">
            <div class="name">
              <span>${esc(l.name)}</span>
              ${l.isDefaultList ? '<span class="chip">默认</span>' : ''}
              <label style="margin-left:auto" class="switch">
                <input type="checkbox" data-slug-sync ${enabled ? 'checked' : ''} />
                <span class="track"></span>
              </label>
            </div>
            <div class="desc">${esc(l.description || '（无描述）')}</div>
            <div class="row spread muted" style="font-size:12px">
              <span>共 <b>${l.questionNumber}</b> 题 ${added}</span>
              <span>${l.fetchedAt ? '更新于 ' + fmtDateShort(l.fetchedAt) : '未抓取'}</span>
            </div>
            <div class="row" style="margin-top:8px;font-size:12px;color:var(--text2)">
              <span>简单 ${dq.EASY || 0}</span><span>中等 ${dq.MEDIUM || 0}</span><span>困难 ${dq.HARD || 0}</span>
            </div>
            ${top.length ? `<div class="row" style="margin-top:8px;gap:4px">${top.slice(0, 4).map(([t, c]) => `<span class="chip tag">${esc(t)} ${c}</span>`).join('')}</div>` : ''}
            <div class="row" style="margin-top:12px">
              <button class="btn-sm" data-act="preview" data-slug="${esc(l.slug)}">👁 预览题目</button>
              <button class="btn-sm" data-act="learned" data-slug="${esc(l.slug)}" data-name="${esc(l.name)}">✅ 标记已学过</button>
              <button class="btn-sm" data-act="fetchOne" data-slug="${esc(l.slug)}" data-name="${esc(l.name)}">↻ 刷新全部</button>
              <button class="btn-sm btn-danger" data-act="remove" data-slug="${esc(l.slug)}" style="margin-left:auto">删除缓存</button>
            </div>
          </div>`;
        }).join('') || '<div class="empty">尚未抓取到题单 — 点击上方「保存并抓取题单」</div>'}
      </div>
    `;

    this.bind(container, lists);
  },

  bind(container, lists) {
    const progress = container.querySelector('#fetchProgress');
    const bar = container.querySelector('#fetchBar');
    const step = container.querySelector('#fetchStep');
    const setProgress = (p) => { if (bar) bar.style.width = (p * 100).toFixed(1) + '%'; };
    const offFetch = window.lcAPI.onFetchStatus(d => {
      if (progress.classList.contains('hide')) progress.classList.remove('hide');
      if (d.running) {
        step.textContent = d.step || '抓取中…';
        if (d.got && d.total) setProgress(d.got / d.total);
        else setProgress(0.35);
      } else {
        setProgress(1);
        setTimeout(() => {
          progress.classList.add('hide');
          this.render(container);
        }, 400);
      }
    });
    this.offFetch = offFetch;

    container.querySelector('[data-act=fetchProfile]').addEventListener('click', async () => {
      const url = container.querySelector('#profileUrl').value.trim();
      if (!url) return toast('请输入主页链接', 'error');
      try {
        const p = await window.lcAPI.fetchProfile(url);
        toast(`已保存并识别用户：${p.realName || p.userSlug}${p.siteRanking ? `（站内排名 ${p.siteRanking}）` : ''}`, 'success');
        const r = await window.lcAPI.fetchAllLists();
        if (!r.ok) throw new Error(r.error);
        toast(`抓取完成：${r.lists.join('、')}，共 ${r.fetched} 题`, 'success');
        APP.metaCache.invalidate();
        this.render(container);
      } catch (e) { toast('失败：' + e.message, 'error'); }
    });

    const poolBtn = container.querySelector('[data-act=fetchPool]');
    if (poolBtn) poolBtn.addEventListener('click', async () => {
      toast('正在抓取 LeetCode 题目池（几千道，约几秒）…', 'info');
      const r = await window.lcAPI.fetchPool();
      if (r.ok) toast(`题目池已更新：${r.count} 道候选`, 'success');
      else toast('题目池抓取失败：' + r.error, 'error');
      this.render(container);
    });

    container.querySelectorAll('[data-act=fetchOne]').forEach(b => {
      b.addEventListener('click', async () => {
        toast(`正在抓取「${b.dataset.name}」…`, 'info');
        try {
          const r = await window.lcAPI.fetchAllLists();
          if (!r.ok) throw new Error(r.error);
          toast(`抓取完成：${r.lists.join('、')}，共 ${r.fetched} 题`, 'success');
          APP.metaCache.invalidate();
          this.render(container);
        } catch (e) { toast('失败：' + e.message, 'error'); }
      });
    });

    container.querySelectorAll('.list-card input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const slug = cb.closest('.list-card').dataset.slug;
        await window.lcAPI.toggleList(slug, cb.checked);
        toast(cb.checked ? '已启用该题单（参与排期）' : '已停用该题单（不再参与排期）', 'success');
      });
    });

    container.querySelectorAll('[data-act=learned]').forEach(b => {
      b.addEventListener('click', async () => {
        const list = lists.find(l => l.slug === b.dataset.slug);
        if (!list || !list.questions) return toast('该题单尚无题目缓存', 'info');
        if (!(await confirmDlg('标记已学过', `把「${list.name}」的 ${list.questions.length} 道题全部标记为「已学过/已做过」？之后它们不会再作为“新题”，只按“复习”排布。`, '标记'))) return;
        const r = await window.lcAPI.markLearned(list.questions.map(q => q.questionFrontendId));
        toast(`已标记 ${r.marked} 道题为「已学过」`, 'success');
        APP.metaCache.invalidate();
      });
    });

    container.querySelectorAll('[data-act=preview]').forEach(b => {
      b.addEventListener('click', async () => {
        const slug = b.dataset.slug;
        const list = lists.find(l => l.slug === slug);
        if (!list || !list.questions) return toast('该题单尚无题目缓存', 'info');
        const rows = list.questions.map(q => `
          <tr>
            <td><a class="qid" href="https://leetcode.cn/problems/${esc(q.titleSlug)}/">${esc(q.questionFrontendId)}</a></td>
            <td>${esc(q.translatedTitle)}<div class="muted" style="font-size:11px">${esc(q.title)}</div></td>
            <td><span class="chip diff-${q.difficulty}">${DIFF_CN[q.difficulty] || q.difficulty}</span></td>
            <td>${(q.tags || []).slice(0, 2).map(t => `<span class="chip tag">${esc(t.nameTranslated)}</span>`).join('')}</td>
          </tr>`).join('');
        await openModal({
          title: `「${list.name}」共 ${list.questions.length} 题`,
          body: `<table class="tbl"><thead><tr><th>题号</th><th>标题</th><th>难度</th><th>类别</th></tr></thead><tbody>${rows}</tbody></table>`,
          okText: '关闭', cancelText: '',
          width: '760px',
        });
      });
    });

    container.querySelectorAll('[data-act=remove]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!(await confirmDlg('删除缓存', '仅删除本机缓存，不会影响 LeetCode 上的题单。记忆库中已记录的历史仍保留。'))) return;
        await window.lcAPI.removeList(b.dataset.slug);
        APP.metaCache.invalidate();
        toast('已删除缓存', 'info');
        this.render(container);
      });
    });
  },
};
