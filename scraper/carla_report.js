/**
 * carla_report.js
 * Pull LinkedIn engagement for a custom date range and print the result.
 * This is Carla's weekly report — engagement totals only, nothing else.
 * Usage: node carla_report.js [startDate] [endDate]
 * Example: node carla_report.js 2026-07-01 2026-07-05
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ensureLoggedIn, setCustomDateRange, exportAnalyticsWorkbook } from './linkedin_export.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_PROFILE = path.join(__dirname, 'edge-profile');

const args = process.argv.slice(2).filter(a => a !== '--json');
const jsonMode  = process.argv.includes('--json');
const startDate = args[0] || '2026-07-01';
const endDate   = args[1] || '2026-07-05';

const startLabel = formatDateLabel(startDate); // e.g. "Jul 1, 2026"
const endLabel   = formatDateLabel(endDate);

console.log(`\nLinkedIn Engagement Pull: ${startLabel} → ${endLabel}\n`);

async function main() {
  const { LINKEDIN_EMAIL, LINKEDIN_PASSWORD } = process.env;
  if (!LINKEDIN_EMAIL || !LINKEDIN_PASSWORD) {
    console.error('ERROR: Missing LINKEDIN_EMAIL or LINKEDIN_PASSWORD in .env');
    process.exit(1);
  }

  const context = await chromium.launchPersistentContext(SCRAPER_PROFILE, {
    channel: 'msedge',
    headless: false, // visible so we can see what's happening
    slowMo: 120,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, LINKEDIN_EMAIL, LINKEDIN_PASSWORD);
    const engagement = await getEngagementForRange(page, startDate, endDate);

    // Check if this is a month-straddle week
    const start = new Date(startDate + 'T12:00:00');
    const end   = new Date(endDate + 'T12:00:00');
    let finalEngagement = engagement;

    if (start.getMonth() !== end.getMonth()) {
      if (!jsonMode) console.log('  ⚠ Month straddle detected — pulling split...');
      const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0)
        .toISOString().split('T')[0];
      const firstDayOfNextMonth = new Date(start.getFullYear(), start.getMonth() + 1, 1)
        .toISOString().split('T')[0];

      const part1 = await getEngagementForRange(page, startDate, lastDayOfMonth);
      const part2 = await getEngagementForRange(page, firstDayOfNextMonth, endDate);
      finalEngagement = part1 + part2;

      if (!jsonMode) {
        console.log(`  ${formatDateLabel(startDate)} – ${formatDateLabel(lastDayOfMonth)}: ${part1}`);
        console.log(`  ${formatDateLabel(firstDayOfNextMonth)} – ${formatDateLabel(endDate)}: ${part2}`);
        console.log(`  Total: ${finalEngagement}`);
      }
    }

    if (jsonMode) {
      process.stdout.write(JSON.stringify({ engagement: finalEngagement, startDate, endDate }) + '\n');
    } else {
      console.log('\n══════════════════════════════════════════');
      console.log(`  LinkedIn Engagements: ${startLabel} – ${endLabel}`);
      console.log(`  Total: ${finalEngagement}`);
      console.log('══════════════════════════════════════════\n');
    }

  } finally {
    await context.close();
  }
}

async function getEngagementForRange(page, start, end) {
  await setCustomDateRange(page, start, end, { debugPrefix: 'debug-carla' });

  // Try export — gives daily breakdown we can filter by date
  const dailyData = await tryExportAndParse(page, start, end);
  if (dailyData !== null) return dailyData;

  // Fallback: read whatever the page is currently showing
  const pageText = await page.evaluate(() => document.body.innerText);
  const eng = extractMetric(pageText, 'Engagements')
           || extractMetric(pageText, 'Engagement')
           || extractMetric(pageText, 'Reactions')
           || extractMetric(pageText, 'Social engagements');

  console.log(`  Fallback page metric: ${eng} (covers last 7 days, not exact range)`);
  return eng;
}

async function tryExportAndParse(page, start, end) {
  try {
    const XLSX = await import('xlsx');
    const tmpPath = path.join(__dirname, 'carla_export_tmp.xlsx');
    const wb = await exportAnalyticsWorkbook(page, tmpPath);
    if (!wb) return null;

    // Look for the engagement sheet; fall back to first sheet
    const sheetName = wb.SheetNames.find(n => /engagement/i.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { raw: false });

    console.log(`  Parsing sheet: "${sheetName}" — ${rows.length} rows`);
    if (rows.length > 0) console.log('  Columns:', Object.keys(rows[0]).join(', '));

    const startD = new Date(start + 'T00:00:00');
    const endD   = new Date(end   + 'T23:59:59');
    let total = 0;

    for (const row of rows) {
      const dateKey = Object.keys(row).find(k => /date|day/i.test(k));
      const engKey  = Object.keys(row).find(k => /engagement|social/i.test(k));
      if (!dateKey || !engKey) continue;

      const rowDate = new Date(row[dateKey]);
      if (isNaN(rowDate)) continue;

      if (rowDate >= startD && rowDate <= endD) {
        const val = parseInt(String(row[engKey]).replace(/,/g, '')) || 0;
        total += val;
        console.log(`    ${row[dateKey]}: ${val} engagements`);
      }
    }

    return total;
  } catch (e) {
    console.warn(`  Export/parse failed: ${e.message}`);
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractMetric(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`([\\d,]+)\\s*\\n+\\s*${escaped}`, 'i');
  const match = text.match(pattern);
  if (match) return parseInt(match[1].replace(/,/g, ''));

  // Fallback: number on the line immediately before the label
  const lines = text.split('\n').map(l => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() === label.toLowerCase()) {
      const prev = lines[i - 1] || '';
      const n = parseInt(prev.replace(/,/g, ''));
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return 0;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
