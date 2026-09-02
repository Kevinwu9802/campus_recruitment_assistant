'use strict';
/* timer.js — 专注计时器（协助在设定时间内完成当日题量） */
window.PageTimer = {
  state: {
    total: null, remain: null, running: false, finished: false,
    tag: '刷题', timerId: null, startTs: null, _inited: false,
  },

  async render(container) {
    const config = await APP.metaCache.configData();
    // 仅在首次进入时初始化默认时长；此后用户选择/填写的时长不再被重置
    if (!this.state._inited) {
      this.state.total = (config.timer?.defaultMinutes || 25) * 60;
      this.state.remain = this.state.total;
      this.state.tag = config.timer?.sessionTag || '刷题';
      this.state._inited = true;
    }
    if (this.state.remain == null) this.state.remain = this.state.total;
    const stats = await window.lcAPI.getStats();
    const sessions = await window.lcAPI.getSessions();
    const todayCount = sessions.filter(s => s.finished && (s.endTs || '').startsWith(todayStr())).length;

    container.innerHTML = `
      <div class="page-title">专注计时</div>
      <div class="page-sub">设定一个时间块，保持专注完成当日题量 · 完成时会有提示音与系统通知</div>

      <div class="card" style="max-width:640px;margin:0 auto">
        <div class="timer-wrap">
          <div class="timer-ring">
            <svg width="300" height="300" viewBox="0 0 300 300">
              <circle class="ring-bg" cx="150" cy="150" r="132" fill="none" stroke-width="12" />
              <circle class="ring-fg" id="ringFg" cx="150" cy="150" r="132" fill="none" stroke-width="12"
                stroke-dasharray="829.4" stroke-dashoffset="0" />
            </svg>
            <div class="timer-time">
              <div class="t" id="timerT">${this.fmt(this.state.remain)}</div>
              <div class="st" id="timerSt">${this.state.finished ? '本段时间完成 🎉' : (this.state.running ? '专注中…' : '准备就绪')}</div>
            </div>
          </div>

          <div class="timer-state" id="timerState">
            ${this.state.running
              ? `⏳ 已专注 ${this.fmt(this.state.total - this.state.remain)}，目标 ${Math.round(this.state.total / 60)} 分钟`
              : `设定目标时长后开始，完成后自动记录到统计`}
          </div>

          <div class="row" style="justify-content:center;margin-bottom:14px">
            <div class="seg" id="durSeg">
              ${[15, 25, 45, 60].map(m => `<button data-min="${m}" class="${this.state.total === m * 60 && !this.state.running ? 'active' : ''}">${m}分</button>`).join('')}
              <input type="number" id="customMin" min="1" max="180" placeholder="自定义" style="width:86px;border:none;border-radius:0" />
            </div>
          </div>
          <div class="row" style="justify-content:center;gap:10px">
            <input type="text" id="tagInput" placeholder="本次标签（如：二叉树）" value="${esc(this.state.tag)}" style="width:180px" ${this.state.running ? 'disabled' : ''} />
            <button class="btn-primary" id="btnMain">${this.state.running ? '暂停' : (this.state.finished ? '再来一轮' : '开始')}</button>
            <button id="btnReset" class="${this.state.running ? '' : 'hide'}">重置</button>
          </div>
        </div>
      </div>

      <div class="card" style="max-width:640px;margin:14px auto 0">
        <h3>今日专注 <span class="muted" style="font-weight:400">（共 ${todayCount} 个时间段，${stats.todayFocusMin} 分钟）</span></h3>
        <div class="muted">提示：开始计时后，建议把本窗口最小化、用系统浏览器打开题目专心做题。</div>
      </div>
    `;

    this.bind(container);
    this.updateRing();
  },

  bind(container) {
    container.querySelectorAll('#durSeg [data-min]').forEach(b => b.addEventListener('click', () => {
      if (this.state.running) return;
      this.state.total = Number(b.dataset.min) * 60;
      this.state.remain = this.state.total;
      this.state.finished = false;
      this.render(container);
    }));
    const custom = container.querySelector('#customMin');
    custom.addEventListener('change', () => {
      const m = Number(custom.value);
      if (m >= 1 && m <= 180) {
        this.state.total = m * 60; this.state.remain = m * 60; this.state.finished = false;
        this.render(container);
      }
    });
    const tagInput = container.querySelector('#tagInput');
    tagInput.addEventListener('input', () => { this.state.tag = tagInput.value.trim() || '刷题'; });

    container.querySelector('#btnMain').addEventListener('click', () => {
      if (this.state.finished) {
        this.state.finished = false;
        this.state.remain = this.state.total;
        this.start();
      } else if (this.state.running) {
        this.pause();
      } else {
        this.start();
      }
    });
    container.querySelector('#btnReset').addEventListener('click', () => {
      this.stopTimer();
      this.state.running = false; this.state.finished = false;
      this.state.remain = this.state.total;
      this.render(container);
    });
  },

  start() {
    if (this.state.running) return;
    this.state.running = true;
    this.state.startTs = new Date().toISOString();
    try { this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    const container = document.getElementById('content');
    const tick = () => {
      if (!this.state.running) return;
      this.state.remain--;
      const t = document.getElementById('timerT');
      const st = document.getElementById('timerSt');
      if (t) t.textContent = this.fmt(this.state.remain);
      if (st) st.textContent = '专注中…';
      this.updateRing();
      if (this.state.remain <= 0) {
        this.finish();
        return;
      }
      this.state.timerId = setTimeout(tick, 1000);
    };
    this.state.timerId = setTimeout(tick, 1000);
    this.updateBtns(container);
  },

  pause() {
    this.state.running = false;
    if (this.state.timerId) clearTimeout(this.state.timerId);
    this.updateBtns(document.getElementById('content'));
  },

  async finish() {
    this.state.running = false;
    this.state.finished = true;
    if (this.state.timerId) clearTimeout(this.state.timerId);
    const endTs = new Date().toISOString();
    const durationMin = Math.max(1, Math.round((this.state.total) / 60));
    try {
      await window.lcAPI.addSession({
        startTs: this.state.startTs || endTs, endTs, durationMin, finished: true, tag: this.state.tag,
      });
    } catch (e) {}
    this.beep();
    try {
      // 系统通知（Electron 主进程 Notification）
      if (window.lcAPI && window.lcAPI.notify) window.lcAPI.notify('专注完成 🎉', `「${this.state.tag}」${durationMin} 分钟，休息一下或继续下一题`);
    } catch (e) {}
    const container = document.getElementById('content');
    const t = document.getElementById('timerT');
    const st = document.getElementById('timerSt');
    if (t) t.textContent = this.fmt(0);
    if (st) st.textContent = '本段时间完成 🎉';
    this.updateRing();
    this.updateBtns(container);
    toast(`专注完成！已记录 ${durationMin} 分钟`, 'success');
  },

  stopTimer() { if (this.state.timerId) clearTimeout(this.state.timerId); this.state.timerId = null; },

  updateBtns(container) {
    const main = container.querySelector('#btnMain');
    const reset = container.querySelector('#btnReset');
    if (main) main.textContent = this.state.running ? '暂停' : (this.state.finished ? '再来一轮' : '开始');
    if (reset) reset.classList.toggle('hide', !this.state.running);
  },

  updateRing() {
    const fg = document.getElementById('ringFg');
    if (!fg) return;
    const total = this.state.total || 1;
    const offset = 829.4 * (1 - this.state.remain / total);
    fg.style.strokeDashoffset = offset;
  },

  fmt(sec) {
    sec = Math.max(0, sec);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  },

  beep() {
    try {
      const ctx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.5);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.6);
      });
    } catch (e) {}
  },
};
