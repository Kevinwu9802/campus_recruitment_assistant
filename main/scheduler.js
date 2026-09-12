'use strict';
/**
 * scheduler.js — 每日刷题计划生成与记忆库维护
 *
 * 核心语义：
 *  - 「新题」：从未被本工具排期过（history.timesScheduled === 0）且未标记「已掌握」。
 *  - 「复习题」：曾经被排期过或完成过的题目（按简易间隔重复排序，越久没复习越优先）。
 *  - 记忆库按 LeetCode 题号（questionFrontendId）去重 —— 同一道题出现在多个题单
 *    或后来被加入新题单时，自动识别为旧题，避免「表面是新题、实际是旧题」。
 *  - 难度偏好：新题以中等（MEDIUM）为主，不足时回退 简单/困难。
 *  - 知识点覆盖：新题按主类别标签分组轮转挑选，保证各题单知识点雨露均沾。
 */
const store = require('./store');

// ---------- 工具 ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return h >>> 0;
}

function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekdayOf(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay(); // 0=周日
}

const DIFF_ORDER = { MEDIUM: 0, EASY: 1, HARD: 2 };

// ---------- 记忆库 ----------

/** 抓取题单后同步记忆库：补全新题条目、更新题目信息，跨题单去重 */
function reconcileHistory(lists, history) {
  const byQid = history.questions || {};
  const now = new Date().toISOString();
  let added = 0, updated = 0;
  for (const list of lists || []) {
    for (const q of list.questions || []) {
      const qid = q.questionFrontendId;
      const tags = (q.tags || []).map(t => t.nameTranslated).filter(Boolean);
      if (!byQid[qid]) {
        byQid[qid] = {
          frontendId: qid,
          title: q.title,
          translatedTitle: q.translatedTitle || q.title,
          titleSlug: q.titleSlug,
          difficulty: q.difficulty,
          paidOnly: !!q.paidOnly,
          tags,
          primaryTag: tags[0] || '未分类',
          firstSeenAt: now,
          lastSeenAt: now,
          timesScheduled: 0,
          lastScheduledDate: null,
          timesCompleted: 0,
          lastCompletedDate: null,
          lastReviewedDate: null,
          mastered: false,
          note: '',
          lists: [list.slug],
        };
        added++;
      } else {
        const h = byQid[qid];
        h.lastSeenAt = now;
        h.title = q.title;
        h.translatedTitle = q.translatedTitle || h.translatedTitle;
        h.titleSlug = q.titleSlug;
        h.difficulty = q.difficulty;
        h.paidOnly = !!q.paidOnly;
        if (tags.length) { h.tags = tags; h.primaryTag = tags[0]; }
        if (!h.lists.includes(list.slug)) h.lists.push(list.slug);
        updated++;
      }
    }
  }
  history.questions = byQid;
  history.updatedAt = now;
  return { added, updated };
}

// ---------- 计划配置 ----------

function effectiveMonthPlan(config, monthKey) {
  if (config.monthPlans && config.monthPlans[monthKey]) {
    return Object.assign({}, store.getMonthPlanDefault(monthKey), config.monthPlans[monthKey]);
  }
  return store.getMonthPlanDefault(monthKey);
}

function isRestDay(config, dateStr) {
  if (config.restDates && dateStr in config.restDates) return !!config.restDates[dateStr];
  const monthKey = dateStr.slice(0, 7);
  const mp = effectiveMonthPlan(config, monthKey);
  if (!mp.enabled) return true;
  if (!mp.restWeekdays || !mp.restWeekdays.length) return false;
  return mp.restWeekdays.includes(weekdayOf(dateStr));
}

function randInt(rnd, min, max) {
  if (max <= min) return min;
  return min + Math.floor(rnd() * (max - min + 1));
}

// ---------- 选题池 ----------

/** 启用中的题单（listEnabled 中显式禁用除外） */
function enabledLists(config, lists) {
  const en = config.listEnabled || {};
  return (lists || []).filter(l => en[l.slug] !== false);
}

