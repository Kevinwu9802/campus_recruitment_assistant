'use strict';
/**
 * llm.js — LLM 智能评分（OpenAI 兼容 Chat Completions 接口）
 *
 * 兼容任意 OpenAI 风格的服务，最低配置即可用 DeepSeek：
 *   baseUrl: https://api.deepseek.com/v1   model: deepseek-chat（DeepSeek 快速模型，等价“ds flash”）
 *  也可换成 OpenAI / 通义千问 / 本地 Ollama 等（baseUrl + model 均可自定义）。
 *
 * 评分：将「题目 + 标准答案 + 用户回答」交给模型，要求只输出 JSON 分数与一句话点评。
 * 任何异常都会 throw，由调用方回落到离线相似度评分。
 */
const meta = require('./meta');

const DEFAULT_TIMEOUT_SECONDS = 45; // 默认请求超时（单位：秒）

/** 把网络错误转成友好中文提示。timeoutSecs 为秒。 */
function friendlyErr(e, timeoutSecs) {
  const name = (e && e.name) || '';
  const msg = (e && e.message) || '';
  const secs = Math.max(1, Math.round(Number(timeoutSecs) || DEFAULT_TIMEOUT_SECONDS));
  if (name === 'AbortError' || /abort/i.test(msg)) {
    return `连接超时（超过 ${secs} 秒无响应）：可能是服务地址错误、网络不通/被阻断，或需检查该服务的 baseUrl（DeepSeek 用 https://api.deepseek.com/v1 或 https://api.deepseek.com）。`;
  }
  if (/getaddrinfo|ENOTFOUND|ECONNREFUSED|network/i.test(msg)) {
    return `网络无法连接该服务地址：请检查域名/端口是否正确、网络是否可达（${msg.slice(0, 60)}）。`;
  }
  if (/fetch failed/i.test(msg)) {
    return `请求失败（fetch failed）：可能是网络问题或该服务地址不可达。`;
  }
  return msg || name;
}

function chatCompletion({ baseUrl, apiKey, model, messages, timeout = DEFAULT_TIMEOUT_SECONDS, temperature = 0.2 }) {
  const secs = Math.max(1, Number(timeout) || DEFAULT_TIMEOUT_SECONDS);
  const ms = secs * 1000; // 秒 → 毫秒
  const url = String(baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (apiKey) headers.authorization = 'Bearer ' + apiKey;
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, temperature, stream: false }),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));
}

/** 包装 chatCompletion，把网络超时/abort 转成友好中文错误。 */
async function chatCompletionSafe(opts) {
  try { return await chatCompletion(opts); }
  catch (e) { throw new Error(friendlyErr(e, opts.timeout || DEFAULT_TIMEOUT_SECONDS)); }
}

function parseJsonLoose(txt) {
  let s = String(txt || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(s); } catch (e) {}
  const ai = s.indexOf('['), aj = s.lastIndexOf(']');
  if (ai >= 0 && aj > ai) { try { return JSON.parse(s.slice(ai, aj + 1)); } catch (e) {} }
  const oi = s.indexOf('{'), oj = s.lastIndexOf('}');
  if (oi >= 0 && oj > oi) { try { return JSON.parse(s.slice(oi, oj + 1)); } catch (e) {} }
  throw new Error('无法解析 LLM 输出：' + s.slice(0, 80));
}

/**
 * LLM 智能清洗：读入抓取原文，交给模型「忽略噪音 + 合并零散 + 拆分混杂 + 补全表述」，
 * 产出规整的【题目+答案】数组。基于原文，不编造原文没有的事实。
 */
