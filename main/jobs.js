'use strict';
/**
 * jobs.js — 校招求职进度表解析与看板数据
 *
 * 数据来源：手动导入语雀导出的 Excel(.xlsx/.xls)。解析后存 `jobs.json`（随 WebDAV 多端同步）。
 * 看板指标：投递/简历/笔试/面试/Offer 漏斗、渠道分布、时间趋势、地点分布、明细表。
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');

// ---------------- 工具 ----------------

const CN_MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** 把各种日期写法归一为 YYYY-MM-DD（失败返回原文本） */
function toDateStr(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})\s*[年\/\-\.]\s*(\d{1,2})\s*[月\/\-\.]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/); // September 2, 2026
  if (m) {
    const mo = CN_MONTHS[m[1].toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 60000) { // Excel 日期序列号
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return s;
}

const clean = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const has = (v) => clean(v).length > 0;
const includesAny = (v, arr) => { const s = clean(v); return arr.some(k => s.includes(k)); };

// 列名 → 标准字段（容忍语雀导出时列名的细微差异）
const COLMAP = [
  ['no', ['序号', '编号']],
  ['company', ['公司名称', '公司']],
  ['position', ['岗位名称', '岗位', '职位']],
  ['channel', ['投递渠道', '渠道']],
  ['link', ['投递链接', '链接']],
  ['appliedAt', ['投递时间', '投递日期']],
  ['resumeStatus', ['简历状态', '简历结果']],
  ['examAt', ['笔试时间']],
  ['examResult', ['笔试结果', '笔试状态']],
  ['interviewRound', ['面试轮次', '轮次']],
  ['interviewAt', ['面试时间']],
  ['interviewResult', ['面试结果', '面试状态']],
  ['offerStatus', ['Offer状态', 'offer状态', 'Offer', 'offer']],
  ['salary', ['薪资范围', '薪资', '工资']],
  ['location', ['工作地点', '地点', '城市']],
  ['note', ['备注', '备注信息']],
];

function headerIndex(header) {
  const idx = {};
  const hs = header.map(h => clean(h));
  for (const [field, names] of COLMAP) {
    let i = hs.findIndex(h => names.some(n => h === n));
    if (i < 0) i = hs.findIndex(h => names.some(n => h.includes(n)));
    idx[field] = i;
  }
  return idx;
}

/** 找到「明细」工作表：表头包含 公司 或 投递时间 的 sheet 优先 */
function pickSheet(wb) {
  for (const name of wb.SheetNames) {
    const rows = wb.Sheets[name] ? sheetToRows(wb.Sheets[name]) : [];
    const head = rows[0] || [];
    const hs = head.map(h => clean(h)).join('|');
    if (/公司/.test(hs) || /投递时间/.test(hs) || /岗位/.test(hs)) return { name, rows };
  }
  const name = wb.SheetNames[0];
  return { name, rows: wb.Sheets[name] ? sheetToRows(wb.Sheets[name]) : [] };
}

function sheetToRows(ws) {
  const XLSX = require('xlsx');
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
}

/** 解析 xlsx 文件 → 记录数组 */
function parseXlsxFile(filePath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const { name, rows } = pickSheet(wb);
  if (!rows.length) throw new Error('未找到有效数据表');
  const idx = headerIndex(rows[0]);
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const get = (f) => (idx[f] >= 0 ? row[idx[f]] : '');
    const company = clean(get('company'));
    const position = clean(get('position'));
    if (!company && !position) continue; // 跳过空行
    records.push({
      no: clean(get('no')),
      company,
      position,
      channel: clean(get('channel')),
      link: clean(get('link')),
      appliedAt: toDateStr(get('appliedAt')),
      resumeStatus: clean(get('resumeStatus')),
      examAt: toDateStr(get('examAt')),
      examResult: clean(get('examResult')),
      interviewRound: clean(get('interviewRound')),
      interviewAt: toDateStr(get('interviewAt')),
      interviewResult: clean(get('interviewResult')),
      offerStatus: clean(get('offerStatus')),
      salary: clean(get('salary')),
      location: clean(get('location')),
      note: clean(get('note')),
    });
  }
  return { sheetName: name, columns: rows[0].map(clean), records };
}

