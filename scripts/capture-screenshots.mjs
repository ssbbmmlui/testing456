#!/usr/bin/env node
/**
 * WordLab 截圖產生器
 * ------------------------------------------------------------------
 * 為介紹網站產生乾淨的產品截圖（等動畫完成後才截，避免拍到淡入中的畫面）。
 *
 * 前置：
 *   npm install          # playwright-core
 *   node scripts/build.mjs
 * 執行：
 *   node scripts/capture-screenshots.mjs
 */
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.env.SITE_DIR ? resolve(process.env.SITE_DIR) : join(ROOT, '_site');
const OUT = join(ROOT, 'docs', 'screenshots');
const wait = ms => new Promise(r => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = CANDIDATES.find(p => existsSync(p));
if (!executablePath) {
  console.error('找不到 Chrome / Edge。請設定 CHROME_PATH 後再試。');
  process.exit(2);
}
if (!existsSync(join(SITE, 'app.html'))) {
  console.error(`找不到 ${SITE}/app.html，請先執行 node scripts/build.mjs`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const fileUrl = p => pathToFileURL(join(SITE, p)).href;
const browser = await chromium.launch({ executablePath, headless: true });

/** 等畫面動畫（cardIn / viewIn，約 0.36s）完成 */
const settle = () => wait(900);

/* ---------- 桌面：學習 / 測驗 / 進度 / 單詞庫 ---------- */
const desktop = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1.5,
  reducedMotion: 'reduce',      // 關閉動畫，確保截圖不拍到淡入中的畫面
});
const page = await desktop.newPage();
await page.goto(fileUrl('app.html'));
await settle();

// 引導頁 → 開始學習
await page.fill('#obName', '小明');
await page.click('#obStart');
await settle();

// 翻面 → 學習卡片（背面）
await page.click('#revealBtn');
await settle();
await page.screenshot({ path: join(OUT, '03-card-back.png') });
console.log('✓ 03-card-back.png（學習卡片）');

// 評分 → 測驗
await page.keyboard.press('2');
await wait(300);
await page.click('[data-tab="quiz"]');
await settle();
await page.click('[data-mode="mean"]');
await page.click('#startQuizBtn');
await settle();
await page.screenshot({ path: join(OUT, '07-quiz-question.png') });
console.log('✓ 07-quiz-question.png（測驗）');

// 作答 → 測驗結果（順便產生測驗紀錄，讓進度頁有內容）
await page.locator('.option').first().click();
await wait(500);
for (let i = 0; i < 12; i++) {
  if (!(await page.locator('#nextQBtn').count())) break;
  await page.click('#nextQBtn');
  await wait(220);
  if (await page.locator('.option').count()) {
    await page.locator('.option').nth(1).click();
    await wait(220);
  }
}
await settle();

// 補一些歷史，讓學習足跡有顏色
await page.evaluate(() => {
  const app = window.__WORDLAB__;
  const s = app.getState();
  const today = new Date();
  for (let i = 1; i < 75; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (i % 5 === 2) continue;
    const key = app.dateKey(d);
    const n = [3, 7, 14, 22][(i * 3) % 4];
    s.days[key] = { reviews: n, correct: n - 1, new: Math.min(n, 4), quizzes: 0, quizCorrect: 0 };
  }
  localStorage.setItem('wordlab.v1', JSON.stringify(s));
});
await page.reload();
await settle();

// 進度頁
await page.click('[data-tab="stats"]');
await settle();
await page.screenshot({ path: join(OUT, '05-stats.png') });
console.log('✓ 05-stats.png（進度）');

// 單詞庫
await page.click('[data-tab="library"]');
await settle();
await page.screenshot({ path: join(OUT, '10-library.png') });
console.log('✓ 10-library.png（單詞庫）');

await desktop.close();

/* ---------- 手機：學習卡片（首頁 hero 用） ---------- */
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'reduce',
});
const mpage = await mobile.newPage();
await mpage.goto(fileUrl('app.html'));
await settle();
await mpage.click('#obStart');
await settle();
await mpage.click('#revealBtn');
await settle();
await mpage.screenshot({ path: join(OUT, 'mobile-02-card-back.png') });
console.log('✓ mobile-02-card-back.png（手機學習卡片）');
await mobile.close();

/* ---------- 介紹網站 ---------- */
// 先把剛產生的截圖同步到 _site，否則介紹頁會引用到舊圖
mkdirSync(join(SITE, 'docs', 'screenshots'), { recursive: true });
for (const f of ['03-card-back.png', '07-quiz-question.png', '05-stats.png', '10-library.png', 'mobile-02-card-back.png']) {
  cpSync(join(OUT, f), join(SITE, 'docs', 'screenshots', f));
}

const site = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });
const spage = await site.newPage();
await spage.goto(fileUrl('index.html'));
await wait(700);
await spage.screenshot({ path: join(OUT, 'site-desktop.png') });
console.log('✓ site-desktop.png（介紹頁・桌面）');
await spage.setViewportSize({ width: 390, height: 844 });
await wait(500);
await spage.screenshot({ path: join(OUT, 'site-mobile.png') });
console.log('✓ site-mobile.png（介紹頁・手機）');
await site.close();

await browser.close();
console.log('\n全部截圖已更新到 docs/screenshots/');
