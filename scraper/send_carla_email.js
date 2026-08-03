/**
 * send_carla_email.js
 * Emails Carla Wade this week's LinkedIn engagement total — engagement number
 * only, see email.js:sendCarlaEmail for why.
 *
 * Data source: reads the latest week straight out of `../src/App.jsx`'s
 * weeklyData array — the same numbers already on the live LinkedIn dashboard,
 * kept in sync by the Monday `epg-linkedin-weekly-update` task. No live
 * LinkedIn scrape needed; that already happened for the dashboard update.
 *
 * Usage:
 *   node send_carla_email.js                          # preview only, sends nothing
 *   node send_carla_email.js --send                    # actually email Carla
 *   node send_carla_email.js --send --expect-week 2026-07-06   # abort unless
 *       the dashboard's latest week matches this Monday (guards against
 *       sending a stale week if run before the dashboard update lands)
 *   node send_carla_email.js --send --cc pabloacosta@eliteconsultingpartners.com
 *       # optionally CC someone (e.g. Pablo) on an ad-hoc send; the automated
 *       # scheduled task doesn't pass this, so normal Monday sends are unaffected
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendCarlaEmail } from './email.js';
import { extractDailyEngagements } from './linkedin_export.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JSX = path.join(__dirname, '..', 'src', 'App.jsx');
// Written by linkedin_report.js during the epg-linkedin-weekly-update task (runs ~7 min
// before this one) — the same LinkedIn export used to build the dashboard's weekly row.
// Its ENGAGEMENT sheet has the daily breakdown that App.jsx's weeklyData does not store.
const DAILY_EXPORT_XLSX = path.join(__dirname, 'linkedin_report_export_tmp.xlsx');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function readDashboardLatestWeek(appJsxPath = APP_JSX) {
  const text = fs.readFileSync(appJsxPath, 'utf8');

  const arrayMatch = text.match(/weeklyData\s*=\s*\[([\s\S]*?)\n\];/);
  if (!arrayMatch) throw new Error(`Could not find weeklyData array in ${appJsxPath}`);

  const rows = [...arrayMatch[1].matchAll(/week:\s*"([^"]+)",\s*engagements:\s*(\d+)/g)];
  if (!rows.length) throw new Error(`weeklyData array in ${appJsxPath} had no parseable rows`);

  const [, weekLabel, engStr] = rows[rows.length - 1];
  const [monthStr, dayStr] = weekLabel.split(' ');
  const month = MONTHS.indexOf(monthStr);
  const day = parseInt(dayStr, 10);
  if (month === -1 || !day) throw new Error(`Could not parse week label "${weekLabel}"`);

  const today = new Date();
  let weekStart = new Date(today.getFullYear(), month, day);
  const tenDaysOut = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);
  if (weekStart > tenDaysOut) weekStart = new Date(today.getFullYear() - 1, month, day); // e.g. a Dec week read in early January

  return { weekStart, engagement: parseInt(engStr, 10) };
}

function iso(d) {
  return d.toISOString().split('T')[0];
}

async function readDailyBreakdown(startDate, endDate) {
  if (!fs.existsSync(DAILY_EXPORT_XLSX)) {
    throw new Error(`${DAILY_EXPORT_XLSX} not found — the LinkedIn weekly export hasn't run yet this week.`);
  }
  const XLSX = await import('xlsx').then(m => m.default || m);
  const wb = XLSX.readFile(DAILY_EXPORT_XLSX);
  const daily = extractDailyEngagements(XLSX, wb, startDate, endDate);

  if (daily.length === 0 || daily[0].date !== startDate || daily[daily.length - 1].date !== endDate) {
    throw new Error(
      `${DAILY_EXPORT_XLSX} does not cover ${startDate} → ${endDate} (found ${daily.length} day(s)` +
      (daily.length ? `, ${daily[0].date} → ${daily[daily.length - 1].date}` : '') +
      `) — it may be stale from a previous week's run.`
    );
  }
  return daily;
}

async function main() {
  const argv = process.argv.slice(2);
  const send = argv.includes('--send');
  const expectIdx = argv.indexOf('--expect-week');
  const expectWeek = expectIdx !== -1 ? argv[expectIdx + 1] : null;
  const ccIdx = argv.indexOf('--cc');
  const cc = ccIdx !== -1 ? argv[ccIdx + 1] : null;

  const { weekStart, engagement } = readDashboardLatestWeek();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const startDate = iso(weekStart);
  const endDate = iso(weekEnd);

  console.log(`Dashboard latest week: ${startDate} → ${endDate} (${engagement.toLocaleString()} engagements)`);

  if (expectWeek && startDate !== expectWeek) {
    console.error(`ERROR: expected latest week ${expectWeek}, dashboard has ${startDate} — dashboard may not be updated yet for this week. Nothing sent.`);
    process.exit(1);
  }

  const daily = await readDailyBreakdown(startDate, endDate);
  const dailyTotal = daily.reduce((sum, d) => sum + d.engagements, 0);
  console.log('Daily breakdown: ' + daily.map(d => `${d.date}=${d.engagements}`).join(', '));
  if (dailyTotal !== engagement) {
    console.warn(`WARNING: daily breakdown sums to ${dailyTotal}, dashboard total is ${engagement} (LinkedIn numbers can revise through the day) — sending the dashboard total with this daily breakdown anyway.`);
  }

  if (!send) {
    console.log('\nPREVIEW only — nothing sent. Re-run with --send to email Carla.');
    return;
  }

  await sendCarlaEmail({ engagement, startDate, endDate, daily, cc });
  console.log(`\n✓ Sent to Carla Wade${cc ? ` (cc: ${cc})` : ''} (${startDate} → ${endDate}: ${engagement.toLocaleString()} engagements)`);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