/** 全部题单题目（去重 by qid）→ Map<qid, {q, listSlug}> */
function allQuestionsMap(lists) {
  const m = new Map();
  for (const list of lists || []) {
    for (const q of list.questions || []) {
      if (!m.has(q.questionFrontendId)) m.set(q.questionFrontendId, { q, listSlug: list.slug });
    }
  }
  return m;
}

/**
 * 生成某天的计划。幂等：plan.json 已有该天则直接返回。
 * force=true 时重新生成（旧的题目完成状态丢失前会提示）。
 */
/** 构造计划项（内嵌跳转所需字段，保证链接永远有效，不回退成题号） */
function itemOf(qid, kind, listSlug, q, h) {
  const qq = q || (h && { titleSlug: h.titleSlug, translatedTitle: h.translatedTitle, title: h.title, difficulty: h.difficulty, tags: h.tags });
  const tags = (qq && qq.tags ? qq.tags : []).map(t => typeof t === 'string' ? t : (t.nameTranslated || t.name || t)).slice(0, 4);
  return {
    qid: String(qid),
    kind,
    listSlug: listSlug || '',
    status: 'todo',
    titleSlug: (qq && qq.titleSlug) || '',
    translatedTitle: (qq && qq.translatedTitle) || String(qid),
    title: (qq && qq.title) || '',
    difficulty: (qq && qq.difficulty) || '',
    paidOnly: !!(qq && qq.paidOnly),
    tags,
  };
}

/**
 * 计算某天的计划（纯计算：不写库、不登记排期、不产生副作用）。
 * 幂等：同一天、同为种子随机，结果稳定，可安全用于「预览」。
 */
