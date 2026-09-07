'use strict';
/**
 * GUI 冒烟测试：在无显示环境下启动完整应用
 *   electron scripts/gui-smoke.js
 * 验证：窗口创建 → 页面加载 → preload API 注入 → IPC 往返 → 页面渲染 → 截图
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-gui-test-'));
app.setPath('userData', tmpData);

const store = require('../main/store');
const { registerIpc } = require('../main/ipc');
store.init(path.join(tmpData, 'data'));
const cfg = store.get('config');
cfg.userSlug = 'kevinwu-z';
cfg.fetch.enabled = false; // 测试期间不自动抓取
store.set('config', cfg);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}

app.whenReady().then(async () => {
  let win = null;
  registerIpc({
    win: () => win,
    broadcast: () => {},
    notify: () => {},
  });
  win = new BrowserWindow({
    width: 1240, height: 820, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });

  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await new Promise(r => setTimeout(r, 1500));

    // 1. preload API 注入
    const api = await win.webContents.executeJavaScript('Object.keys(window.lcAPI || {}).length');
    check('preload API 注入', api > 20, `${api} 个方法`);

    // 2. 路由渲染（默认跳转今日计划）
    const title = await win.webContents.executeJavaScript('document.querySelector(".page-title")?.textContent || ""');
    check('路由渲染', /今日|计划/.test(title), title);

    // 3. IPC：今日计划生成（含真实排期）
    const today = new Date();
    const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const plan = await win.webContents.executeJavaScript(`window.lcAPI.getPlan('${ds}').then(p => ({rest: p.rest, items: p.items.length, newC: p.newCount, revC: p.reviewCount, note: p.note}))`);
    check('IPC 生成今日计划', typeof plan.items === 'number', `新${plan.newC} 复习${plan.revC} 共${plan.items} ${plan.note || ''}`);

    // 4. IPC：统计
    const stats = await win.webContents.executeJavaScript('window.lcAPI.getStats().then(s => s.total)');
    check('IPC 统计', typeof stats === 'number', `记忆库 ${stats} 题`);

    // 5. 逐页渲染（每个页面无异常）
    const pages = ['today', 'calendar', 'lists', 'history', 'bawen', 'stats', 'timer', 'settings'];
    for (const p of pages) {
      const ok = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            location.hash = '#/${p}';
            await new Promise(r => setTimeout(r, 700));
            return document.querySelector('#content').innerHTML.length > 50;
          } catch (e) { return false; }
        })()
      `);
      check(`页面渲染 #/${p}`, ok);
    }

    // 5b. 导航可用性 + 未来日期占位（bug 1/2 回归）
    const navTest = await win.webContents.executeJavaScript(`
      (async () => {
        const t = new Date(); t.setDate(t.getDate() + 1);
        const ds = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
        location.hash = '#/today?date=' + ds;
        await new Promise(r => setTimeout(r, 900));
        const placeholder = document.body.textContent.includes('将在当天自动生成');
        const nav = !!document.querySelector('[data-act=prev]') && !!document.querySelector('[data-act=next]');
        // 导航到明天后，尝试点「前一天」（应能回到今天）
        const backBtn = document.querySelector('[data-act=prev]');
        if (backBtn) backBtn.click();
        await new Promise(r => setTimeout(r, 900));
        const backWorks = /今日计划|每日计划/.test(document.querySelector('.page-title')?.textContent || '');
        return { placeholder, nav, backWorks };
      })()
    `);
    check('未来日期只展示占位', navTest.placeholder);
    check('导航按钮在非当天仍可用', navTest.nav && navTest.backWorks);

    // 6. 截图
    try {
      const img = await win.webContents.capturePage();
      const out = path.join(os.tmpdir(), 'lc-gui-smoke.png');
      fs.writeFileSync(out, img.toPNG());
      check('页面截图', true, out);
    } catch (e) { check('页面截图', false, e.message); }
  } catch (e) {
    check('整体流程', false, e.message);
    console.error(e);
  }

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${failed === 0 ? '✅ GUI 冒烟测试全部通过' : '❌ ' + failed + ' 项失败'}`);
  app.exit(failed === 0 ? 0 : 1);
});
