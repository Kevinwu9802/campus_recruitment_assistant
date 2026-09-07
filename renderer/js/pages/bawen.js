'use strict';
/* bawen.js — 八股文学习/复习页 */
window.PageBawen = {
  state: { tab: 'practice', sourceFilter: 'all', cards: [], idx: 0, results: {} },

  async render(container, params) {
    if (params && params.tab) this.state.tab = params.tab;
    const tab = this.state.tab;
    const sources = await window.lcAPI.listSources();
    const progress = await window.lcAPI.getBawenProgress();

    container.innerHTML = `
      <div class="page-title">📘 八股文学习 · 复习</div>
      <div class="page-sub">导入 PDF / Word / txt / md 文件或网址，自动提取知识点生成「题目·答案·出处」；作答后自动评分；进度随数据一起多端同步</div>
      <div class="tabs">
        <div class="tab ${tab === 'practice' ? 'active' : ''}" data-tab="practice">📖 练习</div>
        <div class="tab ${tab === 'sources' ? 'active' : ''}" data-tab="sources">📚 来源管理</div>
        <div class="tab ${tab === 'progress' ? 'active' : ''}" data-tab="progress">📈 学习进度</div>
      </div>
      <div id="bawenBody"></div>
    `;

    container.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      location.hash = '#/bawen?tab=' + t.dataset.tab;
    }));

    const body = container.querySelector('#bawenBody');
    // 切页时刷新来源/进度数据
    if (tab === 'sources') await this.renderSources(body, sources);
    else if (tab === 'progress') await this.renderProgress(body, progress);
    else await this.renderPractice(container, body, sources, progress);
  },

  async showPreview(prev) {
    const rows = (prev.cards || []).map((c, i) => `
      <label style="display:flex;gap:8px;align-items:flex-start;padding:9px 6px;border-bottom:1px solid var(--line);cursor:pointer">
        <input type="checkbox" checked data-i="${i}" style="margin-top:3px" />
        <span style="min-width:0;flex:1">
          <div style="font-weight:600">${esc(c.topic)}</div>
          <div class="muted" style="font-size:12px;line-height:1.5">${esc((c.answer || '').slice(0, 100))}${(c.answer || '').length > 100 ? '…' : ''}</div>
          <div class="muted" style="font-size:11px">📚 ${esc(c.sourceName || '')}</div>
        </span>
      </label>`).join('');
    const body = `<div class="muted" style="margin-bottom:8px">共 ${prev.total} 条，取消勾选可跳过；确认后写入「${esc(prev.name)}」（LLM 组合/拆分/补充结果）</div>
      <div style="max-height:56vh;overflow:auto">${rows}</div>`;
    const v = await openModal({
      title: `确认导入：${esc(prev.name)}`, body, okText: `导入所选 (${prev.total})`, cancelText: '取消', width: '720px',
      onOk: (el) => { const idx = [...el.querySelectorAll('input[type=checkbox]')].map((cb, i) => cb.checked ? i : -1).filter(i => i >= 0); return idx.length ? idx : false; },
    });
    return { acceptedIdx: Array.isArray(v) ? v : null };
  },

  async consumePreview(prev, label) {
    if (!prev || prev.ok === false) { toast('解析失败：' + ((prev && prev.error) || '未知'), 'error'); return; }
    const r = await this.showPreview(prev);
    if (r.acceptedIdx) {
      const c = await window.lcAPI.commitPending(prev.token, r.acceptedIdx);
      toast(`已导入 ${c.cardCount} 个知识点`, 'success');
    } else {
      await window.lcAPI.discardPending(prev.token);
      toast('已取消导入', 'info');
    }
  },

  async renderSources(body, sources) {
    if (this.offKp) { this.offKp(); this.offKp = null; }
    const cfg = await window.lcAPI.getConfig();
    const cleanDef = (cfg.llm && cfg.llm.cleanCards !== false);
    body.innerHTML = `
      <div class="card">
        <h3>➕ 添加八股来源 <span class="muted" style="font-weight:400">（不限数量）</span></h3>
        <div class="row">
          <button class="btn-primary" data-act="addFile">📁 选择文件（PDF / Word / txt / md）</button>
          <input type="url" id="srcUrl" class="grow" placeholder="粘贴网页链接，如 https://xx.com/blog/tcp" />
          <button class="btn-primary" data-act="addUrl">🌐 抓取网址</button>
        </div>
        <div class="row" style="margin-top:10px">
          <label class="muted" style="cursor:pointer;display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="crawlUrl" checked /> 深入抓取该页下的子页面（应抓尽抓）
          </label>
          <label class="muted" style="display:flex;align-items:center;gap:5px">目次上限
            <input type="number" id="crawlMax" value="0" min="0" max="2000" style="width:76px" />
          </label>
          <span class="muted" style="font-size:11.5px">0 = 全部；勾选后逐个抓取详情页，出处精确到每页标题</span>
        </div>
        <div class="row" style="margin-top:8px">
          <label class="muted" style="cursor:pointer;display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="cleanCards" ${cleanDef ? 'checked' : ''} /> 🧠 LLM 智能清洗知识点（审阅、组合、拆分、补充）
          </label>
          <span class="muted" style="font-size:11.5px">未配置 LLM 或失败时自动用规则切割</span>
        </div>
        <div id="kaoyanProg" class="hide" style="margin-top:10px">
          <div class="muted" id="kaoyanProgMsg" style="margin-bottom:6px"></div>
          <div style="background:var(--bg2);border-radius:8px;height:8px;overflow:hidden"><div id="kaoyanProgBar" style="height:100%;width:0;background:var(--accent);transition:width .3s"></div></div>
        </div>
        <div class="muted" style="margin-top:8px">系统会用隐藏窗口渲染（支持 SPA/JS 站点），自动切分为知识点卡，生成「题目 / 答案 / 出处」。支持 .pdf / .docx / .txt / .md 与任意网页。</div>
      </div>
      <div class="card">
        <h3>📚 已配置来源 <span class="muted" style="font-weight:400">（${sources.length} 个）</span></h3>
        ${sources.length ? sources.map(s => `
          <div class="row spread" style="padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="min-width:0">
              <div style="font-weight:600">${s.type === 'url' ? '🌐' : '📄'} ${esc(s.name)}</div>
              <div class="muted mono" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:560px">${esc(s.location)}</div>
              <div class="muted" style="font-size:11.5px;margin-top:3px">
                ${s.parsedAt ? `已解析 ${s.cardCount} 个知识点 · ${fmtTs(s.parsedAt)}` : '未解析'}
                ${s.type === 'url' && s.crawl ? '<span class="chip" style="margin-left:4px">🌐 子页面</span>' : ''}
                ${s.error ? ` <span style="color:var(--red)">⚠ ${esc(s.error)}</span>` : ''}
              </div>
            </div>
            <div class="row" style="flex-shrink:0">
              <button class="btn-sm" data-act="reclean" data-id="${esc(s.id)}" data-cnt="${s.cardCount || 0}">🧹 清洗</button>
              <button class="btn-sm" data-act="reparse" data-id="${esc(s.id)}">↻ 重新解析</button>
              <button class="btn-sm btn-danger" data-act="del" data-id="${esc(s.id)}" data-name="${esc(s.name)}">删除</button>
            </div>
          </div>`).join('')
        : '<div class="empty">暂无来源 — 点击上方按钮导入文件或网址。</div>'}
      </div>
    `;

    const saveClean = async () => {
      const cfg = await window.lcAPI.getConfig();
      await window.lcAPI.saveConfig({ llm: Object.assign({}, cfg.llm || {}, { cleanCards: body.querySelector('#cleanCards').checked }) });
      APP.metaCache.invalidate();
    };

    body.querySelector('[data-act=addFile]').addEventListener('click', async () => {
      const files = await window.lcAPI.pickBawenFiles();
      if (!files.length) return;
      await saveClean();
      const clean = body.querySelector('#cleanCards').checked;
      for (const f of files) {
        toast('正在解析：' + f.split(/[/\\]/).pop(), 'info');
        if (clean) {
          const prev = await window.lcAPI.previewSourceFile(f);
          await this.consumePreview(prev);
        } else {
          const r = await window.lcAPI.addSourceFile(f);
          if (r.ok) toast(`已生成 ${r.cardCount} 个知识点`, 'success');
          else toast('解析失败：' + r.error, 'error');
        }
      }
      this.renderSources(body, await window.lcAPI.listSources());
    });

    const urlInput = body.querySelector('#srcUrl');
    body.querySelector('[data-act=addUrl]').addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) return toast('请输入网页链接', 'error');
      await saveClean();
      const crawl = body.querySelector('#crawlUrl').checked;
      const crawlMax = Number(body.querySelector('#crawlMax').value) || 0;
      const prog = body.querySelector('#kaoyanProg');
      const progMsg = body.querySelector('#kaoyanProgMsg');
      const progBar = body.querySelector('#kaoyanProgBar');
      prog.classList.remove('hide');
      progBar.style.width = '5%';
      const off = window.lcAPI.onKaoyanProgress(d => {
        progMsg.textContent = d.msg || '抓取中…';
        progBar.style.width = '55%';
      });
      this.offKp = off;
      toast(crawl ? '正在渲染并抓取子页面（可能较慢）…' : '正在抓取网址…', 'info');
      const clean = body.querySelector('#cleanCards').checked;
      if (clean) {
        const prev = await window.lcAPI.previewSourceUrl(url, { crawl, crawlMax });
        off();
        prog.classList.add('hide');
        await this.consumePreview(prev);
      } else {
        const r = await window.lcAPI.addSourceUrl(url, { crawl, crawlMax });
        off();
        prog.classList.add('hide');
        if (r.ok) toast(`抓取成功，生成 ${r.cardCount} 个知识点（${r.pages} 页）`, 'success');
        else toast('抓取失败：' + r.error, 'error');
      }
      urlInput.value = '';
      this.renderSources(body, await window.lcAPI.listSources());
    });

    body.querySelectorAll('[data-act=reparse]').forEach(b => b.addEventListener('click', async () => {
      const clean = body.querySelector('#cleanCards').checked;
      if (clean) {
        const src = sources.find(s => s.id === b.dataset.id);
        toast('正在重新解析（LLM 清洗）…', 'info');
        const prev = src && src.type === 'file'
          ? await window.lcAPI.previewSourceFile(src.location)
          : await window.lcAPI.previewSourceUrl(src.location, { crawl: !!(src && src.crawl) });
        await this.consumePreview(prev);
        this.renderSources(body, await window.lcAPI.listSources());
        return;
      }
      const r = await window.lcAPI.reparseSource(b.dataset.id);
      toast(r.ok ? `重新解析完成，${r.cardCount} 个知识点` : '重新解析失败：' + r.error, r.ok ? 'success' : 'error');
      this.renderSources(body, await window.lcAPI.listSources());
    }));
    body.querySelectorAll('[data-act=reclean]').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDlg('整库 LLM 清洗', `用 LLM 对该来源已有的 ${b.dataset.cnt} 张卡重新组合/拆分/补充，预览确认后替换。将重置这些卡的掌握/作答进度。`, 'LLM 清洗'))) return;
      toast('LLM 清洗中…', 'info');
      const prev = await window.lcAPI.previewReclean(b.dataset.id);
      await this.consumePreview(prev);
      this.renderSources(body, await window.lcAPI.listSources());
    }));
    body.querySelectorAll('[data-act=del]').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDlg('删除来源', `删除「${b.dataset.name}」及其全部知识点卡片？`, '删除'))) return;
      await window.lcAPI.removeSource(b.dataset.id);
      toast('已删除', 'info');
      this.renderSources(body, await window.lcAPI.listSources());
    }));
  },

  async renderProgress(body, progress) {
    let lowList = [];
    try {
      const cards = await window.lcAPI.listCards({});
      lowList = cards.filter(c => c.status === 'unknown').slice(0, 10);
    } catch (e) {}
    body.innerHTML = `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
        <div class="stat-card accent"><div class="v">${progress.total}</div><div class="l">知识点总数</div></div>
        <div class="stat-card green"><div class="v">${progress.done}</div><div class="l">已掌握</div></div>
        <div class="stat-card orange"><div class="v">${progress.unknown}</div><div class="l">待复习</div></div>
        <div class="stat-card"><div class="v">${progress.pending}</div><div class="l">未作答</div></div>
        <div class="stat-card purple"><div class="v">${progress.tried}</div><div class="l">已作答</div></div>
        <div class="stat-card"><div class="v">${progress.avg}</div><div class="l">平均分</div></div>
      </div>
      <div class="card">
        <h3>📌 待复习（答错/低分，考前重点看）</h3>
        ${lowList.length ? lowList.map(c => `
          <div class="row spread" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <div class="grow" style="min-width:0">
              <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.topic)}</div>
              <div class="muted" style="font-size:11.5px">📚 ${esc(c.sourceName)} · 已作答 ${c.attempts} 次 · 最佳 ${c.best} 分</div>
            </div>
            <button class="btn-sm" data-act="goCard" data-id="${esc(c.id)}">去复习</button>
          </div>`).join('') : '<div class="empty">没有待复习的卡片，继续保持 👏</div>'}
      </div>
      <div class="muted">📈 学习进度（掌握/待复习/分数）会随数据一起通过 WebDAV 多端同步。</div>
    `;
    body.querySelectorAll('[data-act=goCard]').forEach(b => b.addEventListener('click', () => {
      // 跳到练习并定位到该卡
      this.state.sourceFilter = 'all';
      location.hash = '#/bawen?tab=practice' + (b.dataset.id ? '' : '');
      this.state.focusCard = b.dataset.id;
    }));
  },

  orderCards(cards) {
    const order = this.state.order || 'random';
    const arr = cards.slice();
    if (order === 'list') return arr;
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } // Fisher-Yates
    if (order === 'weak') {
      const rank = c => c.status === 'unknown' ? 0 : ((c.status === 'new' || (c.attempts || 0) === 0) ? 1 : 2);
      arr.sort((a, b) => rank(a) - rank(b)); // 稳定排序：待复习优先，组内保持随机
    }
    return arr;
  },

  async renderPractice(container, body, sources, progress) {
    const filter = this.state.sourceFilter;
    const order = this.state.order || 'random';
    // 出题队列：仅当 范围/顺序/洗牌 变化时重建，翻页不重排
    const key = filter + '|' + order + '|' + (this.state.deckTick || 0);
    if (key !== this.state.deckKey) {
      const cards0 = await window.lcAPI.listCards(filter === 'all' ? {} : { sourceId: filter });
      this.state.cards = this.orderCards(cards0);
      this.state.deckKey = key;
      this.state.idx = 0;
      if (this.state.focusCard) {
        const i = this.state.cards.findIndex(c => c.id === this.state.focusCard);
        if (i >= 0) this.state.idx = i;
        this.state.focusCard = null;
      }
    }
    const cards = this.state.cards;
    if (this.state.idx >= cards.length) this.state.idx = 0;
    const config = await window.lcAPI.getConfig();
    this.state.mode = (config.llm && config.llm.mode) || 'similarity';
    const total = cards.length;
    const idx = this.state.idx;
    const card = cards[idx] || null;

    body.innerHTML = `
      <div class="card">
        <div class="row spread" style="margin-bottom:12px;flex-wrap:wrap">
          <div class="row">
            <label style="margin:0">范围：</label>
            <select id="pfSrc">
              <option value="all" ${filter === 'all' ? 'selected' : ''}>全部（${progress.total}）</option>
              ${sources.map(s => `<option value="${esc(s.id)}" ${filter === s.id ? 'selected' : ''}>${esc(s.name)}（${s.cardCount}）</option>`).join('')}
            </select>
            <label style="margin:0">出题：</label>
            <div class="seg" id="pfOrder">
              <button data-order="random" class="${(this.state.order || 'random') === 'random' ? 'active' : ''}">随机</button>
              <button data-order="weak" class="${this.state.order === 'weak' ? 'active' : ''}">待复习优先</button>
              <button data-order="list" class="${this.state.order === 'list' ? 'active' : ''}">原顺序</button>
            </div>
            ${(this.state.order || 'random') !== 'list' ? '<button class="btn-sm" data-act="reshuffle">🔀 洗牌</button>' : ''}
          </div>
          <div class="muted">第 <b>${total ? idx + 1 : 0}</b> / ${total} 题</div>
        </div>
        ${card ? this.cardHtml(card) : '<div class="empty">没有知识点可练习 — 请先到「来源管理」导入文件或网址。</div>'}
      </div>
    `;

    body.querySelector('#pfSrc').addEventListener('change', async () => {
      this.state.sourceFilter = body.querySelector('#pfSrc').value;
      this.state.deckKey = ''; // 重建
      this.renderPractice(container, body, sources, await window.lcAPI.getBawenProgress());
    });
    body.querySelectorAll('#pfOrder button').forEach(b => b.addEventListener('click', async () => {
      this.state.order = b.dataset.order;
      this.state.deckKey = ''; // 重建
      this.renderPractice(container, body, sources, await window.lcAPI.getBawenProgress());
    }));
    const sh = body.querySelector('[data-act=reshuffle]');
    if (sh) sh.addEventListener('click', async () => {
      this.state.deckTick = (this.state.deckTick || 0) + 1;
      this.state.deckKey = '';
      this.renderPractice(container, body, sources, await window.lcAPI.getBawenProgress());
    });

    if (card) this.bindCard(body, card, total);
  },

  cardHtml(card) {
    const mode = this.state.mode || 'similarity';
    const res = this.state.results[card.id];
    const statusChip = card.status === 'known' ? '<span class="chip" style="color:var(--green);border-color:rgba(52,211,153,.4)">已掌握</span>'
      : card.status === 'unknown' ? '<span class="chip" style="color:var(--orange);border-color:rgba(251,191,36,.4)">待复习</span>' : '';
    const modeLabel = { similarity: '离线相似度', llm: 'LLM 智能', none: '只看答案' };
    return `
      <div class="qitem" style="border:none;background:transparent;padding:0;margin:0 0 12px">
        <div class="qtitle">
          <div style="font-size:16px;font-weight:700;line-height:1.5">❓ ${esc(card.topic)}</div>
          <span class="muted" style="font-size:12px">📚 ${esc(card.sourceName)}${card.location ? ' · ' + esc(card.location) : ''}</span>
        </div>
        ${statusChip}
      </div>
      <div class="row" style="margin-bottom:10px">
        <label style="margin:0">评分方式：</label>
        <div class="seg" id="scoreMode">
          <button data-mode="similarity" class="${mode === 'similarity' ? 'active' : ''}">相似度</button>
          <button data-mode="llm" class="${mode === 'llm' ? 'active' : ''}">LLM 智能</button>
          <button data-mode="none" class="${mode === 'none' ? 'active' : ''}">只看答案</button>
        </div>
        <span class="muted">当前：${modeLabel[mode]}</span>
      </div>
      <div class="field">
        <label>你的回答${mode === 'none' ? '（可选，可选择不作答直接看答案）' : ''}</label>
        <textarea id="userAns" rows="5" style="width:100%;background:var(--bg2);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:10px;font-size:13px;font-family:inherit" placeholder="${mode === 'none' ? '可留空，直接点「查看答案」' : '在此输入你的理解…'}"></textarea>
      </div>
      <div class="row">
        ${mode !== 'none' ? '<button class="btn-primary" id="btnSubmit">提交评分</button>' : ''}
        <button class="btn" id="btnView">📖 查看答案</button>
        <button class="btn-sm" id="btnNext">下一题 ›</button>
        <button class="btn-sm" id="btnPrev">‹ 上一题</button>
        <span class="grow"></span>
        <button class="btn-sm" id="btnKnown">✅ 标记已掌握</button>
        <button class="btn-sm" id="btnUnknown">🤔 标记待复习</button>
      </div>
      <div id="resultBox" style="margin-top:14px">${res ? this.resultHtml(res) : ''}</div>
    `;
  },

  resultHtml(res) {
    if (res.viewed) {
      return `
        <div style="background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:14px">
          <div class="muted" style="margin-bottom:6px">👁 已查看答案（未评分）· 出处：${esc(res.sourceName)}</div>
          <div style="white-space:pre-wrap;line-height:1.7">${esc(res.std)}</div>
        </div>`;
    }
    const cls = res.score >= 80 ? 'green' : res.score >= 50 ? 'orange' : 'red';
    return `
      <div style="background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:14px">
        <div class="row" style="gap:14px">
          <span style="font-size:20px;font-weight:800;color:var(--${cls})">${res.score} 分</span>
          <span class="muted">${res.method === 'llm' ? '🤖 LLM 评分' : '📐 离线相似度'} · 历史最佳 ${res.best} 分</span>
        </div>
        ${res.comment ? `<div style="margin-top:6px;color:var(--accent)">💬 ${esc(res.comment)}</div>` : ''}
        ${res.llmFailed ? `<div class="muted" style="margin-top:4px;font-size:11px">${esc(res.comment)}</div>` : ''}
        <div style="margin-top:10px">
          <div class="muted" style="margin-bottom:3px">标准答案（出处：${esc(res.sourceName)}）：</div>
          <div style="white-space:pre-wrap;line-height:1.7">${esc(res.std)}</div>
        </div>
      </div>`;
  },

  async bindCard(body, card, total) {
    const setResult = (r) => {
      this.state.results[card.id] = r;
      const box = body.querySelector('#resultBox');
      if (box) box.innerHTML = this.resultHtml(r);
    };
    const mode = this.state.mode;
    // 评分方式切换（即时保存并重渲染）
    body.querySelectorAll('#scoreMode button').forEach(b => b.addEventListener('click', async () => {
      const cfg = await window.lcAPI.getConfig();
      await window.lcAPI.saveConfig({ llm: Object.assign({}, cfg.llm || {}, { mode: b.dataset.mode }) });
      this.state.mode = b.dataset.mode;
      this.state.results = {}; // 切模式清空该次结果
      this.refreshPractice(body);
    }));
    // 查看答案（不作答）
    body.querySelector('#btnView').addEventListener('click', async () => {
      const v = await window.lcAPI.viewCard(card.id);
      setResult({ viewed: true, std: v.std, sourceName: v.sourceName, location: v.location });
    });
    // 提交评分
    const submitBtn = body.querySelector('#btnSubmit');
    if (submitBtn) submitBtn.addEventListener('click', async () => {
      const ans = body.querySelector('#userAns').value.trim();
      if (!ans) return toast('请先输入你的回答', 'info');
      const r = await window.lcAPI.submitAnswer(card.id, ans);
      setResult(r);
      toast(`评分完成：${r.noScore ? '已记录' : r.score + ' 分'}`, r.noScore || r.score >= 60 ? 'success' : 'error');
    });
    body.querySelector('#btnNext').addEventListener('click', () => {
      if (this.state.idx + 1 < total) { this.state.idx += 1; this.refreshPractice(body); }
      else toast('已是最后一题', 'info');
    });
    body.querySelector('#btnPrev').addEventListener('click', () => {
      if (this.state.idx - 1 >= 0) { this.state.idx -= 1; this.refreshPractice(body); }
      else toast('已是第一题', 'info');
    });
    body.querySelector('#btnKnown').addEventListener('click', async () => {
      await window.lcAPI.setCardStatus(card.id, 'known');
      toast('已标记为掌握', 'success');
      this.refreshPractice(body);
    });
    body.querySelector('#btnUnknown').addEventListener('click', async () => {
      await window.lcAPI.setCardStatus(card.id, 'unknown');
      toast('已标记为待复习', 'info');
      this.refreshPractice(body);
    });
  },

  async refreshPractice(body) {
    const sources = await window.lcAPI.listSources();
    const progress = await window.lcAPI.getBawenProgress();
    await this.renderPractice(document.getElementById('content'), body, sources, progress);
  },
};
