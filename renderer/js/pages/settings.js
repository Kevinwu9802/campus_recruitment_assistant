'use strict';
/* settings.js — 设置页 */
window.PageSettings = {
  year: new Date().getFullYear(),

  async render(container) {
    const config = await window.lcAPI.getConfig();
    const info = await window.lcAPI.getInfo();
    const year = this.year;
    const llmKey = await window.lcAPI.getLlmKey();

    // 12 个月的有效配置（内置预设 + 用户覆盖）
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const mk = `${year}-${String(m).padStart(2, '0')}`;
      const def = await window.lcAPI.monthDefault(mk);
      months.push({ mk, m, def: Object.assign({}, def, config.monthPlans[mk] || {}) });
    }

    container.innerHTML = `
      <div class="page-title">设置</div>
      <div class="page-sub">配置题单来源、月份节奏、抓取计划、数据同步、评分与外观</div>

      <div class="card">
        <h3>🎨 外观</h3>
        <div class="row">
          <span class="muted">主题：</span>
          <div class="seg" id="themeSel">
            <button data-theme="dark" class="${(config.ui?.theme || 'dark') === 'dark' ? 'active' : ''}">🌙 深色</button>
            <button data-theme="light" class="${config.ui?.theme === 'light' ? 'active' : ''}">☀️ 浅色</button>
            <button data-theme="auto" class="${config.ui?.theme === 'auto' ? 'active' : ''}">💻 跟随系统</button>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>👤 个人信息（题单来源）</h3>
        <div class="field">
          <label>LeetCode 个人主页链接</label>
          <input type="url" id="cfgProfileUrl" class="grow" value="${esc(config.profileUrl || '')}" placeholder="https://leetcode.cn/u/your-username/" style="width:100%" />
          <div class="hint">用于抓取该主页「题单」Tab 下的公开题单。修改后请在「题单管理」页点击保存并抓取。</div>
        </div>
        <div class="field">
          <label>计划开始日期（从此日期起才生成每日题单）</label>
          <input type="date" id="cfgStart" value="${esc(config.scheduleStart || '2026-09-01')}" style="width:180px" />
          <div class="hint">早于该日期的日子不生成、不排期，仅作只读查看（如需改，先清空旧计划）。</div>
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="skipPaid" ${config.skipPaidOnly !== false ? 'checked' : ''} />
            跳过 LeetCode 会员专享题（没有会员时请勾选，避免排到做不了的题）
          </label>
        </div>
        <div class="row">
          <span class="muted">userSlug：<b class="mono">${esc(config.userSlug || '未设置')}</b></span>
          <span class="muted">最近抓取：${fmtTs(config.lastFetchAt)}</span>
        </div>
      </div>

      <div class="card">
        <h3>🗓️ 月份计划 <span class="muted" style="font-weight:400">（每个月的每日 新题/复习 数量与休息日）</span></h3>
        <div class="row" style="margin-bottom:12px">
          <label style="margin:0">年份：</label>
          <input type="number" id="planYear" value="${year}" style="width:90px" min="2024" max="2035" />
          <button class="btn-sm" data-act="yearGo">切换</button>
          <button class="btn-sm" data-act="resetAll" style="margin-left:auto">恢复全部内置默认</button>
          <button class="btn-sm" data-act="applyPreset">应用 9/10/11 月冲刺预设</button>
        </div>
        <div class="muted" style="margin-bottom:10px">
          内置预设：9月（冲刺预热）新 2 + 复习 3，周日休 · 10月（笔试面试高峰）新 1~2 + 复习 3~4，周日休 · 11月（以复习为主）新 0~1 + 复习 3~5，周日休 · 其余月份默认 新 1 + 复习 2~3，周末休。
          数量为区间时每天在该区间内随机取值。
        </div>
        <table class="tbl">
          <thead><tr><th>月份</th><th>启用</th><th>新题（最小/最大）</th><th>复习（最小/最大）</th><th>休息日</th></tr></thead>
          <tbody>
            ${months.map(mo => `
              <tr data-mk="${mo.mk}">
                <td><b>${mo.m} 月</b><div class="muted" style="font-size:10.5px">${mo.mk}</div></td>
                <td>
                  <label class="switch"><input type="checkbox" data-f="enabled" ${mo.def.enabled ? 'checked' : ''} /><span class="track"></span></label>
                </td>
                <td>
                  <input type="number" data-f="newMin" value="${mo.def.newMin}" min="0" max="10" style="width:54px" /> ~
                  <input type="number" data-f="newMax" value="${mo.def.newMax}" min="0" max="10" style="width:54px" />
                </td>
                <td>
                  <input type="number" data-f="reviewMin" value="${mo.def.reviewMin}" min="0" max="15" style="width:54px" /> ~
                  <input type="number" data-f="reviewMax" value="${mo.def.reviewMax}" min="0" max="15" style="width:54px" />
                </td>
                <td>
                  <div class="row" style="gap:2px" data-f="restWeekdays">
                    ${['日','一','二','三','四','五','六'].map((w, i) => `
                      <label style="margin:0;font-size:11px;cursor:pointer">
                        <input type="checkbox" data-wd="${i}" ${(mo.def.restWeekdays || []).includes(i) ? 'checked' : ''} />${w}
                      </label>`).join('')}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>🔄 定时抓取</h3>
          <div class="field">
            <label><span class="switch" style="vertical-align:-4px"><input type="checkbox" id="fetchEnabled" ${config.fetch?.enabled ? 'checked' : ''} /><span class="track"></span></label> 启用每日自动抓取</label>
            <div class="hint">每天到设定时间后自动抓取一次题单并更新记忆库（当天已抓过则跳过）</div>
          </div>
          <div class="field"><label>抓取时间</label><input type="time" id="fetchTime" value="${esc(config.fetch?.time || '08:00')}" /></div>
          <div class="field">
            <label>题单过期阈值（小时）</label>
            <input type="number" id="fetchStale" value="${config.fetch?.staleHours ?? 12}" min="1" max="168" style="width:100px" />
            <div class="hint">超过该时长未抓取时，启动应用会自动静默抓取</div>
          </div>
        </div>

        <div class="card">
          <h3>⏱️ 计时器默认</h3>
          <div class="field"><label>默认专注时长（分钟）</label><input type="number" id="timerMin" value="${config.timer?.defaultMinutes || 25}" min="1" max="180" style="width:100px" /></div>
          <div class="field"><label>默认标签</label><input type="text" id="timerTag" value="${esc(config.timer?.sessionTag || '刷题')}" style="width:180px" /></div>
        </div>
      </div>

      <div class="card" id="llmCard">
        <h3>🧠 八股评分方式 <span class="muted" style="font-weight:400">（离线相似度 / LLM 智能评分 / 不评分只看答案）</span></h3>
        <div class="field">
          <div class="seg" id="llmMode">
            <button data-mode="similarity" class="${config.llm?.mode === 'similarity' || !config.llm?.mode ? 'active' : ''}">离线相似度</button>
            <button data-mode="llm" class="${config.llm?.mode === 'llm' ? 'active' : ''}">LLM 智能评分</button>
            <button data-mode="none" class="${config.llm?.mode === 'none' ? 'active' : ''}">不评分（只看答案）</button>
          </div>
          <div class="hint">
            练习页也可随时切换。「不评分」时提交按钮变为「查看答案」，不做自动打分。LLM 失败会自动回落到离线相似度。
          </div>
          <div class="row" style="margin-top:10px">
            <label class="muted" style="cursor:pointer;display:flex;align-items:center;gap:6px">
              <input type="checkbox" id="cleanCards" ${config.llm?.cleanCards !== false ? 'checked' : ''} /> 导入时用 LLM 智能清洗/生成知识点（审阅、组合、拆分、补充）
            </label>
            <span class="muted" style="font-size:11.5px">未配置 LLM 或调用失败时自动用规则切割</span>
          </div>
        </div>

        <div id="llmCfg" class="${config.llm?.mode === 'llm' ? '' : 'hide'}">
          <div class="grid-2">
            <div class="field">
              <label>服务提供商（预设）</label>
              <div class="row" style="gap:6px;flex-wrap:wrap" id="llmPreset">
                <button class="btn-sm llm-pre" data-base="https://api.deepseek.com/v1" data-model="deepseek-chat" data-name="DeepSeek">DeepSeek（flash）</button>
                <button class="btn-sm llm-pre" data-base="https://api.openai.com/v1" data-model="gpt-4o-mini" data-name="OpenAI">OpenAI</button>
                <button class="btn-sm llm-pre" data-base="https://dashscope.aliyuncs.com/compatible-mode/v1" data-model="qwen-plus" data-name="通义千问">通义千问</button>
                <button class="btn-sm llm-pre" data-base="http://localhost:11434/v1" data-model="qwen2.5" data-name="本地Ollama">本地 Ollama</button>
              </div>
              <div class="hint">DeepSeek 默认使用 deepseek-chat（快速模型）；若要 deepseek-v4-flash 等，直接在下方「模型」栏修改。</div>
            </div>
            <div class="field"><label>API Key（仅保存在本机，不随同步上传）</label><input type="password" id="llmKey" value="${esc(llmKey)}" placeholder="sk-..." style="width:100%" /><div class="hint">DeepSeek 平台申请后复制。密钥只存本机 userData，不会同步到坚果云/其它设备。</div></div>
            <div class="field"><label>服务地址（OpenAI 兼容 baseUrl）</label><input type="text" id="llmBase" value="${esc(config.llm?.baseUrl || 'https://api.deepseek.com/v1')}" style="width:100%" /></div>
            <div class="field"><label>模型名</label><input type="text" id="llmModel" value="${esc(config.llm?.model || 'deepseek-chat')}" style="width:100%" /></div>
          </div>
          <div class="row">
            <button class="btn-primary" data-act="llmSave">保存 LLM 配置</button>
            <button class="btn-sm" data-act="llmTest">测试连接</button>
            <span class="muted" id="llmMsg"></span>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>☁️ 数据同步（WebDAV，兼容坚果云）</h3>
        <div class="field">
          <label><span class="switch" style="vertical-align:-4px"><input type="checkbox" id="syncEnabled" ${config.sync?.enabled ? 'checked' : ''} /><span class="track"></span></label> 启用自动同步（启动时 / 数据变化后 / 每 ${config.sync?.intervalMin || 30} 分钟）</label>
        </div>
        <div class="grid-2">
          <div class="field"><label>服务器地址</label><input type="url" id="syncServer" value="${esc(config.sync?.server || 'https://dav.jianguoyun.com/dav')}" placeholder="https://dav.jianguoyun.com/dav" /></div>
          <div class="field"><label>远程目录</label><input type="text" id="syncPath" value="${esc(config.sync?.remotePath || '/LeetCodeDailyHelper')}" placeholder="/LeetCodeDailyHelper" /></div>
          <div class="field"><label>用户名（坚果云为邮箱）</label><input type="text" id="syncUser" value="${esc(config.sync?.username || '')}" placeholder="your@email.com" /></div>
          <div class="field"><label>密码（坚果云请使用「应用密码」）</label><input type="password" id="syncPass" value="${esc(config.sync?.password || '')}" placeholder="应用专用密码" /></div>
        </div>
        <div class="field"><label>自动同步间隔（分钟）</label><input type="number" id="syncInterval" value="${config.sync?.intervalMin || 30}" min="5" max="1440" style="width:100px" /></div>
        <div class="row">
          <button class="btn-primary" data-act="syncSave">保存同步设置</button>
          <button class="btn-sm" data-act="syncTest">测试连接</button>
          <button class="btn-sm" data-act="syncNow">立即同步</button>
          <span class="muted" id="syncMsg"></span>
        </div>
        <div class="hint" style="margin-top:8px">💡 坚果云：在「账户信息 → 安全选项 → 添加应用密码」生成专用密码；多台设备使用相同的服务器地址与远程目录即可自动互相同步数据（题单缓存、记忆库、每日计划、计时记录）。</div>
      </div>

      <div class="card">
        <h3>💾 数据管理</h3>
        <div class="row">
          <span class="muted">数据目录：<b class="mono" id="dataDirShow">${esc(info.dataDir)}</b></span>
          <button class="btn-sm" data-act="openDirHint">查看/修改</button>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn-sm" data-act="export">导出备份（JSON）</button>
          <button class="btn-sm" data-act="import">导入备份</button>
          <input type="file" id="importFile" accept=".json" class="hide" />
          <span class="muted" id="dataMsg"></span>
        </div>
        <div class="hint" style="margin-top:8px">导出/导入用于手动迁移或换机；开启同步后一般无需手动操作。修改数据目录会把全部数据迁移到新目录。</div>
      </div>

      <div class="card">
        <h3>ℹ️ 关于</h3>
        <div class="muted" style="line-height:1.8">
          版本 ${esc(info.version)} · 平台 ${esc(info.platform)}<br>
          数据来源：LeetCode 中国站公开接口（用户资料 / 公开题单 / 题单题目）。题目跳转使用系统浏览器打开。<br>
          记忆机制：按题号去重记录「首次出现 / 排期次数 / 完成次数 / 上次复习」，同一题重复出现在不同题单会自动归入复习，避免被当作新题。
        </div>
      </div>
    `;

    this.bind(container, months, config);
  },

  bind(container, months, config) {
    // 主题切换
    const themeSel = container.querySelector('#themeSel');
    if (themeSel) themeSel.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
      themeSel.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const t = b.dataset.theme;
      await window.lcAPI.saveConfig({ ui: Object.assign({}, (config.ui || {}), { theme: t }) });
      if (window.APP && window.APP.setTheme) window.APP.setTheme(t);
      APP.metaCache.invalidate();
      toast('已切换主题：' + (t === 'dark' ? '深色' : t === 'light' ? '浅色' : '跟随系统'), 'success');
    }));

    // 保存通用配置
    const saveCommon = async () => {
      const cfg = {
        profileUrl: container.querySelector('#cfgProfileUrl').value.trim(),
        scheduleStart: container.querySelector('#cfgStart').value || '2026-09-01',
        skipPaidOnly: container.querySelector('#skipPaid') ? container.querySelector('#skipPaid').checked : true,
        fetch: {
          enabled: container.querySelector('#fetchEnabled').checked,
          time: container.querySelector('#fetchTime').value || '08:00',
          staleHours: Number(container.querySelector('#fetchStale').value) || 12,
        },
        timer: {
          defaultMinutes: Number(container.querySelector('#timerMin').value) || 25,
          sessionTag: container.querySelector('#timerTag').value.trim() || '刷题',
        },
      };
      await window.lcAPI.saveConfig(cfg);
      APP.metaCache.invalidate();
    };

    container.querySelector('#cfgProfileUrl').addEventListener('change', saveCommon);
    container.querySelector('#cfgStart').addEventListener('change', saveCommon);
    const skipPaidEl = container.querySelector('#skipPaid');
    if (skipPaidEl) skipPaidEl.addEventListener('change', saveCommon);

    container.querySelector('#planYear').addEventListener('change', () => {
      const y = Number(container.querySelector('#planYear').value);
      if (y >= 2024 && y <= 2035) { this.year = y; this.render(container); }
    });
    container.querySelector('[data-act=yearGo]').addEventListener('click', () => {
      const y = Number(container.querySelector('#planYear').value);
      if (y >= 2024 && y <= 2035) { this.year = y; this.render(container); }
    });

    const monthCfg = (tr) => {
      const enabled = tr.querySelector('[data-f=enabled]').checked;
      const newMin = Number(tr.querySelector('[data-f=newMin]').value) || 0;
      const newMax = Number(tr.querySelector('[data-f=newMax]').value) || 0;
      const reviewMin = Number(tr.querySelector('[data-f=reviewMin]').value) || 0;
      const reviewMax = Number(tr.querySelector('[data-f=reviewMax]').value) || 0;
      const restWeekdays = [...tr.querySelectorAll('[data-f=restWeekdays] input:checked')].map(i => Number(i.dataset.wd));
      return { enabled, newMin, newMax, reviewMin, reviewMax, restWeekdays };
    };
    let saveMonthTimer = null;
    const saveMonths = async () => {
      const monthPlans = {};
      container.querySelectorAll('tr[data-mk]').forEach(tr => {
        monthPlans[tr.dataset.mk] = monthCfg(tr);
      });
      await window.lcAPI.saveConfig({ monthPlans });
      APP.metaCache.invalidate();
      toast('月份计划已保存', 'success', 1500);
    };
    container.querySelectorAll('tr[data-mk]').forEach(tr => {
      tr.addEventListener('change', () => {
        clearTimeout(saveMonthTimer);
        saveMonthTimer = setTimeout(saveMonths, 500);
      });
    });
    container.querySelector('[data-act=resetAll]').addEventListener('click', async () => {
      if (!(await confirmDlg('恢复默认', '清除所有月份的个性化设置，恢复内置默认节奏（9/10/11 月冲刺预设除外）。'))) return;
      await window.lcAPI.saveConfig({ monthPlans: {} });
      APP.metaCache.invalidate();
      this.render(container);
    });
    container.querySelector('[data-act=applyPreset]').addEventListener('click', async () => {
      const monthPlans = {};
      container.querySelectorAll('tr[data-mk]').forEach(tr => {
        const mk = tr.dataset.mk;
        if (mk.endsWith('-09')) monthPlans[mk] = { enabled: true, newMin: 2, newMax: 2, reviewMin: 3, reviewMax: 3, restWeekdays: [0] };
        else if (mk.endsWith('-10')) monthPlans[mk] = { enabled: true, newMin: 1, newMax: 2, reviewMin: 3, reviewMax: 4, restWeekdays: [0] };
        else if (mk.endsWith('-11')) monthPlans[mk] = { enabled: true, newMin: 0, newMax: 1, reviewMin: 3, reviewMax: 5, restWeekdays: [0] };
        else monthPlans[mk] = monthCfg(tr);
      });
      await window.lcAPI.saveConfig({ monthPlans });
      APP.metaCache.invalidate();
      toast('已应用 9/10/11 月冲刺预设（其余月份保留当前设置）', 'success');
      this.render(container);
    });

    // 抓取与计时
    ['#fetchEnabled', '#fetchTime', '#fetchStale'].forEach(sel => {
      container.querySelector(sel).addEventListener('change', saveCommon);
    });
    ['#timerMin', '#timerTag'].forEach(sel => {
      container.querySelector(sel).addEventListener('change', saveCommon);
    });

    // 八股评分方式
    const llmMode = container.querySelector('#llmMode');
    const llmCfg = container.querySelector('#llmCfg');
    const saveLlm = async () => {
      const cfg = {
        mode: llmMode.querySelector('button.active')?.dataset.mode || 'similarity',
        provider: container.querySelector('.llm-pre.on')?.dataset.name || 'deepseek',
        baseUrl: container.querySelector('#llmBase').value.trim() || 'https://api.deepseek.com/v1',
        model: container.querySelector('#llmModel').value.trim() || 'deepseek-chat',
        timeout: 45,
        cleanCards: container.querySelector('#cleanCards')?.checked !== false,
      };
      await window.lcAPI.saveConfig({ llm: cfg });
      await window.lcAPI.setLlmKey(container.querySelector('#llmKey').value.trim());
      APP.metaCache.invalidate();
      return cfg;
    };
    llmMode.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
      llmMode.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      llmCfg.classList.toggle('hide', b.dataset.mode !== 'llm');
      await saveLlm();
      toast('已切换评分方式', 'success');
    }));
    container.querySelectorAll('.llm-pre').forEach(b => b.addEventListener('click', () => {
      container.querySelectorAll('.llm-pre').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      container.querySelector('#llmBase').value = b.dataset.base;
      container.querySelector('#llmModel').value = b.dataset.model;
    }));
    container.querySelector('[data-act=llmSave]').addEventListener('click', async () => {
      await saveLlm();
      const m = container.querySelector('#llmMsg');
      m.textContent = '✓ 已保存（API Key 仅在本机）';
      setTimeout(() => m.textContent = '', 2500);
    });
    container.querySelector('[data-act=llmTest]').addEventListener('click', async () => {
      const m = container.querySelector('#llmMsg');
      const cfg = {
        baseUrl: container.querySelector('#llmBase').value.trim(),
        model: container.querySelector('#llmModel').value.trim(),
        apiKey: container.querySelector('#llmKey').value.trim(),
        timeout: 45,
      };
      m.textContent = '测试中…';
      const r = await window.lcAPI.testLlm(cfg);
      m.textContent = r.ok ? '✓ ' + r.msg + (r.reply ? '（' + r.reply + '）' : '') : '✗ ' + r.error;
      toast(r.ok ? 'LLM 连接成功' : 'LLM 测试失败：' + r.error, r.ok ? 'success' : 'error');
    });

    // 同步
    const syncCfg = () => ({
      enabled: container.querySelector('#syncEnabled').checked,
      server: container.querySelector('#syncServer').value.trim(),
      username: container.querySelector('#syncUser').value.trim(),
      password: container.querySelector('#syncPass').value,
      remotePath: container.querySelector('#syncPath').value.trim() || '/LeetCodeDailyHelper',
      intervalMin: Number(container.querySelector('#syncInterval').value) || 30,
    });
    container.querySelector('[data-act=syncSave]').addEventListener('click', async () => {
      await window.lcAPI.saveConfig({ sync: syncCfg() });
      APP.metaCache.invalidate();
      const msg = container.querySelector('#syncMsg');
      msg.textContent = '已保存 ✓';
      setTimeout(() => msg.textContent = '', 2000);
    });
    container.querySelector('[data-act=syncTest]').addEventListener('click', async () => {
      const msg = container.querySelector('#syncMsg');
      const cfg = syncCfg();
      if (!cfg.server || !cfg.username) { msg.textContent = '✗ 配置不完整：请先填写服务器地址与用户名'; toast('请先填写服务器地址与用户名', 'error'); return; }
      msg.textContent = '测试中…';
      const r = await window.lcAPI.testSync({ sync: cfg });
      msg.textContent = r.ok ? '✓ ' + r.msg : '✗ ' + r.error;
      toast(r.ok ? '同步连接成功' : '连接失败：' + r.error, r.ok ? 'success' : 'error');
      if (r.ok) msg.textContent += '（可点「保存同步设置」启用）';
    });
    container.querySelector('[data-act=syncNow]').addEventListener('click', async () => {
      const msg = container.querySelector('#syncMsg');
      const cfg = syncCfg();
      if (!cfg.server || !cfg.username) {
        msg.textContent = '✗ 配置不完整：请先填写服务器地址与用户名';
        toast('请先填写服务器地址与用户名', 'error');
        return;
      }
      cfg.enabled = true; // 手动立即同步视为启用
      msg.textContent = '正在保存并同步…';
      try {
        await window.lcAPI.saveConfig({ sync: cfg });
        APP.metaCache.invalidate();
      } catch (e) { msg.textContent = '✗ 保存失败：' + e.message; return; }
      const r = await window.lcAPI.syncNow();
      if (r.ok) {
        msg.textContent = `✓ 完成（拉取 ${r.pulled}，推送 ${r.pushed}${r.failed && r.failed.length ? '，失败 ' + r.failed.length : ''}）`;
        if (r.failed && r.failed.length) toast('部分文件同步失败：' + r.failed.join('；'), 'error');
        else toast('同步完成', 'success');
      } else {
        msg.textContent = '✗ ' + (r.error || '失败');
        toast('同步失败：' + (r.error || '未知错误'), 'error');
      }
      setTimeout(() => { if (msg.textContent !== '') msg.textContent = ''; }, r.ok ? 5000 : 8000);
    });

    // 数据
    container.querySelector('[data-act=openDirHint]').addEventListener('click', async () => {
      const cur = await window.lcAPI.getDataDir();
      const v = await openModal({
        title: '修改数据目录',
        body: `
          <div class="field"><label>数据目录绝对路径</label>
            <input type="text" id="newDir" value="${esc(cur)}" style="width:100%" />
            <div class="hint">将全部数据（题单缓存/记忆库/计划/计时记录）迁移到新目录；若放在 OneDrive/坚果云同步盘等本地同步目录中，也可实现系统级同步。</div>
          </div>`,
        okText: '迁移到此目录',
        onOk: (body) => body.querySelector('#newDir').value.trim() || false,
      });
      if (v && v !== 'ok') {
        try {
          await window.lcAPI.setDataDir(v);
          toast('数据已迁移，应用数据目录已更新', 'success');
          this.render(container);
        } catch (e) { toast('迁移失败：' + e.message, 'error'); }
      }
    });
    container.querySelector('[data-act=export]').addEventListener('click', async () => {
      const json = await window.lcAPI.exportData();
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `leetcode-daily-backup-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('已导出备份', 'success');
    });
    container.querySelector('[data-act=import]').addEventListener('click', () => {
      container.querySelector('#importFile').click();
    });
    container.querySelector('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!(await confirmDlg('导入备份', `将覆盖当前全部数据（会先自动备份到数据目录的 backup-时间戳 文件夹）。确定导入「${esc(file.name)}」？`, '导入'))) return;
      try {
        const text = await file.text();
        const r = await window.lcAPI.importData(text);
        APP.metaCache.invalidate();
        const msg = container.querySelector('#dataMsg');
        msg.textContent = `✓ 已导入 ${r.imported.length} 个文件（原数据备份于 ${r.backupDir}）`;
        this.render(container);
      } catch (err) { toast('导入失败：' + err.message, 'error'); }
      e.target.value = '';
    });
  },
};
