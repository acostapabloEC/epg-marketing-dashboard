/**
 * linkedin_report.js
 * Full weekly metrics pull for the LIVE DASHBOARD (src/App.jsx) — total
 * engagements, impressions, members reached, followers gained/total, post
 * count, and the week's top posts (with text previews).
 *
 * Independent of Carla's report (engagement-only) and top_posts.js (writes
 * the newsletter's weekly-data.json) — shares only the underlying LinkedIn
 * automation (linkedin_export.mjs). This script never writes any file
 * itself; it just prints one JSON line for a human (or the scheduled task)
 * to use when editing App.jsx.
 *
 * Usage: node linkedin_report.js [startDate] [endDate]
 * Example: node linkedin_report.js 2026-07-06 2026-07-12
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ensureLoggedIn, setCustomDateRange, exportAnalyticsWorkbook,
  extractTopPosts, extractDiscoveryTotals, extractFollowers, fetchPostPreview,
  extractEngagementTotal,
} from './linkedin_export.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_PROFILE = path.join(__dirname, 'edge-profile');

const args = process.argv.slice(2);
const startDate = args[0] || '2026-07-01';
const endDate   = args[1] || '2026-07-05';

async function main() {
  const { LINKEDIN_EMAIL, LINKEDIN_PASSWORD } = process.env;
  if (!LINKEDIN_EMAIL || !LINKEDIN_PASSWORD) {
    console.error('ERROR: Missing LINKEDIN_EMAIL or LINKEDIN_PASSWORD in .env');
    process.exit(1);
  }

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
    await setCustomDateRange(page, startDate, endDate, { debugPrefix: 'debug-linkedin-report' });

    const tmpPath = path.join(__dirname, 'linkedin_report_export_tmp.xlsx');
    const wb = await exportAnalyticsWorkbook(page, tmpPath);
    if (!wb) throw new Error('Export failed — no workbook to parse.');

    const XLSX = await import('xlsx');

    const { impressions, membersReached } = extractDiscoveryTotals(XLSX, wb);
    const { gained: followersGained, total: followersTotal } = extractFollowers(XLSX, wb, startDate, endDate);
    const allPosts = extractTopPosts(XLSX, wb, startDate, endDate);
    // Daily-aggregate total (engagement received during the week), NOT the sum of individual
    // posts' engagement (engagement earned by posts published that week) — those are genuinely
    // different numbers; the dashboard's weeklyData.engagements field uses this one.
    const engagements = extractEngagementTotal(XLSX, wb, startDate, endDate);

    const top3 = allPosts.slice(0, 3);
    const topPosts = [];
    for (const post of top3) {
      const preview = await fetchPostPreview(page, post.url);
      topPosts.push({ ...post, preview });
    }

    // fetchPostPreview fails soft (returns "" instead of throwing) whenever its selectors
    // don't match the post page — e.g. the 2026-07-20 incident where LinkedIn's DOM rebuild
    // silently broke it for weeks with no error anywhere in the pipeline. Surface that loudly
    // here instead of letting blank previews flow into App.jsx unnoticed.
    const emptyPreviews = topPosts.filter(p => !p.preview || p.preview.length < 20).length;
    if (emptyPreviews > 0) {
      console.warn(`\nWARNING: ${emptyPreviews}/${topPosts.length} top posts came back with no/short preview text. This usually means LinkedIn changed its post-page DOM again and fetchPostPreview's selectors in linkedin_export.mjs need updating — do not write blank previews into App.jsx without investigating first.\n`);
    }

    process.stdout.write(JSON.stringify({
      startDate, endDate,
      engagements, impressions, membersReached,
      posts: allPosts.length,
      followersGained, followersTotal,
      topPosts,
    }) + '\n');
  } finally {
    await context.close();
  }
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
