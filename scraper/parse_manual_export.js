/**
 * parse_manual_export.js
 * Full weekly dashboard metrics from a MANUALLY-PROVIDED LinkedIn export —
 * no login, no browser, no automated LinkedIn interaction of any kind.
 *
 * The Playwright-based scraper (linkedin_report.js, carla_report.js,
 * top_posts.js) is PAUSED as of 2026-08-03 at Pablo's request, to avoid any
 * automated-access risk to Frank's LinkedIn account. Going forward, Pablo
 * exports the report by hand from LinkedIn Creator Analytics and drops the
 * file in manual-exports/; this script does everything downstream of that
 * — same numbers, same shape — from the file alone.
 *
 * Usage: node parse_manual_export.js <path-to-xlsx> <startDate> <endDate>
 * Example:
 *   node parse_manual_export.js manual-exports/AggregateAnalytics_Frank LaRosa_2026-08-03_2026-08-09.xlsx 2026-08-03 2026-08-09
 *
 * One thing this can't do that the live scraper could: pull each top post's
 * caption text (the export's TOP POSTS sheet has URL/date/numbers only, not
 * the post's words) — that required visiting each post's page directly,
 * which is exactly the kind of automated LinkedIn interaction we're pausing.
 * topPosts[].preview comes back empty; fill it in by hand from the actual
 * posts if you want captions in the dashboard, or leave it blank.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  extractEngagementTotal, extractDiscoveryTotals, extractFollowers, extractTopPosts,
} from './linkedin_export.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [, , filePath, startDate, endDate] = process.argv;
if (!filePath || !startDate || !endDate) {
  console.error('Usage: node parse_manual_export.js <path-to-xlsx> <startDate> <endDate>');
  process.exit(1);
}

const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`ERROR: file not found: ${resolvedPath}`);
  process.exit(1);
}

async function main() {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(fs.readFileSync(resolvedPath));

  const engagements = extractEngagementTotal(XLSX, wb, startDate, endDate);
  const { impressions, membersReached } = extractDiscoveryTotals(XLSX, wb);
  const { gained: followersGained, total: followersTotal } = extractFollowers(XLSX, wb, startDate, endDate);
  const allPosts = extractTopPosts(XLSX, wb, startDate, endDate);
  const topPosts = allPosts.slice(0, 3).map(p => ({ ...p, preview: '' }));

  const result = {
    startDate, endDate,
    engagements, impressions, membersReached,
    posts: allPosts.length,
    followersGained, followersTotal,
    topPosts,
  };

  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
