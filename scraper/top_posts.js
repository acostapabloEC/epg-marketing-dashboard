/**
 * top_posts.js
 * Find Frank's top-performing LinkedIn posts for a given week, ranked by
 * engagement, with a text preview for each. Independent of Carla's report
 * (carla_report.js) — shares only the underlying LinkedIn automation
 * (linkedin_export.mjs), not the report itself.
 *
 * Usage: node top_posts.js [startDate] [endDate] [--top N] [--json] [--write]
 * Example: node top_posts.js 2026-07-06 2026-07-12 --top 3 --write
 *
 * --write updates src/data/weekly-data.json's linkedin.topPosts directly —
 * that's the file the dashboard/newsletter build already reads, so this
 * replaces the manual copy-paste step. Nothing else in that file is touched.
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ensureLoggedIn, setCustomDateRange, exportAnalyticsWorkbook } from './linkedin_export.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_PROFILE = path.join(__dirname, 'edge-profile');
const WEEKLY_DATA_PATH = path.join(__dirname, '..', 'src', 'data', 'weekly-data.json');

const rawArgs  = process.argv.slice(2);
const jsonMode = rawArgs.includes('--json');
const writeMode = rawArgs.includes('--write');
const topIdx   = rawArgs.indexOf('--top');
const topN     = topIdx !== -1 ? parseInt(rawArgs[topIdx + 1], 10) : 3;
const args     = rawArgs.filter((a, i) => a !== '--json' && a !== '--write' && a !== '--top' && i !== topIdx + 1);
const startDate = args[0] || '2026-07-01';
const endDate   = args[1] || '2026-07-05';

async function main() {
  const { LINKEDIN_EMAIL, LINKEDIN_PASSWORD } = process.env;
  if (!LINKEDIN_EMAIL || !LINKEDIN_PASSWORD) {
    console.error('ERROR: Missing LINKEDIN_EMAIL or LINKEDIN_PASSWORD in .env');
    process.exit(1);
  }

  if (!jsonMode) console.log(`\nTop LinkedIn Posts: ${startDate} → ${endDate} (top ${topN})\n`);

  const context = await chromium.launchPersistentContext(SCRAPER_PROFILE, {
    channel: 'msedge',
    headless: false,
    slowMo: 100,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, LINKEDIN_EMAIL, LINKEDIN_PASSWORD);
    await setCustomDateRange(page, startDate, endDate, { debugPrefix: 'debug-top-posts' });

    const tmpPath = path.join(__dirname, 'top_posts_export_tmp.xlsx');
    const wb = await exportAnalyticsWorkbook(page, tmpPath);
    if (!wb) throw new Error('Export failed — no workbook to parse.');

    const XLSX = await import('xlsx');
    const ranked = extractTopByEngagement(XLSX, wb, startDate, endDate);
    const top = ranked.slice(0, topN);

    if (!jsonMode) console.log(`Fetching text preview for ${top.length} post(s)...\n`);
    const withPreviews = [];
    for (const post of top) {
      const preview = await fetchPostPreview(page, post.url);
      withPreviews.push({ ...post, preview });
      if (!jsonMode) console.log(`  ${post.date} | ${post.engagements} eng | ${post.impressions} impr\n  ${preview.slice(0, 100)}...\n`);
    }

    if (writeMode) writeTopPosts(withPreviews);

    if (jsonMode) {
      process.stdout.write(JSON.stringify({ startDate, endDate, topPosts: withPreviews }) + '\n');
    } else {
      console.log('══════════════════════════════════════════');
      console.log(`  Top ${withPreviews.length} posts — ${startDate} to ${endDate}`);
      if (writeMode) console.log(`  Written to ${WEEKLY_DATA_PATH}`);
      console.log('══════════════════════════════════════════');
    }
  } finally {
    await context.close();
  }
}

// Updates only linkedin.topPosts in weekly-data.json — everything else in the file (engagement
// totals, followers, outbound activity, etc.) is left untouched; those come from other sources.
function writeTopPosts(posts) {
  const data = JSON.parse(fs.readFileSync(WEEKLY_DATA_PATH, 'utf-8'));
  data.linkedin = data.linkedin || {};
  data.linkedin.topPosts = posts.map(p => ({
    url: p.url,
    date: p.date,
    engagements: p.engagements,
    impressions: p.impressions,
    preview: p.preview,
  }));
  fs.writeFileSync(WEEKLY_DATA_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// The XLSX export's TOP POSTS sheet holds two side-by-side tables (engagement-ranked and
// impression-ranked, up to 50 rows each) under a title row + header row. Read raw so we don't
// let a stray title cell get treated as the object keys.
function extractTopByEngagement(XLSX, wb, startDate, endDate) {
  const sheetName = wb.SheetNames.find(n => /top ?posts|publicaciones/i.test(n));
  if (!sheetName) throw new Error('No TOP POSTS sheet found in export.');

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false });

  const start = new Date(startDate + 'T00:00:00');
  const end   = new Date(endDate + 'T23:59:59');

  // Build an impressions lookup (right-hand table, cols 4-6) keyed by URL, since the two
  // tables are independently sorted and don't line up row-by-row.
  const impressionsByUrl = new Map();
  for (const row of rows.slice(2)) {
    const [, , , , url, , impr] = row;
    if (url) impressionsByUrl.set(url, parseInt(impr, 10) || 0);
  }

  const byEngagement = [];
  for (const row of rows.slice(2)) {
    const [url, dateStr, eng] = row;
    if (!url || !dateStr) continue;
    const d = new Date(dateStr + ' 12:00:00');
    if (isNaN(d) || d < start || d > end) continue;
    byEngagement.push({
      url,
      date: dateStr,
      engagements: parseInt(eng, 10) || 0,
      impressions: impressionsByUrl.get(url) || 0,
    });
  }

  byEngagement.sort((a, b) => b.engagements - a.engagements);
  return byEngagement;
}

// Reuses the text-extraction approach from fetch_post_text.mjs: LinkedIn post text lives in a
// span[dir="ltr"] inside the feed update; fall back to the longest such span on the page.
async function fetchPostPreview(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const selectors = [
      '.feed-shared-update-v2__description span[dir="ltr"]',
      '.feed-shared-text span[dir="ltr"]',
      '.update-components-text span[dir="ltr"]',
      'article span[dir="ltr"]',
      '[data-test-id="main-feed-activity-card"] span[dir="ltr"]',
    ];

    let text = '';
    for (const sel of selectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          text = await el.innerText();
          if (text.trim().length > 20) break;
        }
      } catch { /* try next */ }
    }

    if (!text || text.length < 20) {
      const spans = await page.locator('span[dir="ltr"]').allInnerTexts();
      text = spans
        .map(s => s.trim())
        .filter(s => s.length > 30 && !/^(Like|Comment|Repost|Send|Follow|Connect|Share)$/i.test(s))
        .sort((a, b) => b.length - a.length)[0] || '';
    }

    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch (e) {
    console.warn(`  Failed to fetch preview for ${url}: ${e.message}`);
    return '';
  }
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
