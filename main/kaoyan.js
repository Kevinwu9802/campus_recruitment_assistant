'use strict';
/**
 * kaoyan.js — 八股文学习/复习引擎
 *
 * 职责：
 *  - 解析本地文件（PDF / Word(.docx) / txt / md）与网址，抽取纯文本。
 *  - 将文本切分成「知识点卡」：题目(知识点标题/生成)、答案(内容)、出处(来源)。
 *  - 自动评分：字符二元组 Jaccard + 覆盖率 给 0~100 分（无需联网/无需 LLM）。
 *
 * 数据全部存放在 store 的 `kaoyan` 数据文件中，随项目其它数据一起走 WebDAV 多端同步。
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');
const llm = require('./llm');
const webRender = require('./web-render');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 LeetCodeDailyHelper/1.0';

// ---------------- 来源解析 ----------------

async function extractFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ path: filePath });
    return { text: r.value || '', format: 'docx' };
  }
  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    try {
      const d = await parser.getText();
      return { text: d.text || '', format: 'pdf' };
    } finally {
      await parser.destroy();
    }
  }
  if (ext === '.txt' || ext === '.md' || ext === '.markdown' || ext === '') {
    return { text: fs.readFileSync(filePath, 'utf8'), format: (ext || '.txt').slice(1) };
  }
  throw new Error('暂不支持该文件类型：' + (ext || '(无扩展名)') + '（支持 .pdf / .docx / .txt / .md）');
}

/** fetch 回退方案（非 Electron 环境 / 渲染失败时用）。返回 {title, text} 单页。 */
async function extractUrlFetch(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
    return { title: title || url, text: htmlToText(html) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * 抓取网页（返回 {title, pages:[{url,title,text}]}）。
 * 优先用隐藏窗口渲染 SPA（Electron 内）；渲染失败回落到 fetch。
 * crawl=true 时深入抓取同站子页面。
 */
async function extractWeb(url, opts = {}) {
  if (webRender.isElectron()) {
    try {
      const pages = await webRender.renderPageDeep(url, {
        crawl: !!opts.crawl, maxCrawl: opts.crawlMax || 0, settleMs: 4000, onProgress: opts.onProgress,
      });
      const mainText = pages[0] ? pages[0].text : '';
      if (pages.length && mainText.replace(/\s+/g, '').length >= 40) {
        return { title: pages[0].title || url, pages };
      }
      throw new Error('渲染后无正文（可能为空壳/需登录/需 JS 交互）');
    } catch (e) {
      // 渲染失败 → 回落到静态 fetch
    }
  }
  const one = await extractUrlFetch(url);
  return { title: one.title, pages: [{ url, title: one.title, text: one.text }] };
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;|&#38;/g, '&')
    .replace(/&lt;|&#60;/g, '<')
    .replace(/&gt;|&#62;/g, '>')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&mdash;|&ndash;/g, '-')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n');
}

// ---------------- 知识切分 ----------------

function isHeading(line) {
  const s = line.trim();
  if (!s) return false;
  if (s.length > 34) return false;
  if (/[。！？；，:：．,，]$/.test(s)) return false;      // 句子/列点结尾 → 正文
  if (/^[-*•·‣]/.test(s)) return false;                 // 列表占位符 → 正文
  if (/^\d+[.)、,，]/.test(s)) return false;            // 1. / 2、 → 列表项，正文
  if (/^(http|www\.|ftp)/i.test(s)) return false;
  return true;
}

function makeTopic(content) {
  const c = (content || '').replace(/\s+/g, ' ').trim();
  if (!c) return '知识点';
  const m = c.match(/^([^。！？]{2,40})[。！？]?/);
  const first = (m ? m[1] : c.slice(0, 36)).trim();
  return /(什么是|区别|为什么|如何|请|简述|解释|原理|过程|流程|步骤|有哪些|哪些|关系|定义)$/.test(first) ? first : `请说明：${first}`;
}

// ---- 知识卡过滤：去掉导航/营销/元信息等非八股内容 ----

const TOPIC_JUNK = /^(首页|目录|大纲|更多|返回|详情|公告|通知|汇总|合集|导航|专栏|秋招|春招|投递|简历|内推|代码随想录|全部|分类|标签|简介|摘要|概述|说明|详细回答|简要回答|参考答案|完整回答|解析|结论|总结|答案|思路|示例|注意|更新|发布时间|作者|编辑|排版|阅读量|微信|QQ|邮箱|联系|客服|登录|注册|下载|收藏|分享|打印|字体|主题|模式|深色|浅色|设置|反馈|帮助|教程|文档|手册|指南|资源|素材|案例|工具包|模板下载|更多文章|下一篇|上一篇|返回顶部|Copyright|广告|订阅|关注|收藏夹|专题|精选|推荐|热门|最新|点击|查看全部|更多内容|联系方式|免责声明|版权声明|新窗口|opens new window|$)/;
const CHROME_RE = /公众号@|扫码关注|关注公众号|点击关注|全文\s*\d+\s*字|阅读原文|点赞|在看|长按识别|点个关注|点个在看|感谢阅读|若有帮助|更多精彩|往期精彩|免责声明|图片来源|版权归|未经授权|右下角|设置星标|商务合作|分享给|点个赞|欢迎关注|写作不易|一键三连|欢迎转发|点赞收藏|关注我们|公众号后台|后台回复|招聘|投递|简历|求职|内推|秋招|春招|岗位|免费|优惠|便捷|等你来|持续更新|薪资|待遇|面试邀请|独特功能|轻松管理|下载APP|opens new window|新窗口|阅读量|阅读\s*\d+|发布于|首发于|报名|抽奖|投票|培训|课程|团购|拼团|领券|红包/;
/** 页面标题是否是非八股页（招聘/营销/网站功能页），命中则整页丢弃 */
function isNonKnowledgePage(title) {
  return /招聘|投递|简历|求职|秋招|春招|内推|面经|免费|课程|培训|报名|抽奖|投票|联系方式|关于我们|帮助中心|用户协议|隐私政策|友情链接|登录|注册|下载|广告|网站公告|活动|招聘信息/.test(title || '');
}

function normLike(s) { return String(s || '').toLowerCase().replace(/[\s\u3000，。！？、；：（）【】《》…—·,.!?;:()"'“”‘’\-_/\\]/g, ''); }

function isJunkCard(topic, content) {
  const t = (topic || '').trim();
  const c = (content || '').trim();
  const tc = c.replace(/\s+/g, '');
  if (!tc) return true;                                    // 空答案
  if (tc.length < 14) return true;                         // 过短，不像答案
  if (tc.length < 80 && normLike(c) === normLike(t) && tc.length <= t.replace(/\s+/g, '').length + 4) return true; // 答案只是重复题目（无实质解释）
  if (TOPIC_JUNK.test(t)) return true;                     // 题目是导航/营销/元信息词（完整匹配）
  if (CHROME_RE.test(t) || CHROME_RE.test(c)) return true; // 题目或内容是页脚/营销套路语
  if (/^阅读更多|阅读全文|查看原文|展开全文|收起|展开$/.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true;          // 日期
  if (t.replace(/[#\s]/g, '').length < 2) return true;     // 过短
  return false;
}


/**
 * 切分文本为知识块：每块 {topic, content}。
 * 规则：
 *  - 短且非句子的「标题行」开启新块，其下（含跨空行的）内容归为该块答案。
 *  - 无任何标题时，按空行把整段正文拆成若干独立知识点卡。
 *  - 去掉 PDF 页码标记与孤立页码行。
 */
function chunkText(text) {
  const clean = String(text || '')
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\r/g, '');
  const lines = clean.split('\n').map(l => l.trim());
  const filtered = lines.filter(l =>
    !(/^\d{1,4}$/.test(l) && /^\d+$/.test(l)) &&          // 孤立页码
    !/^[\-=*_~··．。\.]{3,}$/.test(l)                       // 装饰分隔线（——、===、*** …）
  );
  const blocks = [];
  let heading = null;      // 当前小节标题
  let buf = [];            // 当前块内容
  let modeHead = false;    // 是否已进入标题模式（进入后空行不再分块）
  const flush = () => {
    const content = buf.join('\n').trim();
    if (heading || content) blocks.push({ topic: heading || null, content });
    heading = null; buf = [];
  };
  for (const ln of filtered) {
    if (!ln) {
      // 空行：已进入标题模式则忽略（内容继续归标题）；否则结束当前正文块
      if (!modeHead && buf.length) flush();
      continue;
    }
    if (isHeading(ln)) {
      flush();
      heading = ln;
      modeHead = true;
      continue;
    }
    buf.push(ln);
  }
  flush();
  // 过滤：地址/营销等非八股内容
  const out2 = [];
  for (const b of blocks) {
    const content = b.content.trim();
    if (isJunkCard(b.topic, content)) continue;
    if (!b.topic) {
      if (content && content.replace(/\s+/g, '').length >= 3) out2.push({ topic: makeTopic(content), content });
      continue;
    }
    const topic = b.topic.trim().replace(/^#+\s*/, ''); // 去掉 markdown # 前缀
    if (content && content.replace(/\s+/g, '').length >= 3) out2.push({ topic, content });
    else if (topic.replace(/\s+/g, '').length >= 4 && !isJunkCard(topic, topic)) out2.push({ topic, content: topic });
  }
  return out2;
}

// ---------------- 卡片 ----------------

function hashId(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'c' + h.toString(36);
}

function cleanConfig() {
  const cfg = (store.get('config') || {}).llm || {};
  return { enabled: cfg.cleanCards !== false, apiKey: require('./meta').getApiKey(), baseUrl: cfg.baseUrl, model: cfg.model };
}

/** 把长文本按句子/段落边界切成若干段（每段约 maxLen 字符），避免 LLM 截断丢失内容。 */
function splitIntoChunks(text, maxLen = 6000) {
  let s = String(text || '');
  const parts = [];
  const breaks = ['\n', '。', '？', '！', '；', '.', ' '];
  while (s.length > maxLen) {
    let cut = -1;
    for (const b of breaks) { cut = Math.max(cut, s.lastIndexOf(b, maxLen)); }
    if (cut < Math.floor(maxLen * 0.4)) cut = maxLen;
    parts.push(s.slice(0, cut + 1));
    s = s.slice(cut + 1);
  }
  if (s.trim()) parts.push(s);
  return parts.filter(p => p.replace(/\s+/g, '').length > 40);
}

/** 按题目去重（题目归一化后相同则只留第一份）。 */
function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const key = String(it.topic || '').toLowerCase().replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '').slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/**
 * 从文本生成知识点卡（优先 LLM 清洗：合并/拆分/补全；失败或无 LLM 时回落到规则切割）。
 * 大文本会分段清洗并合并去重，避免只处理开头一小段。
 */
async function cardsFromText(text, source, { pageTitle = '', multi = false, idxOffset = 0, onProgress } = {}) {
  const now = new Date().toISOString();
  const cardSource = (multi && pageTitle) ? pageTitle : source.name;
  const cc = cleanConfig();
  let items = null;
  if (cc.enabled && cc.apiKey && cc.baseUrl && cc.model) {
    const chunks = splitIntoChunks(text);
    const acc = [];
    let failed = false;
    for (let i = 0; i < chunks.length; i++) {
      if (onProgress) onProgress(`LLM 清洗 ${i + 1}/${chunks.length} 段…`);
      try {
        const got = await llm.cleanCards(chunks[i]);
        if (got && got.length) acc.push(...got);
      } catch (e) { failed = true; console.warn('[kaoyan] LLM 清洗某段失败：', e.message); }
    }
    if (acc.length) items = dedupeItems(acc); // LLM 有产出则用；否则回落规则切割
    else items = null;
  }
  if (!items) items = chunkText(text).map(b => ({ topic: b.topic, answer: b.content }));
  return items.map((it, i) => ({
    id: hashId(source.id + '|' + it.topic + '|' + (idxOffset + i)),
    sourceId: source.id,
    topic: it.topic,
    answer: it.answer,
    sourceName: cardSource,
    location: source.location || source.name,
    sourceType: source.type,
    createdAt: now,
    status: 'new', // new / known / unknown
    attempts: 0,
    best: 0,
    lastReviewedAt: null,
  }));
}

async function addSourceFile(filePath, opts = {}) {
  const name = path.basename(filePath);
  const id = hashId('src|file|' + filePath);
  const { text, format } = await extractFile(filePath);
  const d = data();
  if (!d.sources.find(x => x.id === id)) {
    d.sources.push({ id, type: 'file', name, location: filePath, format, addedAt: new Date().toISOString(), parsedAt: null, cardCount: 0, error: null });
    save(d);
  }
  const source = data().sources.find(x => x.id === id);
  const cards = await cardsFromText(text, source, { onProgress: opts.onProgress });
  d.cards = d.cards.filter(c => c.sourceId !== id);
  d.cards = d.cards.concat(cards);
  source.cardCount = cards.length;
  source.parsedAt = new Date().toISOString();
  source.error = null;
  save(d);
  return { ok: true, cardCount: cards.length };
}

// ---------------- 自动评分 ----------------

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '');
}

function bigrams(s) {
  const n = normalize(s);
  const set = new Set();
  for (let i = 0; i < n.length; i++) {
    set.add(n[i]);
    if (i + 1 < n.length) set.add(n.slice(i, i + 2));
  }
  return set;
}

/**
 * 给分：综合「覆盖率(标准答案被覆盖的比例)」与「Jaccard 相似度」。
 * 满分 100。用户答案与标准答案越接近分越高；空答 0 分。
 */
function scoreAnswer(userAns, stdAns) {
  const u = bigrams(userAns);
  const s = bigrams(stdAns);
  if (s.size === 0) return 0;
  let inter = 0;
  for (const x of u) if (s.has(x)) inter++;
  const recall = inter / s.size;                       // 标准答案关键词被覆盖比例
  const jaccard = u.size + s.size - inter > 0 ? inter / (u.size + s.size - inter) : 0;
  const total = Math.round((0.65 * recall + 0.35 * jaccard) * 100);
  return Math.max(0, Math.min(100, total));
}

// ---------------- 数据操作 ----------------

function data() { return store.get('kaoyan') || { sources: [], cards: [], progress: {} }; }
function save(d) { store.set('kaoyan', d); }

async function addSourceUrl(url, opts = {}) {
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('请输入合法的网址（http/https）');
  const { title, pages } = await extractWeb(u, opts);
  const id = hashId('src|url|' + u);
  const name = title || u;
  const d = data();
  if (!d.sources.find(x => x.id === id)) {
    d.sources.push({ id, type: 'url', name, location: u, format: 'web', crawl: !!opts.crawl, addedAt: new Date().toISOString(), parsedAt: null, cardCount: 0, error: null });
    save(d);
  }
  const source = data().sources.find(x => x.id === id);
  source.name = name;
  source.crawl = !!opts.crawl;
  // 按页构建卡片：多页时每卡出处精确到该子页标题；逐页走 LLM 清洗（或规则切割）
  const multi = pages.length > 1;
  // 深入抓取且真的抓到了子页 → 首页只是目录/营销页，跳过其自身文本，只取子页正文
  const skip0 = !!opts.crawl && pages.length > 1;
  const allCards = [];
  for (const [pi, pg] of pages.entries()) {
    if (pi === 0 && skip0) continue;
    const pageTitle = (pg.title || '').split('｜')[0].trim(); // 标题去“｜大厂面试题…”后缀
    if (isNonKnowledgePage(pageTitle)) continue; // 整页非八股（招聘/营销/功能页）→ 丢弃
    const cards = await cardsFromText(pg.text, source, { pageTitle, multi, idxOffset: allCards.length, onProgress: opts.onProgress });
    allCards.push(...cards);
  }
  const now = new Date().toISOString();
  d.cards = d.cards.filter(c => c.sourceId !== id);
  d.cards = d.cards.concat(allCards);
  source.cardCount = allCards.length;
  source.parsedAt = now;
  source.error = null;
  save(d);
  return { ok: true, cardCount: allCards.length, pages: pages.length };
}

async function reparseSource(id) {
  const d = data();
  const s = d.sources.find(x => x.id === id);
  if (!s) throw new Error('来源不存在');
  const res = s.type === 'file' ? await addSourceFile(s.location) : await addSourceUrl(s.location, { crawl: !!s.crawl });
  return res;
}

// ---------------- 预览→确认→入库 ----------------
const pending = new Map(); // token -> {sourceMeta, cards}

/** 解析+清洗到一个临时会话，返回预览信息（不写库）。 */
async function previewSource(location, type, opts = {}) {
  let sourceMeta, cards;
  if (type === 'file') {
    const name = path.basename(location);
    const { text, format } = await extractFile(location);
    sourceMeta = { id: hashId('src|file|' + location), type: 'file', name, location, format };
    cards = await cardsFromText(text, sourceMeta, { onProgress: opts.onProgress });
  } else {
    const { title, pages } = await extractWeb(location, opts);
    sourceMeta = { id: hashId('src|url|' + location), type: 'url', name: title || location, location, format: 'web', crawl: !!opts.crawl };
    cards = [];
    const multi = pages.length > 1;
    const skip0 = !!opts.crawl && pages.length > 1;
    for (const [pi, pg] of pages.entries()) {
      if (pi === 0 && skip0) continue;
      const pageTitle = (pg.title || '').split('｜')[0].trim();
      if (isNonKnowledgePage(pageTitle)) continue;
      cards.push(...await cardsFromText(pg.text, sourceMeta, { pageTitle, multi, idxOffset: cards.length, onProgress: opts.onProgress }));
    }
  }
  const token = hashId('pending|' + Date.now() + '|' + Math.random());
  pending.set(token, { sourceMeta, cards });
  return {
    token,
    name: sourceMeta.name,
    total: cards.length,
    cards: cards.map(c => ({ topic: c.topic, answer: c.answer, sourceName: c.sourceName, location: c.location })),
  };
}

/** 确认入库：把接受的卡片写入来源（新建或更新），其余来自《重新解析》时会被替换。 */
function commitPending(token, acceptedIdx) {
  const p = pending.get(token);
  if (!p) throw new Error('预览会话已过期，请重新抓取');
  const src = p.sourceMeta;
  const d = data();
  const existing = d.sources.find(x => x.id === src.id);
  if (existing) {
    Object.assign(existing, { name: src.name, location: src.location, format: src.format || 'web', crawl: !!src.crawl });
  } else {
    d.sources.push({ id: src.id, type: src.type, name: src.name, location: src.location, format: src.format || 'web', crawl: !!src.crawl, addedAt: new Date().toISOString(), parsedAt: null, cardCount: 0, error: null });
  }
  let chosen = p.cards;
  if (Array.isArray(acceptedIdx)) {
    const keep = new Set(acceptedIdx.map(Number));
    chosen = p.cards.filter((c, i) => keep.has(i));
  }
  d.cards = d.cards.filter(c => c.sourceId !== src.id);
  d.cards = d.cards.concat(chosen);
  const s = d.sources.find(x => x.id === src.id);
  s.cardCount = chosen.length;
  s.parsedAt = new Date().toISOString();
  s.error = null;
  save(d);
  pending.delete(token);
  return { ok: true, cardCount: chosen.length, sourceId: src.id };
}

function discardPending(token) { pending.delete(token); return true; }

/** 批量清洗已有卡片：对某来源的现有卡片，把它们的 题目+答案 打包交给 LLM 重组，预览后替换。 */
async function previewReclean(sourceId) {
  const d = data();
  const s = d.sources.find(x => x.id === sourceId);
  if (!s) throw new Error('来源不存在');
  const cc = cleanConfig();
  if (!(cc.enabled && cc.apiKey && cc.baseUrl && cc.model)) throw new Error('未配置 LLM，无法智能清洗');
  const existing = d.cards.filter(c => c.sourceId === sourceId);
  if (!existing.length) throw new Error('该来源暂无可清洗的卡片');
  const bundle = existing.map((c, i) => `${i + 1}. 题目：${c.topic}\n答案：${c.answer}`).join('\n\n');
  let items;
  try {
    items = await llm.cleanCards(bundle);
  } catch (e) { throw new Error('LLM 清洗失败：' + e.message); }
  if (!items.length) throw new Error('LLM 未产出有效知识点');
  const sourceMeta = s;
  const cards = items.map(it => ({
    id: hashId(sourceId + '|clean|' + it.topic + '|' + Math.random()),
    sourceId,
    topic: it.topic,
    answer: it.answer,
    sourceName: s.name,
    location: s.location,
    sourceType: s.type,
    createdAt: new Date().toISOString(),
    status: 'new', attempts: 0, best: 0, lastReviewedAt: null,
  }));
  const token = hashId('reclean|' + Date.now() + '|' + Math.random());
  pending.set(token, { sourceMeta, cards });
  return { token, name: s.name, total: cards.length, cards: cards.map(c => ({ topic: c.topic, answer: c.answer, sourceName: c.sourceName, location: c.location })) };
}

function removeSource(id) {
  const d = data();
  d.sources = d.sources.filter(x => x.id !== id);
  d.cards = d.cards.filter(c => c.sourceId !== id);
  save(d);
  return true;
}

function listSources() { return data().sources; }

function listCards(filter) {
  const d = data();
  let cards = d.cards;
  if (filter && filter.sourceId) cards = cards.filter(c => c.sourceId === filter.sourceId);
  if (filter && filter.status) cards = cards.filter(c => c.status === filter.status);
  return cards;
}

function getCard(id) { return data().cards.find(c => c.id === id) || null; }

/**
 * 提交答案并评分（可配置 离线相似度 / LLM / 不评分）。
 * 返回 分数 / 点评 / 评分方式 / 标准答案 / 出处 / 历史最佳。
 */
async function submitAnswer(cardId, userAns) {
  const d = data();
  const c = d.cards.find(x => x.id === cardId);
  if (!c) throw new Error('卡片不存在');
  const cfg = llm.scoreConfig();
  const now = new Date().toISOString();
  const base = { std: c.answer, sourceName: c.sourceName, location: c.location, topic: c.topic, best: c.best || 0 };

  if (cfg.mode === 'none') {
    // 不评分：仅记录看过
    c.lastReviewedAt = now;
    d.progress.lastActiveAt = now;
    save(d);
    return Object.assign({}, base, { noScore: true });
  }

  let score, comment = '', method = 'similarity', llmFailed = false;
  if (cfg.mode === 'llm' && cfg.apiKey && cfg.baseUrl && cfg.model) {
    try {
      const r = await llm.scoreWithLLM(cfg, { topic: c.topic, std: c.answer, user: userAns });
      score = r.score;
      comment = r.comment;
      method = 'llm';
    } catch (e) {
      method = 'similarity';
      llmFailed = true;
      comment = 'LLM 调用失败，已用离线相似度评分：' + e.message;
      score = scoreAnswer(userAns, c.answer);
    }
  } else {
    score = scoreAnswer(userAns, c.answer);
  }

  c.attempts = (c.attempts || 0) + 1;
  c.best = Math.max(c.best || 0, score);
  c.lastReviewedAt = now;
  c.status = score >= 70 ? 'known' : 'unknown';
  d.progress.lastActiveAt = now;
  save(d);
  return Object.assign({}, base, { score, comment, method, llmFailed, best: c.best });
}

/** 不作答、直接查看答案（仅记录被查看，不评分、不改掌握状态） */
function viewCard(cardId) {
  const d = data();
  const c = d.cards.find(x => x.id === cardId);
  if (!c) throw new Error('卡片不存在');
  c.lastReviewedAt = new Date().toISOString();
  d.progress.lastActiveAt = new Date().toISOString();
  save(d);
  return { topic: c.topic, std: c.answer, sourceName: c.sourceName, location: c.location };
}

function setCardStatus(cardId, status) {
  const d = data();
  const c = d.cards.find(x => x.id === cardId);
  if (!c) throw new Error('卡片不存在');
  c.status = status; // new / known / unknown
  c.lastReviewedAt = new Date().toISOString();
  d.progress.lastActiveAt = new Date().toISOString();
  save(d);
  return true;
}

function progress() {
  const d = data();
  const cards = d.cards;
  const done = cards.filter(c => c.status === 'known').length;
  const unknown = cards.filter(c => c.status === 'unknown').length;
  const tried = cards.filter(c => (c.attempts || 0) > 0).length;
  const avg = tried ? cards.filter(c => c.attempts > 0).reduce((s, c) => s + (c.best || 0), 0) / tried : 0;
  return {
    total: cards.length,
    done, unknown, pending: cards.length - done - unknown,
    tried, avg: Math.round(avg),
    sources: d.sources.length,
    lastActiveAt: (d.progress && d.progress.lastActiveAt) || null,
  };
}

module.exports = {
  extractFile, extractWeb, chunkText, scoreAnswer, hashId, isJunkCard, cardsFromText,
  splitIntoChunks, dedupeItems,
  addSourceFile, addSourceUrl, reparseSource, removeSource,
  previewSource, commitPending, discardPending, previewReclean,
  listSources, listCards, getCard, submitAnswer, viewCard, setCardStatus, progress,
};
