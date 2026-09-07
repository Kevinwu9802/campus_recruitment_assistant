'use strict';
/* 八股引擎端到端测试：真实 PDF/Word/txt/网址解析 → 知识点卡 → 评分 → 进度 */
const os = require('os');
const path = require('path');
const fs = require('fs');

// 隔离元数据（不同步、含 LLM Key），避免污染全局测试环境
process.env.LC_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-kaoyan-meta-'));

const store = require('../main/store');
const kaoyan = require('../main/kaoyan');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-kaoyan-test-'));
store.init(path.join(tmp, 'data'));

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else fail++; console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); }

// 桩 fetch：处理 URL 抓取 + LLM chat/completions
const HTML = '<html><head><title>TCP 协议详解</title></head><body>' +
  '<h1>什么是TCP三次握手</h1><p>客户端SYN，服务器SYN-ACK，客户端ACK，连接建立。</p>' +
  '<h1>什么是TCP与UDP区别</h1><p>TCP面向连接可靠，UDP无连接不可靠但更快。</p>' +
  '</body></html>';
let LLM_MODE = 'ok'; // ok | fail
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/chat/completions')) {
    if (LLM_MODE === 'fail') throw new Error('网络超时');
    // 校验请求
    const body = JSON.parse(init.body || '{}');
    if (!body.model || !body.messages) throw new Error('请求缺 model/messages');
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"score": 88, "comment": "关键词基本覆盖，可以再完善时序细节。"}' } }] }) };
  }
  if (u.includes('example')) return { ok: true, status: 200, text: async () => HTML };
  return { ok: false, status: 404, text: async () => '' };
};

(async () => {
  // 1) PDF
  let r = await kaoyan.addSourceFile('/tmp/kaoyan_real.pdf');
  check('解析 PDF', r.ok, `卡片 ${r.cardCount}`);
  // 2) docx
  r = await kaoyan.addSourceFile('/tmp/kaoyan.docx');
  check('解析 Word(docx)', r.ok, `卡片 ${r.cardCount}`);
  // 3) txt
  const txt = path.join(tmp, 'notes.txt');
  fs.writeFileSync(txt, '什么是红黑树\n一种自平衡二叉搜索树。\n\n什么是B+树\n多路平衡查找树，常用于数据库索引。');
  r = await kaoyan.addSourceFile(txt);
  check('解析 txt', r.ok, `卡片 ${r.cardCount}`);
  // 4) 网址
  r = await kaoyan.addSourceUrl('https://example.com/tcp');
  check('抓取网址', r.ok, `卡片 ${r.cardCount}`);

  const sources = kaoyan.listSources();
  check('来源数量', sources.length === 4, `${sources.length} 个来源`);
  const cards = kaoyan.listCards({});
  check('知识点卡总数>0', cards.length > 0, `${cards.length} 卡`);
  console.log('  示例卡片：');
  cards.slice(0, 4).forEach(c => console.log(`    [${c.status}] 题目=${c.topic.slice(0, 24)} | 出处=${c.sourceName.slice(0, 16)} | 答案=${c.answer.slice(0, 28)}`));

  // 5) 离线相似度评分 + 状态（取一张中文长答案卡，用其标准答案作响得高分）
  const c0 = cards.find(c => /[\u4e00-\u9fa5]/.test(c.answer) && c.answer.length > 16) || cards[0];
  console.log(`  选中卡：${c0.topic.slice(0, 20)} | 答案=${c0.answer.slice(0, 30)}`);
  let res = await kaoyan.submitAnswer(c0.id, c0.answer);
  check('离线完全作答得分>=80', res.score >= 80, `score=${res.score} method=${res.method}`);
  let res2 = await kaoyan.submitAnswer(c0.id, '完全无关的回答啊');
  check('离线答错分数低', res2.score < 40, `${res2.score} 分`);
  check('历史最佳保留最高分', kaoyan.getCard(c0.id).best >= res.score, `best=${kaoyan.getCard(c0.id).best}`);

  // 6) LLM 评分：成功
  const cfg = store.get('config'); cfg.llm = { mode: 'llm', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', timeout: 25 }; store.set('config', cfg);
  require('../main/meta').saveApiKey('sk-ds-test');
  LLM_MODE = 'ok';
  res = await kaoyan.submitAnswer(c0.id, '客户端SYN，服务器SYN-ACK，客户端ACK，连接建立');
  check('LLM 评分成功(method=llm)', res.method === 'llm' && res.comment, `score=${res.score} comment=${res.comment} method=${res.method}`);
  check('LLM 分数来自模型', res.score === 88, `score=${res.score}`);

  // 7) LLM 失败 → 回落离线
  LLM_MODE = 'fail';
  res = await kaoyan.submitAnswer(c0.id, '客户端SYN，服务器SYN-ACK，客户端ACK，连接建立');
  check('LLM 失败回落相似度', res.method === 'similarity' && res.llmFailed === true, `method=${res.method} score=${res.score} msg=${(res.comment||'').slice(0,20)}`);
  LLM_MODE = 'ok';

  // 8) 不评分模式
  cfg.llm.mode = 'none'; store.set('config', cfg);
  res = await kaoyan.submitAnswer(c0.id, '随便写点');
  check('不评分(noScore)', res.noScore === true && !('score' in res), `noScore=${res.noScore}`);
  cfg.llm.mode = 'similarity'; store.set('config', cfg);

  // 9) 查看答案（不作答）
  const v = kaoyan.viewCard(c0.id);
  check('查看答案返回标准答案', v.std === c0.answer, `std长=${(v.std||'').length}`);

  await kaoyan.setCardStatus(kaoyan.listCards({})[1].id, 'known');
  const prog = kaoyan.progress();
  check('进度统计', prog.total === cards.length && prog.done >= 1, `总${prog.total} 掌握${prog.done} 待复习${prog.unknown} 平均${prog.avg}`);

  // 6) 重解析某来源（不重复建卡）
  const before = kaoyan.listCards({}).length;
  const sid = sources[0].id;
  await kaoyan.reparseSource(sid);
  const after = kaoyan.listCards({}).length;
  check('重新解析不产生重复卡(按来源替换)', after <= before, `before=${before} after=${after}`);

  // 7) 删除来源及卡
  const cnt = kaoyan.listCards({ sourceId: sid }).length;
  kaoyan.removeSource(sid);
  check('删除来源级联删卡', kaoyan.listCards({ sourceId: sid }).length === 0 && cnt > 0, `删除 ${cnt} 卡`);

  console.log(`\n${fail === 0 ? '✅ 八股引擎全部通过' : '❌ ' + fail + ' 项失败'}（${pass} 通过）`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常', e); process.exit(1); });
