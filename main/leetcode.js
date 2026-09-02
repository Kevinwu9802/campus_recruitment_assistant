'use strict';
/**
 * leetcode.js — LeetCode.cn GraphQL 抓取
 * 已验证的接口：
 *   1. userProfilePublicProfile(userSlug)          —— 用户公开资料
 *   2. createdPublicFavoriteList(userSlug)         —— 用户创建的公开题单列表
 *   3. favoriteQuestionList(favoriteSlug, ...)     —— 题单内题目（含难度/类别标签）
 * 所有请求走主进程（无 CORS 限制），带超时与重试。
 */
const API = 'https://leetcode.cn/graphql/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 LeetCodeDailyHelper/1.0';

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error('请求超时')), ms));
}

async function gql(operationName, query, variables, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await Promise.race([
        fetch(API, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': UA,
            origin: 'https://leetcode.cn',
            referer: 'https://leetcode.cn/',
            'x-definition-name': operationName,
          },
          body: JSON.stringify({ operationName, query, variables }),
        }),
        timeout(15000),
      ]);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.errors && json.errors.length) {
        throw new Error(json.errors.map(e => e.message).join('; '));
      }
      return json.data;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

/** 从主页 URL 或直接 userSlug 解析出 userSlug */
function parseSlug(input) {
  if (!input) return '';
  const m = String(input).trim().match(/(?:leetcode\.cn|leetcode\.com)\/u\/([^/?#]+)/);
  if (m) return m[1];
  const s = String(input).trim().replace(/^\/+|\/+$/g, '');
  return s || '';
}

const Q_PROFILE = `query userProfilePublicProfile($userSlug: String!) {
  userProfilePublicProfile(userSlug: $userSlug) {
    haveFollowed
    siteRanking
    profile { userSlug realName aboutMe asciiCode userAvatar gender websites skillTags }
  }
}`;

async function getUserProfile(userSlug) {
  const d = await gql('userProfilePublicProfile', Q_PROFILE, { userSlug });
  const p = d && d.userProfilePublicProfile;
  if (!p || !p.profile) throw new Error('未找到用户（请检查 userSlug / 主页链接）');
  return {
    userSlug: p.profile.userSlug,
    realName: p.profile.realName,
    aboutMe: p.profile.aboutMe,
    avatar: p.profile.userAvatar || '',
    skillTags: p.profile.skillTags || [],
    websites: p.profile.websites || [],
    siteRanking: p.siteRanking,
  };
}

const Q_LISTS = `query createdPublicFavoriteList($userSlug: String!) {
  createdPublicFavoriteList(userSlug: $userSlug) {
    hasMore
    totalLength
    favorites {
      slug
      name
      description
      isPublicFavorite
      questionNumber
      isDefaultList
      lastQuestionAddedAt
      viewCount
    }
  }
}`;

/** 用户公开题单（个人主页「题单」Tab 的数据） */
async function getUserLists(userSlug) {
  const d = await gql('createdPublicFavoriteList', Q_LISTS, { userSlug });
  const r = d && d.createdPublicFavoriteList;
  if (!r) throw new Error('获取题单失败');
  const lists = (r.favorites || [])
    .filter(f => f.isPublicFavorite !== false && f.questionNumber > 0)
    .map(f => ({
      slug: f.slug,
      name: f.name,
      description: f.description || '',
      questionNumber: f.questionNumber,
      isDefaultList: !!f.isDefaultList,
      lastQuestionAddedAt: f.lastQuestionAddedAt,
      viewCount: f.viewCount || 0,
    }));
  return { totalLength: r.totalLength, lists };
}

const Q_QUESTIONS = `query favoriteQuestionList($favoriteSlug: String!, $limit: Int, $skip: Int) {
  favoriteQuestionList(favoriteSlug: $favoriteSlug, limit: $limit, skip: $skip) {
    questions {
      difficulty
      paidOnly
      questionFrontendId
      status
      title
      titleSlug
      translatedTitle
      topicTags { name nameTranslated slug }
    }
    totalLength
    hasMore
  }
}`;

/** 题单内全部题目（自动翻页，limit 100/页） */
async function getListQuestions(favoriteSlug, onProgress) {
  const questions = [];
  const limit = 100;
  let skip = 0;
  let total = null;
  for (;;) {
    const d = await gql('favoriteQuestionList', Q_QUESTIONS, {
      favoriteSlug, limit, skip,
    });
    const r = d && d.favoriteQuestionList;
    if (!r) throw new Error('获取题单题目失败: ' + favoriteSlug);
    total = r.totalLength;
    questions.push(...(r.questions || []));
    if (onProgress) onProgress(questions.length, total);
    if (!r.hasMore || questions.length >= total) break;
    skip += limit;
  }
  return {
    totalLength: total,
    questions: questions.map(q => ({
      questionFrontendId: q.questionFrontendId,
      title: q.title,
      translatedTitle: q.translatedTitle || q.title,
      titleSlug: q.titleSlug,
      difficulty: q.difficulty,
      paidOnly: !!q.paidOnly,
      status: q.status || 'TO_DO',
      tags: (q.topicTags || []).map(t => ({
        name: t.name,
        nameTranslated: t.nameTranslated || t.name,
        slug: t.slug,
      })),
    })),
  };
}

module.exports = { parseSlug, getUserProfile, getUserLists, getListQuestions };