// ---------------- 看板统计 ----------------

function analyze(records) {
  const list = records || [];
  const passed = (v) => includesAny(v, ['通过']);
  const failed = (v) => includesAny(v, ['挂', '淘汰', '未通过', '不合适']);

  const stat = {
    applied: list.length,
    resumePass: 0, resumeFail: 0,
    examPass: 0, examFail: 0, examed: 0,
    interviewPass: 0, interviewFail: 0, interviewed: 0,
    offer: 0, offerAccepted: 0,
    hasSalary: 0,
  };

  const byChannel = {}, byLocation = {}, byResumeStatus = {}, byCompany = {}, byDate = {};
  for (const r of list) {
    const interviewed = has(r.interviewAt) || has(r.interviewResult) || has(r.interviewRound);
    const examed = has(r.examAt) || has(r.examResult);
    const offer = has(r.offerStatus);

    // 漏斗：显式结果 + 由后续阶段推断
    if (passed(r.resumeStatus) || examed || interviewed || offer) stat.resumePass++;
    if (failed(r.resumeStatus)) stat.resumeFail++;
    if (examed) stat.examed++;
    if (passed(r.examResult) || interviewed || offer) stat.examPass++;
    if (failed(r.examResult)) stat.examFail++;
    if (interviewed) stat.interviewed++;
    if (passed(r.interviewResult) || offer) stat.interviewPass++;
    if (failed(r.interviewResult)) stat.interviewFail++;
    if (offer) { stat.offer++; if (includesAny(r.offerStatus, ['接受', '已接', '入职'])) stat.offerAccepted++; }
    if (has(r.salary)) stat.hasSalary++;

    const ch = r.channel || '未知';
    byChannel[ch] = (byChannel[ch] || 0) + 1;
    const loc = r.location || '未知';
    byLocation[loc] = (byLocation[loc] || 0) + 1;
    const rs = r.resumeStatus || '未标注';
    byResumeStatus[rs] = (byResumeStatus[rs] || 0) + 1;
    if (r.company) byCompany[r.company] = (byCompany[r.company] || 0) + 1;
    const d = r.appliedAt || '未知';
    byDate[d] = (byDate[d] || 0) + 1;
  }

  // 按日期排序的时间序列
  const timeline = Object.entries(byDate)
    .filter(([d]) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, count: v }));

  return {
    stat,
    funnel: [
      { name: '投递', count: stat.applied },
      { name: '简历通过', count: stat.resumePass },
      { name: '笔试通过', count: stat.examPass },
      { name: '面试通过', count: stat.interviewPass },
      { name: 'Offer', count: stat.offer },
    ],
    byChannel: top(byChannel, 10),
    byLocation: top(byLocation, 12),
    byResumeStatus: top(byResumeStatus, 10),
    byCompany: top(byCompany, 15),
    timeline,
    records: list,
  };
}

// ---------------- 存储 ----------------

function getData() { return store.get('jobs') || { updatedAt: null, source: '', sheetName: '', columns: [], records: [] }; }

function importXlsx(filePath) {
  const parsed = parseXlsxFile(filePath);
  const data = {
    updatedAt: new Date().toISOString(),
    source: path.basename(filePath),
    sheetName: parsed.sheetName,
    columns: parsed.columns,
    records: parsed.records,
  };
  store.set('jobs', data);
  store.flush();
  return { ok: true, count: parsed.records.length, sheetName: parsed.sheetName, columns: parsed.columns };
}

function getDashboard() {
  const d = getData();
  return Object.assign({ updatedAt: d.updatedAt, source: d.source, sheetName: d.sheetName, columns: d.columns }, analyze(d.records));
}

function clear() { store.set('jobs', { updatedAt: null, source: '', sheetName: '', columns: [], records: [] }); return true; }

module.exports = { toDateStr, parseXlsxFile, analyze, importXlsx, getData, getDashboard, clear };
