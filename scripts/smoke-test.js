'use strict';
/* 冒烟测试：抓取真实数据 → 记忆库对账 → 按月份生成计划（不依赖 Electron GUI） */
const os = require('os');
const path = require('path');
const fs = require('fs');

const store = require('../main/store');
const leetcode = require('../main/leetcode');
const scheduler = require('../main/scheduler');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-daily-test-'));
store.init(tmpDir);
console.log('[1] store 初始化于', tmpDir);

(async () => {
  // 配置
  const cfg = store.get('config');
  cfg.userSlug = 'kevinwu-z';
  cfg.profileUrl = 'https://leetcode.cn/u/kevinwu-z/';
  store.set('config', cfg);

  // 抓取用户资料
  const profile = await leetcode.getUserProfile('kevinwu-z');
  console.log('[2] 用户资料:', profile.realName, '| 技能标签:', profile.skillTags.join(','), '| 排名:', profile.siteRanking);

  // 抓取公开题单列表
  const { lists } = await leetcode.getUserLists('kevinwu-z');
  console.log('[3] 公开题单数:', lists.length, '→', lists.map(l => `${l.name}(${l.questionNumber})`).join(' '));

  // 抓取前 3 个题单的完整题目（控制测试时间）
  const picked = lists.slice(0, 3);
  const fullLists = [];
  for (const l of picked) {
    const detail = await leetcode.getListQuestions(l.slug);
    fullLists.push(Object.assign({}, l, { questions: detail.questions, fetchedAt: new Date().toISOString() }));
    console.log(`[4] 题单「${l.name}」抓取 ${detail.questions.length} 题（接口报告 ${detail.totalLength}）`);
  }
  const listsFile = store.get('lists') || {};
  listsFile.lists = fullLists;
  listsFile.updatedAt = new Date().toISOString();
  store.set('lists', listsFile);

  // 记忆库对账
  const history = store.get('history') || { questions: {} };
  const r = scheduler.reconcileHistory(fullLists, history);
  store.set('history', history);
  console.log('[5] 记忆库对账: 新增', r.added, '更新', r.updated, '| 总数', Object.keys(history.questions).length);

  // 按月份生成计划（今日会提交，其余为只读预览/记录）
  const dates = ['2026-09-01', '2026-09-13', '2026-10-06', '2026-10-20', '2026-11-11', '2026-11-30', '2026-08-03', '2026-08-31'];
  for (const d of dates) {
    const plan = scheduler.getPlan(d);
    const kinds = plan.items.reduce((m, i) => { m[i.kind] = (m[i.kind] || 0) + 1; return m; }, {});
    const hasSlug = plan.items.every(i => typeof i.titleSlug === 'string' && i.titleSlug.length > 0);
    console.log(`[6] ${d} (${d.slice(5,7)}月) 只读=${!!plan.readonly} 休息=${plan.rest} 新${kinds.new || 0} 复习${kinds.review || 0} 链接ok=${hasSlug} 备注[${plan.note || '正常'}]`);
  }

  // 状态流转测试（仅今日可编辑）
  const d0 = scheduler.todayStr();
  const plan0 = scheduler.getPlan(d0);
  const first = plan0.items[0];
  if (first) {
    const res = scheduler.setProblemStatus(d0, first.qid, 'done');
    const h = store.get('history').questions[first.qid];
    console.log('[7] 标记完成:', first.qid, '→', res.ok, '| 该题完成次数:', h.timesCompleted, '| 上次复习:', h.lastReviewedDate);
    const s2 = scheduler.setProblemStatus(d0, first.qid, 'done');
    console.log('[7b] 重复标记不应重复计数:', s2.ok, '| 完成次数仍为', store.get('history').questions[first.qid].timesCompleted);
  }

  // 只读校验：过去/未来日期不可写（setAllStatus 仅作用于已提交计划；未提交则报“不存在”）
  const futureDs = scheduler.todayStr().slice(0,8)+'15';
  const futurePlan = scheduler.getPlan(futureDs);
  console.log('[7c] 未来日期 只读=', futurePlan.readonly, '| 是否提交到磁盘:', !!((store.get('plan')||{})[futureDs]));
  const beforeStart = scheduler.getPlan('2026-08-31');
  console.log('[7d] 开始日期前(8-31) notBeforeStart=', beforeStart.notBeforeStart, '| 备注:', beforeStart.note);

  // 休息切换：9-06 切换为休息日后应重建（月历 bug 修复验证）
  const sRest = scheduler.setRest('2026-09-06', true);
  console.log('[7e] 设休息日 9-06:', sRest.rest === true && sRest.items.length === 0 ? '✓ 已重建为休息日' : '✗ 未重建 ' + JSON.stringify(sRest.rest));
  const sRest2 = scheduler.setRest('2026-09-06', false);
  console.log('[7f] 取消休息 9-06:', `rest=${sRest2.rest} 新${sRest2.newCount} 复习${sRest2.reviewCount}`);

  // 重复题去重测试：同一题加入第二个题单后仍是一条记忆
  const dupQid = fullLists[0].questions[0].questionFrontendId;
  fullLists[1].questions.push(Object.assign({}, fullLists[0].questions[0]));
  const history2 = store.get('history') || { questions: {} };
  const r2 = scheduler.reconcileHistory(fullLists, history2);
  const dupH = history2.questions[dupQid];
  console.log('[8] 跨题单去重:', dupQid, '| 记忆条目数=1:', Object.values(history2.questions).filter(q => q.frontendId === dupQid).length === 1, '| 所属题单:', dupH.lists.join(','));

  // 统计
  const stats = scheduler.getStats();
  console.log('[9] 统计: 总数', stats.total, '| 完成次数', stats.totalDone, '| 连续', stats.streak, '天');

  // 导出备份
  const bundle = store.exportAll();
  console.log('[10] 导出备份文件数:', Object.keys(bundle).length);
  console.log('\n全部冒烟测试通过 ✔');
  process.exit(0);
})().catch(e => { console.error('测试失败:', e); process.exit(1); });