function computePlan(dateStr) {
  const config = store.get('config') || {};
  const lists = (store.get('lists') || {}).lists || [];
  const history = store.get('history') || { questions: {} };

  const monthKey = dateStr.slice(0, 7);
  const mp = effectiveMonthPlan(config, monthKey);
  const rest = isRestDay(config, dateStr);
  const rnd = mulberry32(hashCode(dateStr + '|' + (config.salt || 'v1')));
  const now = new Date().toISOString();

  const base = {
    date: dateStr,
    generatedAt: now,
    monthKey,
    rest,
    newCount: 0,
    reviewCount: 0,
    items: [],
    note: '',
  };
  if (rest) { base.note = '休息日，不安排刷题'; return { plan: base }; }

  // ---- 语义：题单 = 复习清单；新题 = 不在题单、但知识点命中任一题单标签的 LeetCode 题 ----
  const enLists = enabledLists(config, lists);
  const listQmap = allQuestionsMap(enLists);        // 题单题目（复习池）
  const listQids = new Set(listQmap.keys());

  // 题单知识点集合
  const tagSet = new Set();
  for (const { q } of listQmap.values()) for (const t of (q.tags || [])) tagSet.add(t.nameTranslated);

  // ---- 新题池：LeetCode 题目池中 不在题单 && 知识点命中 && 未排期/未掌握 ----
  const pool = (store.get('pool') || {}).problems || [];
  const skipPaid = config.skipPaidOnly !== false; // 默认跳过会员专享题
  const baseTag = (p) => (p.tags || []).find(t => tagSet.has(t)) || (p.tags || [])[0] || '未分类';
  const newCandidates = [];
  for (const p of pool) {
    if (listQids.has(p.frontendId)) continue;                               // 在题单 → 复习
    if (skipPaid && p.paidOnly) continue;                                   // 会员专享题 → 跳过
    const h = history.questions[p.frontendId];
    if (h && (h.timesScheduled > 0 || h.timesCompleted > 0 || h.mastered)) continue; // 已做过/掌握
    if (!(p.tags || []).some(t => tagSet.has(t))) continue;                // 知识点未命中题单
    newCandidates.push({
      qid: p.frontendId,
      q: { titleSlug: p.titleSlug, translatedTitle: p.titleCn || p.title, title: p.title, difficulty: p.difficulty, tags: (p.tags || []).map(t => ({ nameTranslated: t })) },
      primary: baseTag(p),
      listSlug: '',
    });
  }
  const byTag = new Map();
  for (const it of newCandidates) {
    const primary = it.primary;
    if (!byTag.has(primary)) byTag.set(primary, []);
    byTag.get(primary).push(it);
  }
  const sortByDiff = (a, b) => (DIFF_ORDER[a.q.difficulty] ?? 3) - (DIFF_ORDER[b.q.difficulty] ?? 3);
  const groups = [...byTag.entries()].map(([tag, items]) => ({ tag, items: shuffle(items, rnd).sort(sortByDiff) }));
  const shuffledGroups = shuffle(groups, rnd);
  const newTarget = randInt(rnd, mp.newMin, mp.newMax);
  const pickedNew = [];
  const chosenQids = new Set();
  let guard = 0;
  while (pickedNew.length < newTarget && guard++ < 2000) {
    let took = false;
    for (const g of shuffledGroups) {
      for (let i = 0; i < g.items.length; i++) {
        const it = g.items[i];
        if (chosenQids.has(it.qid)) continue;
        g.items.splice(i, 1);
        pickedNew.push(it);
        chosenQids.add(it.qid);
        took = true;
        break;
      }
      if (pickedNew.length >= newTarget) break;
    }
    if (!took) break; // 新题池耗尽
  }

  // ---- 复习池：题单题目，按“离上次复习最久”优先（同级随机） ----
  let reviewPool = [];
  for (const [qid, { q, listSlug }] of listQmap) {
    if (chosenQids.has(qid)) continue;              // 同一天不与新题重复
    const h = history.questions[qid];
    if (h && h.mastered) continue;
    if (skipPaid && q.paidOnly) continue;                                   // 会员专享题 → 跳过
    if (h && (h.lastScheduledDate === dateStr || h.lastReviewedDate === dateStr)) continue; // 今天已安排过
    reviewPool.push({ qid, q, listSlug, h: h || {} });
  }
  reviewPool = shuffle(reviewPool, rnd).sort((a, b) => {
    const da = new Date(a.h.lastReviewedDate || a.h.lastScheduledDate || '1970-01-01').getTime();
    const db = new Date(b.h.lastReviewedDate || b.h.lastScheduledDate || '1970-01-01').getTime();
    return da - db; // 稳定排序：未复习过的（无日期）优先，同级保持随机
  });
  const reviewTarget = randInt(rnd, mp.reviewMin, mp.reviewMax);
  const pickedReview = reviewPool.slice(0, reviewTarget);

  // ---- 组装 ----
  const items = [];
  for (const it of pickedNew) {
    const h0 = history.questions[it.qid];
    items.push(itemOf(it.qid, 'new', '', it.q, h0));
  }
  for (const rv of pickedReview) {
    items.push(itemOf(rv.qid, 'review', rv.listSlug, rv.q, rv.h));
  }
  base.newCount = pickedNew.length;
  base.reviewCount = pickedReview.length;
  base.items = items;
  if (listQmap.size === 0) { base.note = '尚未抓取到题单数据，请先到「题单管理」抓取'; return { plan: base, empty: true }; }
  if (pool.length === 0) base.note += '尚未抓取题目池（新题候选来自 LeetCode 题目池，请先在「题单管理」抓取）；';
  if (pickedNew.length < newTarget) base.note += `新题池不足（想要 ${newTarget}，实际 ${pickedNew.length}）；`;
  if (pickedReview.length < reviewTarget) base.note += `复习池不足（想要 ${reviewTarget}，实际 ${pickedReview.length}）；`;
  base.note = base.note.replace(/；$/, '');
  return { plan: base };
}

