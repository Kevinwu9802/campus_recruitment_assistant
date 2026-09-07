'use strict';
/* 验证 SPA 站点抓取：卡码笔记详情页 */
const { app } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
app.disableHardwareAcceleration();

const store = require('../main/store');
const kaoyan = require('../main/kaoyan');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-spa-'));
store.init(path.join(tmp, 'data'));

app.whenReady().then(async () => {
  try {
    const t0 = Date.now();
    const r = await kaoyan.addSourceUrl('https://notes.kamacoder.com/base/cache-control.html', {
      crawl: false,
      onProgress: (m) => console.log('  [进度]', m),
    });
    console.log('抓取结果:', JSON.stringify(r), '| 耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    const cards = kaoyan.listCards({});
    console.log('卡片数:', cards.length);
    cards.slice(0, 8).forEach((c, i) => console.log(`  [${i}] 题目=${c.topic.slice(0, 26)} | 出处=${c.sourceName.slice(0, 20)} | 答案=${c.answer.slice(0, 22)}`));
    // 统计不全是错误题（过滤掉“卡码笔记-最强八股文/首页计算机基础”这类导航）
    const bad = cards.filter(c => /卡码笔记|首页|大厂面试题|代码随想录/.test(c.topic)).length;
    console.log('疑似导航噪音卡数:', bad, '/', cards.length);
  } catch (e) {
    console.error('测试异常:', e.message);
  }
  app.exit(0);
});
