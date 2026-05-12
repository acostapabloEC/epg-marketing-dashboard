import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeLinkedIn } from './linkedin.js';
import { scrapeSimplecast } from './simplecast.js';
import { readHootsuiteReports } from './hootsuite.js';
import { fetchHootsuiteAttachments } from './hootsuite-email.js';
import { sendNewsletterEmail } from './email.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE  = path.join(__dirname, '..', 'src', 'data', 'weekly-data.json');

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  EPG Weekly Marketing Report');
  console.log('═══════════════════════════════════════\n');

  const { LINKEDIN_EMAIL, LINKEDIN_PASSWORD, SIMPLECAST_API_KEY } = process.env;

  if (!LINKEDIN_EMAIL || !LINKEDIN_PASSWORD) {
    console.error('ERROR: Missing LINKEDIN_EMAIL or LINKEDIN_PASSWORD in .env');
    process.exit(1);
  }

  // ── Run all scrapers in parallel where possible ────────────────────────────
  console.log('Collecting data from all platforms...\n');

  const [linkedinData, podcastData] = await Promise.all([
    runStep('LinkedIn', () => scrapeLinkedIn(LINKEDIN_EMAIL, LINKEDIN_PASSWORD)),
    runStep('Simplecast', () => scrapeSimplecast(SIMPLECAST_API_KEY)),
  ]);

  try {
    console.log('[Hootsuite] fetching email attachments...');
    await fetchHootsuiteAttachments();
  } catch (e) {
    console.log(`[Hootsuite Email] skipped — ${e.message}`);
  }

  const { instagram, youtube } = runStepSync('Hootsuite', () => readHootsuiteReports());

  // ── Log summary ────────────────────────────────────────────────────────────
  const li      = linkedinData.linkedin;
  const outbound = linkedinData.outbound || { comments: 0, reactions: 0, activity: [] };

  console.log('\n── LinkedIn ───────────────────────────');
  console.log(`  Engagements  : ${li.engagements?.current || 0} (${pctStr(li.engagements?.pct)})`);
  console.log(`  Impressions  : ${(li.impressions?.current || 0).toLocaleString()} (${pctStr(li.impressions?.pct)})`);
  console.log(`  Top Posts    : ${li.topPosts?.length || 0} found`);

  console.log('\n── Outbound Activity (MotionMedia) ────');
  console.log(`  Comments     : ${outbound.comments}`);
  console.log(`  Reactions    : ${outbound.reactions}`);

  console.log('\n── Podcast ────────────────────────────');
  console.log(`  Downloads    : ${podcastData.downloads.current} (${pctStr(podcastData.downloads.pct)})`);
  console.log(`  Latest ep    : ${podcastData.episodes[0]?.title?.slice(0, 50) || 'n/a'}`);

  console.log('\n── Instagram ──────────────────────────');
  console.log(instagram.available
    ? `  Engagements  : ${instagram.engagements?.current || 0} (${pctStr(instagram.engagements?.pct)})\n  Reach        : ${(instagram.reach?.current || 0).toLocaleString()}`
    : '  No report file found — add instagram CSV to scraper/reports/');

  console.log('\n── YouTube ────────────────────────────');
  console.log(youtube.available
    ? `  Views        : ${(youtube.views?.current || 0).toLocaleString()} (${pctStr(youtube.views?.pct)})`
    : '  No report file found — add youtube CSV to scraper/reports/');

  // ── Save weekly-data.json for the dashboard ────────────────────────────────
  saveWeeklyData({ weekOf: linkedinData.weekOf, linkedin: li, outbound, podcast: podcastData, instagram, youtube });

  // ── Build & send newsletter ────────────────────────────────────────────────
  const data = {
    weekOf: linkedinData.weekOf,
    linkedin: li,
    outbound,
    podcast: podcastData,
    instagram,
    youtube,
  };

  console.log('\nSending newsletter...');
  await sendNewsletterEmail(data);
  console.log(`\n✓ Done! Sent to ${process.env.EMAIL_TO}`);
}

// ── Persist data for the React dashboard ──────────────────────────────────────

function saveWeeklyData({ weekOf, linkedin, outbound, podcast, instagram, youtube }) {
  try {
    // Load existing file to preserve history
    let existing = { history: [] };
    if (fs.existsSync(DATA_FILE)) {
      existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }

    // Append this week to history (avoid duplicates by weekOf)
    const historyEntry = {
      weekOf,
      comments:       outbound.comments,
      reactions:      outbound.reactions,
      engagements:    linkedin.engagements?.current || 0,
      followersGained: linkedin.followers?.gained  || 0,
    };
    const history = [
      ...( existing.history || []).filter(h => h.weekOf !== weekOf),
      historyEntry,
    ].slice(-26); // keep last 26 weeks (6 months)

    const payload = {
      updatedAt: new Date().toISOString().split('T')[0],
      weekOf,
      linkedin,
      outbound,
      history,
    };

    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
    console.log('\n✓ Dashboard data saved to src/data/weekly-data.json');
  } catch (e) {
    console.warn('  Could not save dashboard data:', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runStep(name, fn) {
  try {
    console.log(`[${name}] starting...`);
    const result = await fn();
    console.log(`[${name}] done`);
    return result;
  } catch (e) {
    console.error(`[${name}] ERROR: ${e.message}`);
    return getEmpty(name);
  }
}

function runStepSync(name, fn) {
  try {
    return fn();
  } catch (e) {
    console.error(`[${name}] ERROR: ${e.message}`);
    return { instagram: { available: false }, youtube: { available: false } };
  }
}

function getEmpty(name) {
  if (name === 'LinkedIn') return {
    weekOf: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    linkedin: { engagements: { current: 0, pct: 0 }, impressions: { current: 0, pct: 0 }, membersReached: { current: 0, pct: 0 }, followers: { gained: 0, total: 0 }, posts: 0, weeklyGoal: 187, topPosts: [] },
    outbound: { comments: 0, reactions: 0, activity: [] },
  };
  if (name === 'Simplecast') return { show: 'Advisor Talk', downloads: { current: 0, previous: 0, pct: 0 }, episodes: [] };
  return {};
}

function pctStr(pct) {
  if (!pct) return '—';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
