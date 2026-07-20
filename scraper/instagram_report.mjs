/**
 * instagram_report.mjs
 * Pull Instagram engagement totals for an exact date range (e.g. a Mon-Sun week).
 * Usage: node instagram_report.mjs <startDate> <endDate> [--json] [--no-scrape]
 * Example: node instagram_report.mjs 2026-07-06 2026-07-12
 *
 * Hootsuite's saved Instagram report (id=18667698) has no custom date-range picker —
 * it always exports month-to-date-through-yesterday. Once a month ends, that month's
 * daily rows disappear from future exports. To keep exact weekly numbers available
 * after month rollover, every scrape merges its daily rows into a local archive at
 * data/instagram_daily_archive.json (keyed by date), so sums are computed from the
 * archive rather than from whatever window Hootsuite happens to show today.
 *
 * "Daily aggregated" vs "Overall aggregated" columns: the export has duplicate metric
 * names (e.g. two "Post views" columns) — one is a running/overall total, the other is
 * the per-day value. Only the per-day columns are safe to sum across days. CONFIRMED
 * BY TESTING: which of the two duplicate columns is "Daily" is NOT stable between
 * exports — Hootsuite reorders columns run to run, so a fixed key/suffix assumption
 * (e.g. "the _1 one is always Daily") silently reads the wrong column on some runs.
 * parseDailyRows() therefore reads row 1 (headers) + row 2 (aggregation-type labels)
 * together on every parse and picks whichever column is actually labeled "Daily
 * aggregated" for each metric, rather than trusting a fixed name.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, 'hootsuite-profile');
const DOWNLOAD_DIR = path.join(__dirname, 'hootsuite-downloads');
const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVE_PATH = path.join(DATA_DIR, 'instagram_daily_archive.json');
const REPORT_URL = 'https://hootsuite.com/dashboard#/analytics/report?id=18667698';
const METRIC_LABELS = {
  likes: 'Post likes',
  views: 'Post views',
  comments: 'Post comments',
  saves: 'Post saves',
  engagement: 'Post engagement',
  shares: 'Post shares',
};

mkdirSync(DOWNLOAD_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

const rawArgs = process.argv.slice(2);
const jsonMode = rawArgs.includes('--json');
const noScrape = rawArgs.includes('--no-scrape');
const args = rawArgs.filter(a => !a.startsWith('--'));
const [startDate, endDate] = args;

if (!startDate || !endDate) {
  console.error('Usage: node instagram_report.mjs <startDate YYYY-MM-DD> <endDate YYYY-MM-DD> [--json] [--no-scrape]');
  process.exit(1);
}

// A prior run that crashed or got killed (e.g. hit the 5-minute login timeout while
// unattended) can leave its Edge process and profile lockfile behind. Since this script
// is the only thing that ever opens PROFILE, anything still holding it at startup is
// necessarily stale — clear it so a Monday-morning run isn't blocked before it starts.
function cleanupStaleProfileLock() {
  try {
    const escaped = PROFILE.replace(/\\/g, '\\\\').replace(/'/g, "''");
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${escaped}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    );
  } catch { /* best-effort cleanup — real errors still surface from launchPersistentContext below */ }
  const lockPath = path.join(PROFILE, 'lockfile');
  if (existsSync(lockPath)) {
    try { unlinkSync(lockPath); } catch { /* still held by something else; let the real error surface */ }
  }
}