/** 提交当日计划：登记排期到记忆库 + 持久化（仅当天调用） */
function commitPlan(dateStr, plan) {
  const history = store.get('history') || { questions: {} };
  const planFile = store.get('plan') || {};
  const now = new Date().toISOString();
  let registered = 0;
  for (const it of plan.items) {
    let h = history.questions[it.qid];
    if (!h) {
      // 来自「题目池」的新题不在题单里，首次排期时补建记忆库条目（否则会天天重复出现）
      h = history.questions[it.qid] = {
        frontendId: String(it.qid),
        title: it.title || '',
        translatedTitle: it.translatedTitle || String(it.qid),
        titleSlug: it.titleSlug || '',
        difficulty: it.difficulty || '',
        paidOnly: !!it.paidOnly,
        tags: it.tags || [],
        primaryTag: (it.tags && it.tags[0]) || '未分类',
        firstSeenAt: now,
        lastSeenAt: now,
        timesScheduled: 0,
        lastScheduledDate: null,
        timesCompleted: 0,
        lastCompletedDate: null,
        lastReviewedDate: null,
        mastered: false,
        note: '',
        lists: [],
        fromPool: true,
      };
    }
    if (it.paidOnly) h.paidOnly = true;
    h.timesScheduled = (h.timesScheduled || 0) + 1;
    h.lastScheduledDate = dateStr;
    registered++;
  }
  history.updatedAt = now;
  store.set('history', history);
  planFile[dateStr] = plan;
  store.set('plan', planFile);
  return { registered };
}

/**
 * 获取某天计划。语义（重要）：
 *  - 早于 scheduleStart：不生成，仅返回占位（尚未开始）。
 *  - 过去日期：若已有（已生成过的）计划 → 只读查看刷题记录；否则返回占位“无记录”。
 *  - 今天：计算并提交（登记排期 + 持久化），可编辑。
 *  - 未来日期：只读预览（纯计算、不提交、不改动记忆库）。
 *  取消/设置休息日会重新计算该天。
 */
/** 会员题号集合（来自题目池 + 记忆库标记），用于回填老计划。 */
function paidQidSet() {
  const set = new Set();
  const pool = (store.get('pool') || {}).problems || [];
  for (const p of pool) if (p.paidOnly) set.add(String(p.frontendId));
  const hist = (store.get('history') || {}).questions || {};
  for (const [qid, h] of Object.entries(hist)) if (h && h.paidOnly) set.add(String(qid));
  return set;
}

/** 回填计划项的 paidOnly 字段，使早期生成的计划也能正确显示「会员」标记。返回是否有改动 */
function annotatePlan(plan, paidSet) {
  if (!plan || !Array.isArray(plan.items) || !plan.items.length) return false;
  const set = paidSet || paidQidSet();
  let changed = false;
  for (const it of plan.items) {
    const isPaid = set.has(String(it.qid));
    if (it.paidOnly !== isPaid) { it.paidOnly = isPaid; changed = true; }
    else if (it.paidOnly === undefined) { it.paidOnly = isPaid; changed = true; }
  }
  return changed;
}

function getPlan(dateStr) {
  const config = store.get('config') || {};
  const start = config.scheduleStart || '2026-09-01';
  const planFile = store.get('plan') || {};
  const today = todayStr();
  const paidSet = paidQidSet();

  if (dateStr < start) {
    return { date: dateStr, rest: false, newCount: 0, reviewCount: 0, items: [], note: `计划尚未开始（早于 ${start}）`, readonly: true, notBeforeStart: true };
  }

  if (planFile[dateStr]) {
    // 休息状态若被改动（例如在月历里切换），重新计算该天
    if (planFile[dateStr].rest !== isRestDay(config, dateStr)) {
      delete planFile[dateStr];
      store.set('plan', planFile);
    } else {
      planFile[dateStr].readonly = dateStr !== today;
      if (annotatePlan(planFile[dateStr], paidSet)) store.set('plan', planFile); // 回填会员标记并写回
      return planFile[dateStr];
    }
  }

  const { plan, empty } = computePlan(dateStr);
  annotatePlan(plan, paidSet);
  if (dateStr < today && !planFile[dateStr]) {
    // 过去但从未生成过：无记录（不生成）
    return { date: dateStr, rest: plan.rest, newCount: plan.newCount, reviewCount: plan.reviewCount, items: [], note: '该日没有刷题记录', readonly: true };
  }
  plan.readonly = dateStr !== today;
  if (dateStr === today && !empty) commitPlan(dateStr, plan);
  return plan;
}

