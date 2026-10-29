#!/usr/bin/env node
/**
 * WordLab build script
 * ------------------------------------------------------------------
 * 1. 驗證單詞資料（欄位、重複、難度分布）
 * 2. 驗證兩個頁面：index.html（介紹網站）與 app.html（學習 App）
 * 3. 把靜態網站輸出到 _site/（只包含部署需要的檔案）
 *
 * 用法：
 *   node scripts/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');

/* ---------- 讀取資料 ---------- */
const sandbox = { window: {} };
vm.createContext(sandbox);

function loadScript(rel) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) throw new Error(`缺少檔案：${rel}`);
  vm.runInContext(readFileSync(file, 'utf8'), sandbox, { filename: rel });
  return sandbox.window;
}

loadScript('data/words.js');
const base = sandbox.window.WORDS || [];
loadScript('data/words-extra.js');
loadScript('data/words-extra2.js');

const all = [...base, ...(sandbox.window.WORDS_EXTRA || []), ...(sandbox.window.WORDS_EXTRA2 || [])];
const words = [];
const seenId = new Set();
const seenWord = new Set();
for (const w of all) {
  if (!w || !w.id || !w.word) continue;
  const key = String(w.word).toLowerCase();
  if (seenId.has(w.id) || seenWord.has(key)) continue;
  seenId.add(w.id);
  seenWord.add(key);
  words.push(w);
}

/* ---------- 驗證單詞資料 ---------- */
const errors = [];
const required = ['id', 'word', 'phonetic', 'pos', 'zh', 'def', 'example', 'exampleZh'];
for (const w of words) {
  for (const field of required) {
    if (!w[field] || typeof w[field] !== 'string') errors.push(`${w.id || '?'}：缺少 ${field}`);
  }
  if (!/^\/.+\/$/.test(w.phonetic || '')) errors.push(`${w.id}：音標格式錯誤 ${w.phonetic}`);
  if (![1, 2, 3, 4].includes(w.level)) errors.push(`${w.id}：難度必須是 1-4（目前 ${w.level}）`);
  if (!Array.isArray(w.tags) || w.tags.length === 0) errors.push(`${w.id}：缺少 tags`);
  if (!/[\u4e00-\u9fff]/.test(w.zh || '')) errors.push(`${w.id}：中文釋義缺少中文字`);
}
if (words.length < 300) errors.push(`單詞太少：${words.length}`);

if (errors.length) {
  console.error(`\n✖ 資料驗證失敗（${errors.length} 項）：`);
  errors.slice(0, 30).forEach(e => console.error('  - ' + e));
  if (errors.length > 30) console.error(`  … 另有 ${errors.length - 30} 項`);
  process.exit(1);
}

const byLevel = words.reduce((acc, w) => (acc[w.level] = (acc[w.level] || 0) + 1, acc), {});
const byPos = words.reduce((acc, w) => {
  const key = String(w.pos).replace(/\./g, '');
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

/* ---------- 驗證頁面（編碼 + 必要引用） ---------- */
const MOJIBAKE = /[ÃÂåæçèéêëìîïðñòóôõöøùúûüýþ][\u0080-\u00bf\u2018-\u201d]/;

function readPage(rel) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) { errors.push(`缺少頁面：${rel}`); return ''; }
  const buf = readFileSync(file);
  const text = buf.toString('utf8');
  if (text.includes('\uFFFD')) errors.push(`${rel}：含有無法解碼的字元（編碼不是 UTF-8）`);
  if (MOJIBAKE.test(text)) errors.push(`${rel}：偵測到亂碼（mojibake），請以 UTF-8 儲存`);
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) errors.push(`${rel}：檔案帶有 BOM，請存成不含 BOM 的 UTF-8`);
  return text;
}

const landing = readPage('index.html');
const appPage = readPage('app.html');

// 介紹頁：要有行銷內容、連到 App、引用自己的樣式
const landingMust = ['css/site.css', 'app.html', 'favicon.svg', 'lang="zh-Hant"', '<h1'];
for (const ref of landingMust) {
  if (landing && !landing.includes(ref)) errors.push(`index.html 缺少 ${ref}`);
}
const landingSections = ['#features', '#how', '#levels', '#screens', '#faq'];
for (const ref of landingSections) {
  if (landing && !landing.includes(ref)) errors.push(`index.html 缺少區塊連結 ${ref}`);
}

// App：原有功能必須完整保留
const appMust = [
  'css/style.css', 'js/app.js',
  'data/words.js', 'data/words-extra.js', 'data/words-extra2.js',
  'favicon.svg', 'site.webmanifest',
  'id="view"', 'id="settingsOverlay"', 'id="streakCount"',
];
for (const ref of appMust) {
  if (appPage && !appPage.includes(ref)) errors.push(`app.html 缺少 ${ref}（原有功能可能被破壞）`);
}

// 兩個頁面都要能回首頁 / 進入 App
if (appPage && !appPage.includes('href="index.html"')) errors.push('app.html 缺少回到介紹頁的連結');

/* ---------- 輸出靜態網站 ---------- */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const assets = [
  'index.html',
  'app.html',
  'css',
  'js',
  'data',
  'favicon.svg',
  'site.webmanifest',
];
const copied = [];
for (const asset of assets) {
  const src = join(ROOT, asset);
  if (!existsSync(src)) continue;
  cpSync(src, join(OUT, asset), { recursive: true });
  copied.push(asset);
}

// 只部署介紹頁實際用到的截圖，避免把整個 docs 資料夾推上線
const usedShots = ['03-card-back.png', '07-quiz-question.png', '05-stats.png', '10-library.png', 'mobile-02-card-back.png'];
mkdirSync(join(OUT, 'docs', 'screenshots'), { recursive: true });
for (const shot of usedShots) {
  const src = join(ROOT, 'docs', 'screenshots', shot);
  if (!existsSync(src)) { errors.push(`缺少截圖 docs/screenshots/${shot}`); continue; }
  cpSync(src, join(OUT, 'docs', 'screenshots', shot));
  copied.push(`docs/screenshots/${shot}`);
}

/* ---------- 輸出後的完整性檢查 ---------- */
const outChecks = [
  '_site/index.html',
  '_site/app.html',
  '_site/css/site.css',
  '_site/css/style.css',
  '_site/js/app.js',
  '_site/data/words.js',
  '_site/site.webmanifest',
];
for (const rel of outChecks) {
  if (!existsSync(join(ROOT, rel))) errors.push(`輸出缺少 ${rel}`);
}
for (const shot of usedShots) {
  if (!existsSync(join(OUT, 'docs', 'screenshots', shot))) errors.push(`輸出缺少截圖 docs/screenshots/${shot}`);
}

if (errors.length) {
  console.error('\n✖ 網站檢查失敗：');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}

const stats = {
  words: words.length,
  base: base.length,
  byLevel,
  byPos,
  pages: ['index.html（介紹網站）', 'app.html（學習 App）'],
  builtAt: new Date().toISOString(),
  files: copied,
};
writeFileSync(join(OUT, 'build-stats.json'), JSON.stringify(stats, null, 2));

console.log('✔ 單詞資料驗證通過');
console.log(`  單詞總數：${words.length}`);
console.log(`  難度分布：基礎 ${byLevel[1] || 0} / 中階 ${byLevel[2] || 0} / 進階 ${byLevel[3] || 0} / 高階 ${byLevel[4] || 0}`);
console.log(`  詞性分布：${JSON.stringify(byPos)}`);
console.log('✔ 頁面驗證通過（UTF-8、必要引用、原有功能）');
console.log(`✔ 已輸出靜態網站到 _site（${copied.join('、')}）`);