async function cleanCards(text, opts = {}) {
  const cfg = scoreConfig();
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) throw new Error('LLM 未配置');
  const clipped = String(text || '').slice(0, 6500);
  const res = await chatCompletionSafe({
    baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, timeout: cfg.timeout,
    messages: [
      { role: 'system', content: '你是八股文面试题库整理助手，擅长把抓取的网页正文整理成高质量、规范的知识点问答。只输出 JSON 数组，不要任何其它文字。' },
      { role: 'user', content: `下面是抓取到的网页原文（可能含导航、营销、广告等噪音）。请把它整理成八股文知识点：\n- 忽略导航、欢迎语、广告、招聘、日期、字数、版权、公众号等无关内容；\n- 把知识点整理成若干条【题目 + 答案】；\n- 相关的零散内容合并成一条完整答案；一段里混了多个知识点就拆分成多条；表述不完整的补全成规范八股表述（只基于原文，不要编造原文没有的事实，不要写“原文未提及”）；\n- 题目用「什么是X」「X和Y的区别」「为什么…」「…的原理/步骤」等面试题形式；答案准确、完整、有条理。\n只输出 JSON 数组，每条：{"topic":"题目","answer":"答案"}，字段名必须是 topic 和 answer。\n---原文开始---\n${clipped}\n---原文结束---` },
    ],
  });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + ' ' + b.slice(0, 120));
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('空响应');
  const arr = parseJsonLoose(content);
  const list = Array.isArray(arr) ? arr : (arr.cards || arr.items || (arr.results || []));
  return list
    .map(c => ({ topic: String(c.topic || c.question || c.title || '').trim(), answer: String(c.answer || c.content || c.detail || '').trim() }))
    .filter(c => c.topic.length >= 2 && c.answer.length >= 8);
}

/** 读取当前 LLM 评分配置（API Key 单独从本机元数据读取，不随同步）。 */
function scoreConfig() {
  const config = require('./store').get('config') || {};
  const llm = config.llm || {};
  return {
    mode: llm.mode || 'similarity',   // similarity | llm | none
    provider: llm.provider || 'deepseek',
    baseUrl: llm.baseUrl || '',
    model: llm.model || 'deepseek-chat',
    timeout: Number(llm.timeout) || 45,  // 单位：秒
    apiKey: meta.getApiKey(),
  };
}

async function scoreWithLLM(cfg, { topic, std, user }) {
  if (!cfg || !cfg.apiKey || !cfg.baseUrl || !cfg.model) throw new Error('LLM 配置不完整（缺少 API Key / 服务地址 / 模型）');
  const res = await chatCompletionSafe({
    baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, timeout: cfg.timeout,
    messages: [
      { role: 'system', content: '你是一名中文技术面试官，负责给候选人的八股文回答打分。严格只输出 JSON，不要多余文字。' },
      { role: 'user', content: `请依据下面的标准答案，评估用户回答，给 0-100 的整数分并给一句简短改进建议。\n题目：${topic}\n标准答案：${std}\n用户回答：${user}\n严格输出格式：{"score": <0-100整数>, "comment": "<一句话建议>"}` },
    ],
  });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + ' ' + b.slice(0, 120));
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('空响应');
  const o = parseJsonLoose(content);
  let score = Math.round(Number(o.score));
  if (!isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, score));
  return { score, comment: String(o.comment || '') };
}

/** 连通性测试：发一个最简单的评分请求。 */
async function testConnection(cfg) {
  if (!cfg || !cfg.apiKey) return { ok: false, error: '未配置 API Key（请先填入并保存）' };
  if (!cfg.baseUrl || !cfg.model) return { ok: false, error: '未配置服务地址或模型' };
  try {
    const r = await chatCompletionSafe({
      baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, timeout: cfg.timeout, temperature: 0,
      messages: [{ role: 'user', content: '只回复"ok"两个字母' }],
    });
    if (!r.ok) {
      const b = await r.text().catch(() => '');
      if (r.status === 401 || r.status === 403) return { ok: false, error: '认证失败：API Key 无效或无权访问（请检查 Key 是否正确、是否已开通/实名该服务）' };
      if (r.status === 404) return { ok: false, error: '未找到接口（404）：请确认服务地址正确（DeepSeek 用 https://api.deepseek.com 或 https://api.deepseek.com/v1）' };
      return { ok: false, error: 'HTTP ' + r.status + ' ' + b.slice(0, 120) };
    }
    const data = await r.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return { ok: true, msg: '连接成功（模型已响应）', reply: String(text || '').slice(0, 60) };
  } catch (e) {
    return { ok: false, error: '连接失败：' + friendlyErr(e, cfg.timeout || DEFAULT_TIMEOUT) };
  }
}

module.exports = { scoreConfig, scoreWithLLM, cleanCards, testConnection };
