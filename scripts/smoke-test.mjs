#!/usr/bin/env node
/**
 * WordLab smoke test — 用無頭瀏覽器跑一次主要流程
 * ------------------------------------------------------------------
 * 涵蓋兩個頁面：
 *   1. index.html  商業介紹網站（內容、CTA、錨點、無水平溢出）
 *   2. app.html    學習 App（原有功能：翻卡、評分、測驗、進度、單詞庫）
 *
 * 前置：
 *   npm install          # 安裝 playwright-core
 *   node scripts/build.mjs
 * 執行：
 *   node scripts/smoke-test.mjs
 *
 * 會自動尋找 Edge 或 Chrome；找不到時可用 CHROME_PATH 指定。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.env.SITE_DIR ? resolve(process.env.SITE_DIR) : join(ROOT, '_site');
const wait = ms => new Promise(r => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = CANDIDATES.find(p => existsSync(p));
if (!executablePath) {
  console.error('找不到 Chrome / Edge。請設定 CHROME_PATH 環境變數後再試。');
  process.exit(2);
}
for (const page of ['index.html', 'app.html']) {
  if (!existsSync(join(SITE, page))) {
    console.error(`找不到 ${SITE}/${page}，請先執行 node scripts/build.mjs`);
    process.exit(2);
  }
}

const results = [];
const ok = (name, pass, note = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + note : ''}`);
};

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1100, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const fileUrl = p => pathToFileURL(join(SITE, p)).href;

/* ══════════════════════════════════════════════════════════
   1. 商業介紹網站 index.html
   ══════════════════════════════════════════════════════════ */
await page.goto(fileUrl('index.html'));
await wait(500);

ok('介紹頁載入', (await page.locator('.site-nav').count()) === 1);
ok('介紹頁有主標題', (await page.locator('h1.hero-title').count()) === 1,
  (await page.locator('h1.hero-title').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 40));

// 主要區塊都要存在
for (const [sel, name] of [
  ['#features', '產品特色'],
  ['#how', '運作方式'],
  ['#levels', '難度分級'],
  ['#modes', '測驗模式'],
  ['#screens', '介面預覽'],
  ['#faq', '常見問題'],
]) {
  ok(`介紹頁包含「${name}」區塊`, (await page.locator(sel).count()) === 1);
}

// 功能卡片與 FAQ 數量
const featureCards = await page.locator('.feature-card').count();
ok('六個功能卡片', featureCards === 6, `${featureCards} 個`);
const faqItems = await page.locator('.faq-item').count();
ok('FAQ 有 8 條', faqItems === 8, `${faqItems} 條`);

// 圖片都有載入成功（naturalWidth > 0）
const imgState = await page.evaluate(() => {
  const imgs = Array.from(document.images);
  return {
    total: imgs.length,
    broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
  };
});
ok('介紹頁圖片全部載入', imgState.total > 0 && imgState.broken.length === 0, `${imgState.total} 張 · 壞圖 ${imgState.broken.join(',') || '0'}`);

// CTA 連到 App
const ctaHrefs = await page.$$eval('a[href^="app.html"]', els => els.map(e => e.getAttribute('href')));
ok('CTA 連到 app.html', ctaHrefs.length >= 3 && ctaHrefs.every(h => h.startsWith('app.html')), `${ctaHrefs.length} 個連結`);