/** 重新生成（删除旧计划后按当前条件重建；非当天仅预览） */
function regeneratePlan(dateStr) {
  const planFile = store.get('plan') || {};
  delete planFile[dateStr];
  store.set('plan', planFile);
  return getPlan(dateStr);
}

/** 设置休息状态并重建该天计划 */
function setRest(dateStr, rest) {
  const config = store.get('config') || {};
  config.restDates = Object.assign({}, config.restDates, { [dateStr]: !!rest });
  store.set('config', config);
  const planFile = store.get('plan') || {};
  delete planFile[dateStr];
  store.set('plan', planFile);
  return getPlan(dateStr);
}

/** 更新某天某题的状态，并回写记忆库 */
function setProblemStatus(dateStr, qid, status) {
  const planFile = store.get('plan') || {};
  const plan = planFile[dateStr];
  if (!plan) return { ok: false, error: '该日计划不存在' };
  const item = plan.items.find(i => i.qid === String(qid));
  if (!item) return { ok: false, error: '题目不在该日计划中' };
  const prev = item.status;
  item.status = status;
  const history = store.get('history') || { questions: {} };
  const h = history.questions[String(qid)];
  const now = new Date().toISOString();
  if (status === 'done' && prev !== 'done' && h) {
    h.timesCompleted = (h.timesCompleted || 0) + 1;
    h.lastCompletedDate = dateStr;
    h.lastReviewedDate = dateStr;
    if (!h.firstCompletedDate) h.firstCompletedDate = dateStr;
    history.updatedAt = now;
    store.set('history', history);
  }
  store.set('plan', planFile);
  return { ok: true, item, doneCount: plan.items.filter(i => i.status === 'done').length };
}

/** 全部完成 / 全部重置 */
function setAllStatus(dateStr, status) {
  const planFile = store.get('plan') || {};
  const plan = planFile[dateStr];
  if (!plan) return { ok: false, error: '该日计划不存在' };
  for (const item of plan.items) item.status = status;
  const history = store.get('history') || { questions: {} };
  const now = new Date().toISOString();
  for (const item of plan.items) {
    const h = history.questions[item.qid];
    if (!h) continue;
    if (status === 'done') {
      h.timesCompleted = (h.timesCompleted || 0) + 1;
      h.lastCompletedDate = dateStr;
      h.lastReviewedDate = dateStr;
      if (!h.firstCompletedDate) h.firstCompletedDate = dateStr;
    }
  }
  history.updatedAt = now;
  store.set('history', history);
  store.set('plan', planFile);
  return { ok: true };
}

/** 批量把题目标记为「已学过/已做过」——之后不再进“新题池”，只作为复习。 */
function markLearned(qids) {
  const history = store.get('history') || { questions: {} };
  const today = todayStr();
  let n = 0;
  for (const qid of qids || []) {
    const h = history.questions[String(qid)];
    if (!h) continue;
    h.timesCompleted = Math.max(1, h.timesCompleted || 0);
    h.firstCompletedDate = h.firstCompletedDate || today;
    h.lastCompletedDate = today;
    h.lastReviewedDate = today;
    n++;
  }
  history.updatedAt = new Date().toISOString();
  store.set('history', history);
  return { ok: true, marked: n };
}