async function scrapeInstagramReport() {
  console.log('Launching Edge...');
  cleanupStaleProfileLock();
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'msedge',
    headless: false,
    slowMo: 200,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    await page.goto('https://hootsuite.com/dashboard#/analytics', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    if (page.url().includes('signin') || page.url().includes('login')) {
      console.log('\n⚠ Please log in to Hootsuite in the browser window, then leave it open.');
      await page.waitForURL('**hootsuite.com/dashboard**', { timeout: 300000 });
      await page.waitForTimeout(2000);
      await page.goto('https://hootsuite.com/dashboard#/analytics', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    }
    console.log('Logged in.');

    const dismissCookieModal = async () => {
      const btn = page.locator('button:has-text("Confirm My Choices")').first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(800);
      }
    };
    await dismissCookieModal();

    console.log('\n--- Exporting Instagram engagement ---');
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    await dismissCookieModal();

    let fileUrl = null;
    const responseHandler = async res => {
      if (res.url().includes('/service/web/v1/exports/') && res.request().method() === 'POST') {
        try {
          const body = await res.json();
          const links = body.links || [];
          for (const l of links) {
            const href = l.link || l.href || l.url;
            if (href) { fileUrl = href.startsWith('http') ? href : `https://measure.hootsuite.com${href}`; break; }
          }
          if (!fileUrl) fileUrl = body.file_url || body.url || body.download_url;
        } catch { /* ignore parse failures, polling below will time out */ }
      }
    };
    page.on('response', responseHandler);

    const dismissPendoGuide = async () => {
      const pendoBase = page.locator('#pendo-base');
      if (await pendoBase.count() === 0) return;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
      const closeBtn = pendoBase.locator('button[aria-label="Close"], ._pendo-close-guide, [class*="pendo-close"]').first();
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    };
    await dismissPendoGuide();

    const exportBtn = page.locator('button:has-text("Export")').first();
    await exportBtn.waitFor({ state: 'visible', timeout: 10000 });
    // Hootsuite's Pendo onboarding backdrop can still cover the button even after
    // the dismiss attempt above (observed 2026-07-20) — force bypasses the
    // pointer-interception actionability check and clicks the real element directly.
    await exportBtn.click({ force: true });
    await page.waitForTimeout(1500);

    const allEls = await page.locator('button, div, span, li').all();
    let clicked = false;
    for (const el of allEls) {
      const text = await el.innerText({ timeout: 100 }).catch(() => '');
      if (text.trim() === 'Microsoft Excel (.xlsx)') {
        const box = await el.boundingBox();
        if (box && box.width > 0) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          clicked = true;
          break;
        }
      }
    }
    if (!clicked) {
      page.off('response', responseHandler);
      throw new Error('Could not find Excel export option — Hootsuite UI may have changed');
    }

    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      if (fileUrl) break;
    }
    page.off('response', responseHandler);

    if (fileUrl && fileUrl.includes('/exports/')) {
      console.log('  Polling export status...');
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(3000);
        const resp = await page.request.get(fileUrl, { headers: { Accept: 'application/json' } });
        const body = await resp.json().catch(() => ({}));
        if (body.url) { fileUrl = body.url; break; }
        if (body.state === 'failed') throw new Error('Hootsuite export failed');
      }
    }
    if (!fileUrl || fileUrl.includes('/exports/')) {
      throw new Error('No download URL found for Instagram export');
    }

    const today = new Date().toISOString().slice(0, 10);
    const destPath = path.join(DOWNLOAD_DIR, `instagram_engagement_${today}.xlsx`);
    const fileResp = await page.request.get(fileUrl);
    writeFileSync(destPath, await fileResp.body());
    console.log(`Saved: ${destPath}`);
    return destPath;
  } finally {
    await context.close();
  }
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  return parseInt(String(v).replace(/,/g, ''), 10) || 0;
}

async function parseDailyRows(xlsxPath) {
  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets['Account Metrics'];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  const headers = grid[0];
  const aggTypes = grid[1];
  const dataRows = grid.slice(2);

  const colIndex = {};
  for (const [key, label] of Object.entries(METRIC_LABELS)) {
    const idx = headers.findIndex((h, i) => h === label && /daily/i.test(aggTypes[i] || ''));
    if (idx === -1) throw new Error(`Could not find a "Daily aggregated" column for "${label}" — Hootsuite export layout may have changed further.`);
    colIndex[key] = idx;
  }
  const dateColIdx = headers.indexOf('Date (GMT)');

  const daily = {};
  for (const row of dataRows) {
    const date = row[dateColIdx];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const entry = {};
    for (const [key, idx] of Object.entries(colIndex)) entry[key] = toNum(row[idx]);
    daily[date] = entry;
  }
  return daily;
}