// 沒有未替換的模板殘留
const rawTemplate = await page.evaluate(() => /\$\{|\{\{|undefined|NaN/.test(document.body.innerText));
ok('頁面沒有模板殘留字串', rawTemplate === false);

// 導覽列 sticky
const navPos = await page.evaluate(() => getComputedStyle(document.getElementById('siteNav')).position);
ok('導覽列為 sticky', navPos === 'sticky', navPos);

// FAQ 可展開
await page.locator('.faq-item').first().locator('summary').click();
await wait(200);
const firstFaqOpen = await page.locator('.faq-item').first().evaluate(el => el.open);
ok('FAQ 可展開', firstFaqOpen === true);

// 手機版沒有水平溢出
await page.setViewportSize({ width: 390, height: 844 });
await wait(300);
const overflowLanding = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok('介紹頁手機版無水平溢出', overflowLanding <= 1, `${overflowLanding}px`);

/* ══════════════════════════════════════════════════════════
   2. 學習 App app.html（原有功能必須完整）
   ══════════════════════════════════════════════════════════ */
await page.setViewportSize({ width: 1100, height: 950 });
await page.goto(fileUrl('app.html'));
await wait(600);

ok('App 載入（引導頁）', (await page.locator('.onboard').count()) === 1);
const wordCount = await page.evaluate(() => window.__WORDLAB__?.words.length ?? 0);
ok('App 載入 700 個單詞', wordCount === 700, `${wordCount} 個`);
ok('四個難度都存在', await page.evaluate(() => {
  const lv = new Set(window.__WORDLAB__.words.map(w => w.level));
  return [1, 2, 3, 4].every(x => lv.has(x));
}));
ok('App 有回到介紹頁的連結', (await page.locator('footer a[href="index.html"]').count()) === 1);

// 開始學習
await page.fill('#obName', '測試員');
await page.click('#obStart');
await wait(400);
ok('進入學習卡片', (await page.locator('.flashcard').count()) === 1);

await page.click('#revealBtn');
await wait(260);
ok('翻面顯示中文釋義', (await page.locator('.fc-zh').count()) === 1);
ok('翻面顯示例句', (await page.locator('.example-en').count()) === 1);
ok('三個評分按鈕', (await page.locator('.rate-btn').count()) === 3);

// 完成一輪
let cardsDone = 0;
for (let i = 0; i < 20; i++) {
  if (!(await page.locator('.rate-btn').count())) {
    if (!(await page.locator('#revealBtn').count())) break;
    await page.click('#revealBtn');
    await wait(120);
  }
  if (!(await page.locator('.rate-btn').count())) break;
  await page.keyboard.press(i % 4 === 0 ? '1' : '2');
  await wait(140);
  cardsDone++;
  if (await page.locator('.done-wrap').count()) break;
}
ok('完成一輪顯示結算', (await page.locator('.done-wrap').count()) === 1, `${cardsDone} 張卡片`);

// 測驗
await page.click('[data-tab="quiz"]');
await wait(320);
await page.click('[data-mode="mean"]');
await page.click('#startQuizBtn');
await wait(320);
ok('測驗有四個選項', (await page.locator('.option').count()) === 4);
for (let i = 0; i < 10; i++) {
  if (!(await page.locator('.option').count())) break;
  await page.locator('.option').first().click();
  await wait(160);
  if (await page.locator('#nextQBtn').count()) {
    await page.click('#nextQBtn');
    await wait(160);
  }
}
ok('測驗完成顯示成績', (await page.locator('.quiz-summary').count()) === 1);

// 進度
await page.click('[data-tab="stats"]');
await wait(420);
ok('進度頁有統計卡', (await page.locator('.stat').count()) === 4);
ok('進度頁有難度分布', (await page.locator('.level-card').count()) === 4);
const heat = await page.evaluate(() => {
  const map = document.querySelector('.heatmap');
  const panel = map && map.closest('.panel');
  if (!map || !panel) return null;
  const m = map.getBoundingClientRect(), p = panel.getBoundingClientRect();
  return { inside: m.right <= p.right + 1 && m.bottom <= p.bottom + 1, cells: map.querySelectorAll('.hm-cell').length };
});
ok('學習足跡不出界', heat && heat.inside && heat.cells === 84, JSON.stringify(heat));

// 單詞庫
await page.click('[data-tab="library"]');
await wait(360);
ok('單詞庫可搜尋', (await page.locator('#libSearch').count()) === 1);
await page.fill('#libSearch', 'abandon');
await wait(260);
ok('搜尋有結果', (await page.locator('.lib-row').count()) >= 1);

// 設定面板
await page.click('#settingsBtn');
await wait(300);
ok('設定面板可開啟', (await page.locator('#setName').count()) === 1);
ok('設定有難度選擇', (await page.locator('#setLevel').count()) === 1);
await page.keyboard.press('Escape');
await wait(200);

// 手機版
await page.setViewportSize({ width: 390, height: 844 });
await wait(320);
const overflowApp = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok('App 手機版無水平溢出', overflowApp <= 1, `${overflowApp}px`);

ok('沒有 JavaScript 錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) {
  console.error('FAILED: ' + failed.map(f => f.name).join(' | '));
  process.exit(1);
}
