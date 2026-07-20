/**
 * linkedin_export.mjs
 * Shared LinkedIn Creator Analytics automation: login, custom date-range
 * selection, and triggering/downloading the analytics export.
 *
 * Used independently by carla_report.js (engagement totals) and
 * top_posts.js (top-performing posts) — neither depends on the other.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function ensureLoggedIn(page, email, password) {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  if (page.url().includes('/feed/')) {
    console.log('Using saved session.\n');
    return;
  }

  console.log('Logging in...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const hasUsername = await page.locator('#username').isVisible({ timeout: 5000 }).catch(() => false);
  if (hasUsername) {
    await page.fill('#username', email);
    await page.waitForTimeout(400);
  }

  await page.waitForSelector('#password', { timeout: 10000 });
  await page.fill('#password', password);
  await page.waitForTimeout(500);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);

  const url = page.url();
  if (!url.includes('/feed/')) {
    throw new Error(`Login failed — URL: ${url}. Check credentials or complete 2FA manually.`);
  }
  console.log('Login successful.\n');
}

// Finds a leaf element whose text matches `regex` (retrying — LinkedIn's SPA hydrates on its
// own schedule) and clicks its nearest clickable ancestor by coordinates. Matching on text
// content rather than tag/role/language keeps this working whichever locale renders.
export async function clickByText(page, regex, { timeoutMs = 15000, pollMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const box = await page.evaluate((reSource) => {
      const re = new RegExp(reSource, 'i');
      const all = Array.from(document.querySelectorAll('*'));
      // Match on "no child also matches" rather than "no children at all" — the label can
      // wrap an icon/span alongside the text, so a strict leaf check misses it.
      const matches = all.filter(e => re.test((e.textContent || '').trim()));
      const el = matches.find(e => !Array.from(e.children).some(c => re.test((c.textContent || '').trim())));
      if (!el) return null;
      const clickable = el.closest('button, [role="button"], label, a') || el;
      const r = clickable.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, regex.source);
    if (box) {
      await page.mouse.click(box.x, box.y);
      return true;
    }
    await page.waitForTimeout(pollMs);
  }
  return false;
}

function detectDateOrder(prefillValue) {
  const parts = (prefillValue || '').split(/[/\-.]/).map(s => parseInt(s, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return 'DMY';
  const [a, b] = parts;
  const now = new Date();
  if (a === now.getMonth() + 1 && b === now.getDate()) return 'MDY';
  return 'DMY';
}

function formatByOrder(isoDateStr, order) {
  const [y, m, d] = isoDateStr.split('-').map(s => parseInt(s, 10));
  return order === 'MDY' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

// Navigates to Creator Analytics content page and sets the custom date range (start/end are
// ISO "YYYY-MM-DD"). No-ops gracefully (leaving whatever range is showing) if any step of the
// picker can't be found — callers should treat that as "range may not be exact."
export async function setCustomDateRange(page, start, end, { debugPrefix = 'debug' } = {}) {
  await page.goto('https://www.linkedin.com/analytics/creator/content/', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(8000);

  await page.screenshot({ path: path.join(__dirname, `${debugPrefix}-before.png`), fullPage: false }).catch(() => {});

  // LinkedIn's analytics UI intermittently renders in Spanish (account/session-dependent) and
  // its React tree can take several seconds to hydrate after "domcontentloaded" — a fixed
  // wait + English-only text selectors both fail unpredictably.
  const opened = await clickByText(page, /^([0-9]+ d[ií]as|[0-9]+ days)$/, { timeoutMs: 15000 });
  await page.screenshot({ path: path.join(__dirname, `${debugPrefix}-picker.png`), fullPage: false }).catch(() => {});

  if (!opened) {
    console.warn('  Could not open date range dropdown — using whatever is currently showing.');
    return false;
  }
  await page.waitForTimeout(800);

  const pickedCustom = await clickByText(page, /^(custom|personalizado)$/, { timeoutMs: 8000 });
  if (!pickedCustom) {
    console.warn('  No Custom/Personalizado option found — results will reflect the default range.');
    await page.keyboard.press('Escape');
    return false;
  }
  await page.waitForTimeout(800);

  // Start/end inputs are plain text fields (not <input type="date">) laid out under
  // "Fecha de inicio"/"Start date" and "Fecha de finalización"/"End date" labels.
  const inputBoxes = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const startLabel = all.find(el => /^(fecha de inicio|start date)$/i.test((el.textContent || '').trim()) && el.children.length === 0);
    const endLabel = all.find(el => /^(fecha de finalizaci[oó]n|end date)$/i.test((el.textContent || '').trim()) && el.children.length === 0);
    function nearestInput(labelEl) {
      if (!labelEl) return null;
      let container = labelEl.parentElement;
      for (let i = 0; i < 4 && container; i++) {
        const inp = container.querySelector('input');
        if (inp) {
          const r = inp.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, value: inp.value };
        }
        container = container.parentElement;
      }
      return null;
    }
    return { start: nearestInput(startLabel), end: nearestInput(endLabel) };
  });

  if (!inputBoxes.start || !inputBoxes.end) {
    console.warn('  Could not locate start/end date inputs — results will reflect the default range.');
    return false;
  }

  // The displayed date order (D/M/Y vs M/D/Y) follows the account's locale, which — like the
  // language — isn't stable. Infer it from the end input's pre-fill (defaults to today).
  const order = detectDateOrder(inputBoxes.end.value);

  await page.mouse.click(inputBoxes.start.x, inputBoxes.start.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(formatByOrder(start, order), { delay: 30 });
  await page.mouse.click(inputBoxes.end.x, inputBoxes.end.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(formatByOrder(end, order), { delay: 30 });
  await page.waitForTimeout(500);

  const applied = await clickByText(page, /mostrar resultados|show results/, { timeoutMs: 8000 });
  if (!applied) {
    console.warn('  Could not find the Apply/"Show results" button.');
  }
  await page.waitForTimeout(2500);
  return true;
}

// Clicks Export/Exportación, waits for the download, saves it to `destPath`, and returns the
// parsed XLSX workbook (all sheets). Assumes setCustomDateRange() already ran for this page.
export async function exportAnalyticsWorkbook(page, destPath) {
  const XLSX = await import('xlsx');

  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  const exportClicked = await clickByText(page, /^(export|exportaci[oó]n|exportar)$/, { timeoutMs: 8000 });
  if (!exportClicked) {
    console.warn('  Export button not found.');
    return null;
  }
  console.log('  Clicked Export — waiting for confirmation dialog...');

  // A "Confirm to begin downloading" modal shows up first (not always — seems to depend on
  // export size/recency) before the download actually starts.
  await clickByText(page, /^(confirm|confirmar)$/, { timeoutMs: 6000 });
  console.log('  Waiting for download...');

  const download = await downloadPromise;
  await download.saveAs(destPath);
  console.log(`  Downloaded: ${destPath}`);

  // Windows sometimes still holds a brief lock on the file right after saveAs() resolves
  // (antivirus scan, download-manager handle) — retry the read a few times before giving up.
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return XLSX.read(fs.readFileSync(destPath));
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

// The TOP POSTS sheet holds two side-by-side tables (engagement-ranked and impression-ranked,
// up to 50 rows each) under a title row + header row. Read raw so a stray title cell doesn't
// get treated as the object keys. Returns posts published within [startDate, endDate], sorted
// by engagement descending.
export function extractTopPosts(XLSX, wb, startDate, endDate) {
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

// LinkedIn's feed DOM now ships with hashed/atomic CSS class names (no more stable
// .feed-shared-* classes or dir="ltr" markers), so the old selectors below always miss.
// The post body text is still reliably reachable via data-testid="expandable-text-box"
// (falls back to the componentkey="feed-commentary_..." wrapper, then the legacy selectors
// in case LinkedIn A/B-tests an older build).
export async function fetchPostPreview(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const selectors = [
      'span[data-testid="expandable-text-box"]',
      'p[componentkey^="feed-commentary_"]',
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

// ENGAGEMENT sheet: one row per day (Date, Impressions, Engagements). Sums Engagements for days
// within [startDate, endDate]. NOTE: this is "engagement received on any post during the week"
// (a daily aggregate) — a different, larger number than "engagement earned by posts published
// during the week" (see extractTopPosts, which is per-post and only counts new posts). The
// dashboard's weeklyData.engagements field uses this daily-aggregate total, matching what
// Carla's report already sends.
export function extractEngagementTotal(XLSX, wb, startDate, endDate) {
  const sheetName = wb.SheetNames.find(n => /engagement/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { raw: false });

  const startD = new Date(startDate + 'T00:00:00');
  const endD   = new Date(endDate + 'T23:59:59');
  let total = 0;

  for (const row of rows) {
    const dateKey = Object.keys(row).find(k => /date|day/i.test(k));
    const engKey  = Object.keys(row).find(k => /engagement|social/i.test(k));
    if (!dateKey || !engKey) continue;

    const rowDate = new Date(row[dateKey]);
    if (isNaN(rowDate) || rowDate < startD || rowDate > endD) continue;

    total += parseInt(String(row[engKey]).replace(/,/g, ''), 10) || 0;
  }

  return total;
}

// Same ENGAGEMENT sheet as extractEngagementTotal, but returns the per-day rows instead of
// just the sum — used for Carla's report, which shows a daily breakdown.
export function extractDailyEngagements(XLSX, wb, startDate, endDate) {
  const sheetName = wb.SheetNames.find(n => /engagement/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { raw: false });

  const startD = new Date(startDate + 'T00:00:00');
  const endD   = new Date(endDate + 'T23:59:59');
  const daily = [];

  for (const row of rows) {
    const dateKey = Object.keys(row).find(k => /date|day/i.test(k));
    const engKey  = Object.keys(row).find(k => /engagement|social/i.test(k));
    if (!dateKey || !engKey) continue;

    const rowDate = new Date(row[dateKey]);
    if (isNaN(rowDate) || rowDate < startD || rowDate > endD) continue;

    daily.push({
      date: rowDate.toISOString().split('T')[0],
      engagements: parseInt(String(row[engKey]).replace(/,/g, ''), 10) || 0,
    });
  }

  daily.sort((a, b) => a.date.localeCompare(b.date));
  return daily;
}

// DISCOVERY sheet: two rows, "Impressions" and "Members reached", each with one value column
// for the whole selected range (header is something like "7/6/2026 - 7/12/2026").
export function extractDiscoveryTotals(XLSX, wb) {
  const sheetName = wb.SheetNames.find(n => /discovery|descubrimiento/i.test(n));
  if (!sheetName) return { impressions: 0, membersReached: 0 };

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false });
  let impressions = 0, membersReached = 0;
  for (const row of rows.slice(1)) {
    const [label, value] = row;
    if (/impression/i.test(label || '')) impressions = parseInt(value, 10) || 0;
    if (/members? reached/i.test(label || '')) membersReached = parseInt(value, 10) || 0;
  }
  return { impressions, membersReached };
}

// FOLLOWERS sheet: row 0 is ["Total followers on <date>", "<count>"] (label in col A, the
// actual number in col B), row 1 is blank, row 2 is the real header ["Date", "New followers"],
// then data rows as [dateStr, count]. Returns followers gained within [startDate, endDate] plus
// the total as of the export.
export function extractFollowers(XLSX, wb, startDate, endDate) {
  const sheetName = wb.SheetNames.find(n => /followers|seguidores/i.test(n));
  if (!sheetName) return { gained: 0, total: 0 };

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false });
  const total = parseInt(rows[0]?.[1], 10) || 0;

  const start = new Date(startDate + 'T00:00:00');
  const end   = new Date(endDate + 'T23:59:59');
  let gained = 0;
  for (const row of rows.slice(3)) {
    const [dateStr, count] = row;
    if (!dateStr) continue;
    const d = new Date(dateStr + ' 12:00:00');
    if (isNaN(d) || d < start || d > end) continue;
    gained += parseInt(count, 10) || 0;
  }
  return { gained, total };
}