async function parseTopPosts(xlsxPath, start, end, limit = 3) {
  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets['IG - Posts table'];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { raw: false });
  const startD = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T23:59:59Z');

  return rows
    .map(r => {
      const raw = r['Date (GMT)'] || '';
      const d = new Date(raw.replace(' ', 'T') + 'Z');
      return { r, d };
    })
    .filter(({ d }) => !isNaN(d) && d >= startD && d <= endD)
    .map(({ r, d }) => ({
      postId: r['Instagram Post ID'],
      date: d.toISOString().slice(0, 10),
      type: r['Post Type'],
      caption: r['Post Message'] || '',
      likes: toNum(r['Likes']),
      comments: toNum(r['Comments']),
      shares: toNum(r['Shares']),
      saves: toNum(r['Saves']),
      views: toNum(r['Views']),
      reach: toNum(r['Reach']),
      engagement: toNum(r['Engagement']),
      engRate: parseFloat(r['Engagement rate']) || 0,
    }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, limit);
}

function findLatestDownloadedExport() {
  const files = readdirSync(DOWNLOAD_DIR)
    .filter(f => /^instagram_engagement_\d{4}-\d{2}-\d{2}\.xlsx$/.test(f))
    .map(f => ({ f, mtime: statSync(path.join(DOWNLOAD_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? path.join(DOWNLOAD_DIR, files[0].f) : null;
}

function loadArchive() {
  if (!existsSync(ARCHIVE_PATH)) return {};
  return JSON.parse(readFileSync(ARCHIVE_PATH, 'utf8'));
}

function saveArchive(archive) {
  const sorted = Object.fromEntries(Object.keys(archive).sort().map(k => [k, archive[k]]));
  writeFileSync(ARCHIVE_PATH, JSON.stringify(sorted, null, 2));
}

function sumRange(archive, start, end) {
  const totals = { likes: 0, views: 0, comments: 0, saves: 0, engagement: 0, shares: 0 };
  const foundDays = [];
  const missing = [];
  let d = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T00:00:00Z');
  while (d <= endD) {
    const key = d.toISOString().slice(0, 10);
    if (archive[key]) {
      for (const k of Object.keys(totals)) totals[k] += archive[key][k];
      foundDays.push(key);
    } else {
      missing.push(key);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { totals, foundDays, missing };
}

async function main() {
  let archive = loadArchive();
  let xlsxPath;

  if (!noScrape) {
    xlsxPath = await scrapeInstagramReport();
    const daily = await parseDailyRows(xlsxPath);
    archive = { ...archive, ...daily };
    saveArchive(archive);
  } else {
    xlsxPath = findLatestDownloadedExport();
    if (!xlsxPath) throw new Error('No existing export in hootsuite-downloads/ to read from — run without --no-scrape first.');
    if (Object.keys(archive).length === 0) {
      console.log(`No archive yet — seeding from ${xlsxPath}`);
      archive = await parseDailyRows(xlsxPath);
      saveArchive(archive);
    }
  }

  const { totals, foundDays, missing } = sumRange(archive, startDate, endDate);
  const topPosts = await parseTopPosts(xlsxPath, startDate, endDate);

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ startDate, endDate, ...totals, daysFound: foundDays.length, missingDays: missing, topPosts }) + '\n');
    return;
  }

  console.log(`\nInstagram ${startDate} → ${endDate} (${foundDays.length}/${foundDays.length + missing.length} days in archive)`);
  console.log(`  Engagement: ${totals.engagement}`);
  console.log(`  Views:      ${totals.views}`);
  console.log(`  Likes:      ${totals.likes}`);
  console.log(`  Comments:   ${totals.comments}`);
  console.log(`  Saves:      ${totals.saves}`);
  console.log(`  Shares:     ${totals.shares}`);
  console.log(`  Top posts this week: ${topPosts.length}`);
  for (const p of topPosts) {
    console.log(`    ${p.date} [${p.type}] eng=${p.engagement} views=${p.views} — ${p.caption.slice(0, 60)}`);
  }
  if (missing.length) {
    console.warn(`\n⚠ No archived data for: ${missing.join(', ')}`);
    console.warn('  Hootsuite\'s report only shows month-to-date, so once a month ends its days');
    console.warn('  are gone unless they were archived before rollover. Run this script weekly');
    console.warn('  (without --no-scrape) to keep the archive current.');
  }
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
