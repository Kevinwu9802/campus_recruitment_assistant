'use strict';
/**
 * web-render.js — 用隐藏 Electron 窗口渲染网页（支持 SPA/JS 渲染），取正文与标题。
 * 仅在有 Electron 环境时可用；纯 Node（单元测试）下不创建窗口，由调用方回落 fetch。
 * 深入抓取时复用同一个窗口依次导航，显著提速。
 */
const { BrowserWindow } = require('electron');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const isElectron = () => !!(typeof process !== 'undefined' && process.versions && process.versions.electron);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EXTRACT_JS = `(function(){
  function txt(el){ return el ? (el.innerText || '') : ''; }
  var sels = ['main','article','[role=main]','.article-content','.content','.post-content','.markdown-body','#content','#__content','#__nuxt'];
  var best=null, bestLen=-1;
  for (var i=0;i<sels.length;i++){ var el=document.querySelector(sels[i]); if(el){ var t=txt(el); if(t.length>bestLen){best=t; bestLen=t.length;} } }
  var text = (best && bestLen>40) ? best : txt(document.body);
  var links = Array.prototype.map.call(document.querySelectorAll('a[href]'), function(a){ return a.href; }).filter(Boolean);
  return { title: document.title||'', text: text, links: links };
})()`;

function createWin() {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 1600,
    webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return win;
}

async function loadInto(win, url, { settleMs = 3500, timeoutMs = 28000 } = {}) {
  await Promise.race([
    win.loadURL(url, { userAgent: UA, referrer: 'https://leetcode.cn/' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('加载超时 ' + timeoutMs + 'ms')), timeoutMs)),
  ]);
  await sleep(settleMs);
  const data = await win.webContents.executeJavaScript(EXTRACT_JS);
  return { title: String(data.title || ''), text: String(data.text || ''), links: data.links || [] };
}

/** 渲染单个页面，返回 {title, text, links}。失败抛错。 */
async function renderPage(url, opts = {}) {
  const win = createWin();
  try {
    let lastErr;
    for (let i = 0; i < 2; i++) {
      try { return await loadInto(win, url, opts); }
      catch (e) { lastErr = e; await sleep(1200); }
    }
    throw lastErr;
  } finally {
    try { win.destroy(); } catch (e) {}
  }
}

/** 渲染主页面；可选：深入抓取同站子页面（目录/列表页）。返回 [{url,title,text}]。
 *  maxCrawl=0 表示「应抓尽抓」（抓取该页发现的所有同站内容页）；>0 则为上限。 */
async function renderPageDeep(url, { crawl = false, maxCrawl = 0, settleMs = 3500, onProgress } = {}) {
  const win = createWin();
  try {
    let main;
    try { main = await loadInto(win, url, { settleMs }); }
    catch (e) { throw e; }
    const origin = new URL(url).origin;
    const dir = new URL(url).pathname.replace(/[^/]*$/, '');
    const pages = [{ url, title: main.title || url, text: main.text }];
    if (!crawl || !main.links || !main.links.length) return pages;

    const seen = new Set([url]);
    let candidates = main.links
      .map(h => { try { return new URL(h.split('#')[0]).href; } catch { return ''; } })
      .filter(h => h && h.startsWith(origin) && !seen.has(h))
      .filter(h => /\.html$/.test(h) || new URL(h).pathname.startsWith(dir)) // 看重内容页（.html 或同目录）
      .filter((h, i, arr) => arr.indexOf(h) === i);
    if (maxCrawl > 0) candidates = candidates.slice(0, maxCrawl);
    pages.hub = candidates.length > 5; // 典型的目录/列表首页（应跳过其自身目录文本）

    if (onProgress) onProgress(`共发现 ${candidates.length} 个子页面，开始逐一抓取…`);
    let n = 0, ok = 0;
    for (const link of candidates) {
      if (seen.has(link)) continue;
      seen.add(link);
      n++;
      if (onProgress) onProgress(`抓取子页 ${n}/${candidates.length}…`);
      try {
        const p = await loadInto(win, link, { settleMs: 2500, timeoutMs: 20000 });
        if (p.text && p.text.replace(/\s+/g, '').length > 60) { pages.push({ url: link, title: p.title || link, text: p.text }); ok++; }
      } catch (e) { /* 单个子页失败忽略 */ }
    }
    if (onProgress) onProgress(`完成：成功抓取 ${ok} 页 / 共 ${candidates.length} 页`);
    return pages;
  } finally {
    try { win.destroy(); } catch (e) {}
  }
}

module.exports = { renderPage, renderPageDeep, isElectron };
