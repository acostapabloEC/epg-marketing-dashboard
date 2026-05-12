import 'dotenv/config';
import { scrapeLinkedIn } from './linkedin.js';
import { scrapeSimplecast } from './simplecast.js';
import { readHootsuiteReports } from './hootsuite.js';
import { fetchHootsuiteAttachments } from './hootsuite-email.js';
import { sendNewsletterEmail } from './email.js';

const args = process.argv.slice(2);
const testEmail = args.includes('--test-email');

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  EPG Weekly Marketing Report');
  console.log('═══════════════════════════════════════\n');

  if (testEmail) {
    console.log('TEST MODE — sending sample newsletter...\n');
    const { instagram, youtube } = runStepSync('Hootsuite', () => readHootsuiteReports());
    const sample = buildSampleData();
    sample.instagram = instagram;
    sample.youtube   = youtube;
    await sendNewsletterEmail(sample);
    console.log('\nTest email sent! Check your inbox.');
    return;
  }

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

  console.log('[Hootsuite] fetching email attachments...');
  await fetchHootsuiteAttachments();

  const { instagram, youtube } = runStepSync('Hootsuite', () => readHootsuiteReports());

  // ── Log summary ────────────────────────────────────────────────────────────
  const li = linkedinData.linkedin;
  console.log('\n── LinkedIn ───────────────────────────');
  console.log(`  Engagements  : ${li.engagements?.current || 0} (${pctStr(li.engagements?.pct)})`);
  console.log(`  Impressions  : ${(li.impressions?.current || 0).toLocaleString()} (${pctStr(li.impressions?.pct)})`);
  console.log(`  Top Posts    : ${li.topPosts?.length || 0} found`);

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

  // ── Build & send ────────────────────────────────────────────────────────────
  const data = {
    weekOf: linkedinData.weekOf,
    linkedin: li,
    podcast: podcastData,
    instagram,
    youtube,
  };

  console.log('\nSending newsletter...');
  await sendNewsletterEmail(data);
  console.log(`\n✓ Done! Sent to ${process.env.EMAIL_TO}`);
}

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
  if (name === 'LinkedIn') return { weekOf: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), linkedin: { engagements: { current: 0, pct: 0 }, impressions: { current: 0, pct: 0 }, membersReached: { current: 0, pct: 0 }, followers: { gained: 0, total: 0 }, posts: 0, weeklyGoal: 187, topPosts: [] } };
  if (name === 'Simplecast') return { show: 'Advisor Talk', downloads: { current: 0, previous: 0, pct: 0 }, episodes: [] };
  return {};
}

function pctStr(pct) {
  if (!pct) return '—';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function buildSampleData() {
  return {
    weekOf: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    linkedin: {
      engagements:   { current: 145, previous: 118, pct: 23 },
      impressions:   { current: 4070, previous: 2933, pct: 39 },
      membersReached:{ current: 1235, previous: 929, pct: 33 },
      followers:     { gained: 12, total: 12801 },
      posts: 4,
      weeklyGoal: 187,
      topPosts: [
        { preview: "Most consultants in this industry aren't actually consultants. They're salespeople with one solution.", reactions: 45, impressions: 722 },
        { preview: '22 years at a firm you love. A headhunter calls. Shannon Reid was President of the Raymond James Independent Channel.', reactions: 38, impressions: 650 },
        { preview: 'Welcoming three outstanding advisors to the Elite family this week.', reactions: 29, impressions: 410 },
      ],
    },
    podcast: {
      show: 'Advisor Talk with Frank LaRosa',
      downloads: { current: 343, previous: 581, pct: -41 },
      episodes: [
        { number: 278, title: 'What If You Never Try: One Decision That Changed Her Career', publishedAt: '2026-05-07T07:00:00-04:00', weekDownloads: 125 },
        { number: 277, title: 'Inside The Succession Trap: Why Sell and Exit Deals Keep Failing', publishedAt: '2026-04-30T07:00:00-04:00', weekDownloads: 62 },
      ],
    },
    instagram: { available: false },
    youtube:   { available: false },
  };
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