/** 一键移除所有会员专享题：从记忆库删除 + 从已有计划里剔除 + 从题目池里剔除。 */
function purgePaid() {
  const history = store.get('history') || { questions: {} };
  const planFile = store.get('plan') || {};
  // 先收集所有会员题号（记忆库标记 + 计划里内嵌的标记）
  const paidQids = new Set();
  for (const [qid, h] of Object.entries(history.questions)) if (h && h.paidOnly) paidQids.add(String(qid));
  for (const ds of Object.keys(planFile)) {
    const plan = planFile[ds];
    if (plan && Array.isArray(plan.items)) for (const it of plan.items) if (it.paidOnly) paidQids.add(String(it.qid));
  }
  let removedHistory = 0;
  for (const qid of paidQids) { if (history.questions[qid]) { delete history.questions[qid]; removedHistory++; } }
  history.updatedAt = new Date().toISOString();
  store.set('history', history);

  let removedPlanItems = 0;
  for (const ds of Object.keys(planFile)) {
    const plan = planFile[ds];
    if (!plan || !Array.isArray(plan.items)) continue;
    const before = plan.items.length;
    plan.items = plan.items.filter(it => !(it.paidOnly || paidQids.has(String(it.qid))));
    if (plan.items.length !== before) {
      plan.newCount = plan.items.filter(i => i.kind === 'new').length;
      plan.reviewCount = plan.items.filter(i => i.kind === 'review').length;
      removedPlanItems += before - plan.items.length;
    }
  }
  store.set('plan', planFile);

  const pool = store.get('pool');
  let removedPool = 0;
  if (pool && Array.isArray(pool.problems)) {
    const before = pool.problems.length;
    pool.problems = pool.problems.filter(p => !p.paidOnly);
    removedPool = before - pool.problems.length;
    if (removedPool) store.set('pool', pool);
  }
  return { ok: true, removedHistory, removedPlanItems, removedPool, paidTotal: paidQids.size };
}

/** 某天计划（不存在则现场生成） */
/** 更新记忆库条目标记 */
function updateHistoryMeta(qid, patch) {
  const history = store.get('history') || { questions: {} };
  const h = history.questions[String(qid)];
  if (!h) return { ok: false, error: '记忆库无该题' };
  Object.assign(h, patch);
  history.updatedAt = new Date().toISOString();
  store.set('history', history);
  return { ok: true, h };
}

/** 统计（首页/统计页用） */
function getStats() {
  const history = store.get('history') || { questions: {} };
  const planFile = store.get('plan') || {};
  const sessions = store.get('sessions') || { sessions: [] };
  const config = store.get('config') || {};

  const questions = Object.values(history.questions);
  const total = questions.length;
  const mastered = questions.filter(q => q.mastered).length;
  const doneOnce = questions.filter(q => (q.timesCompleted || 0) > 0).length;
  const scheduled = questions.filter(q => (q.timesScheduled || 0) > 0).length;
  const totalDone = questions.reduce((s, q) => s + (q.timesCompleted || 0), 0);
  const totalScheduled = questions.reduce((s, q) => s + (q.timesScheduled || 0), 0);

  const today = todayStr();
  // 连续刷题天数
  let streak = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const plan = planFile[ds];
    const done = plan ? plan.items.filter(i => i.status === 'done').length : 0;
    if (done > 0) { streak++; continue; }
    if (ds === today) continue; // 今天还没刷不算断
    break;
  }
  // 近 30 天完成数（用于图表）
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const plan = planFile[ds];
    const done = plan ? plan.items.filter(x => x.status === 'done').length : 0;
    last30.push({ date: ds, done, new: plan ? plan.newCount : 0, review: plan ? plan.reviewCount : 0 });
  }
  // 知识点分布（按完成次数）
  const tagDist = {};
  for (const q of questions) {
    const c = q.timesCompleted || 0;
    if (c > 0) {
      const t = q.primaryTag || '未分类';
      tagDist[t] = (tagDist[t] || 0) + c;
    }
  }
  const tagTop = Object.entries(tagDist).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([tag, count]) => ({ tag, count }));

  // 今日专注分钟
  const sToday = (sessions.sessions || [])
    .filter(s => s.finished && (s.endTs || '').startsWith(today))
    .reduce((s, x) => s + (x.durationMin || 0), 0);

  const todayPlan = planFile[today];
  const todayDone = todayPlan ? todayPlan.items.filter(i => i.status === 'done').length : 0;

  return {
    total, mastered, doneOnce, scheduled, totalDone, totalScheduled,
    streak, last30, tagTop, todayFocusMin: sToday,
    todayDone, todayTotal: todayPlan ? todayPlan.items.length : 0,
    todayRest: todayPlan ? todayPlan.rest : false,
    profileUrl: config.profileUrl || '',
  };
}

module.exports = {
  reconcileHistory, effectiveMonthPlan, isRestDay,
  getPlan, regeneratePlan, setRest, markLearned, purgePaid,
  setProblemStatus, setAllStatus, updateHistoryMeta, getStats, todayStr,
};
