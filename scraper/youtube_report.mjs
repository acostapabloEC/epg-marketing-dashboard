/**
 * youtube_report.mjs
 * Pull YouTube (Advisor Talk w/ Frank LaRosa) totals for an exact date range, via the
 * Hootsuite Analytics API — not browser scraping.
 * Usage: node youtube_report.mjs <startDate> <endDate> [--json]
 * Example: node youtube_report.mjs 2026-07-06 2026-07-12
 *
 * Rewritten 2026-07-20 (mirrors instagram_report.mjs's rewrite, same session's lessons
 * applied directly rather than rediscovered). Requires HOOTSUITE_CLIENT_ID/_CLIENT_SECRET/
 * _ACCESS_TOKEN/_REFRESH_TOKEN in .env — already set up (one Hootsuite Developer app/OAuth
 * grant shared across the whole machine, not per-platform; only re-run hootsuite_oauth.mjs
 * if the refresh token actually dies).
 *
 * Replaces the old Playwright/browser-scraper version, which fought Hootsuite's saved
 * YouTube report only retaining a rolling window of recent videos (older ones fell off,
 * requiring a local data/youtube_posts_archive.json + data/youtube_daily_archive.json to
 * survive) plus an unstable Daily-vs-Overall duplicate-column export layout. The Analytics
 * API takes an exact date range natively and returns each metric once under its own name —
 * neither workaround is needed anymore. This script has no archive and no --no-scrape mode;
 * every run hits the live API directly (a stray "--no-scrape" arg from callers is silently
 * ignored, same as instagram_report.mjs).
 *
 * VALIDATED 2026-07-20 against the already-published, previously-corrected Jul 6-12 week
 * (33 eng / 29 likes / 1 comment / 3 shares / 3,796 views / 10 posts / subs 2,160 +10) —
 * see the CLAUDE.md / memory notes for the exact reconciliation.
 *
 * METRIC GOTCHAS (same class of problem as Instagram — confirmed applicable here too):
 * 1. POST /v1/analytics/profiles' engagement/views/likes/etc are NOT the same as summing
 *    this week's individual videos — on Instagram the profile endpoint read 6-13x larger
 *    (a broader profile-level reach-style definition). Weekly views/likes/comments/shares
 *    totals here MUST come from summing POST /v1/analytics/posts (per-video, filtered to
 *    videos posted in the target range) — never the profile endpoint for these.
 * 2. Unlike Instagram (only a gross new_followers_count, no "lost" counterpart), Hootsuite's
 *    Metrics Reference confirms YouTube separately exposes subscribers_gained AND
 *    subscribers_lost — so summing subscribers_gained alone would NOT have the same
 *    gross-vs-net problem Instagram had. Even so, this script computes net subscriber change
 *    from a subscribers_count snapshot delta (identical pattern to instagram_report.mjs's
 *    computeNetFollowerGrowth()) for consistency with the verified Instagram methodology and
 *    because it's one fewer field to trust — same approach the old archive-based script used
 *    (it diffed daily subscriber snapshots for the same reason: no daily "gained" breakdown
 *    was exposed at all in the export).
 * 3. YouTube's post-level analytics has no "engagement" metric (unlike Instagram, which
 *    returns one directly) — engagement is always likes + comments + shares, computed here.
 * 4. NEW GOTCHA found validating this rewrite, not seen (or not noticed) on Instagram:
 *    POST /v1/analytics/posts' `until` filter is EXCLUSIVE — a video posted on the `until`
 *    date itself (any time after midnight) is silently dropped, because posts carry a real
 *    timestamp compared against an exact instant, not a calendar day. (POST /v1/analytics/
 *    profiles' `until` is INCLUSIVE of that date — confirmed by testing — so this is a
 *    posts-only quirk, no fix needed for the subscriber-snapshot query.) Caught here because
 *    2 of 10 known videos (both posted on the range's last day) vanished from the API result
 *    until `until` was bumped forward one day. Fixed below by always querying listPosts with
 *    `until = endDate + 1 day`. hootsuite_api.mjs itself was NOT changed (kept as shared,
 *    untouched infra per scope) — instagram_report.mjs calls listPosts the same exclusive way
 *    and likely has this same one-day undercount on its own last day; flagged for that
 *    session, not fixed here.
 */
import 'dotenv/config';
import { listSocialProfiles, listProfileMetrics, listPosts } from './hootsuite_api.mjs';

const YOUTUBE_CHANNEL_NAME = 'Advisor Talk with Frank LaRosa'; // profile id 139589504, confirmed via listSocialProfiles()
const NETWORK_ID = 'YOUTUBECHANNEL';

const rawArgs = process.argv.slice(2);
const jsonMode = rawArgs.includes('--json');
const args = rawArgs.filter(a => !a.startsWith('--'));
const [startDate, endDate] = args;

if (!startDate || !endDate) {
  console.error('Usage: node youtube_report.mjs <startDate YYYY-MM-DD> <endDate YYYY-MM-DD> [--json]');
  process.exit(1);
}

function toNum(v) {
  const n = (v && typeof v === 'object') ? v.total : v;
  return Number(n) || 0;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function videoTitle(message) {
  if (!message || String(message).trim() === '') return '(No description available)';
  const first = String(message).split('\n')[0].trim();
  return first.length > 90 ? first.slice(0, 90) + '…' : first;
}

// Net subscriber change via subscribers_count snapshot delta — same pattern as
// instagram_report.mjs's computeNetFollowerGrowth(). Requires a snapshot from before
// startDate; returns null if none exists yet (e.g. the very first tracked week).
async function computeNetSubscriberGrowth(profileId, startDate, endDate) {
  const dayBefore = new Date(startDate + 'T00:00:00Z');
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const since = dayBefore.toISOString().slice(0, 10);
  const metrics = await listProfileMetrics(profileId, since, endDate, NETWORK_ID);
  if (metrics.length < 2) return null;
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  const first = toNum(sorted[0].metrics?.subscribers_count);
  const last = toNum(sorted[sorted.length - 1].metrics?.subscribers_count);
  return { gained: last - first, total: last, totalAsOf: sorted[sorted.length - 1].date };
}

async function findProfileId() {
  const profiles = await listSocialProfiles();
  const match = profiles.find(p => p.type === NETWORK_ID && p.socialNetworkUsername === YOUTUBE_CHANNEL_NAME);
  if (!match) {
    throw new Error(`Could not find YouTube channel "${YOUTUBE_CHANNEL_NAME}" (type ${NETWORK_ID}) among Hootsuite's connected social profiles.`);
  }
  return match.id;
}

async function main() {
  const profileId = await findProfileId();
  // until is exclusive on this endpoint (see gotcha #4 above) — bump it forward a day so
  // videos posted on endDate itself aren't silently dropped.
  const posts = await listPosts(profileId, startDate, addDays(endDate, 1), NETWORK_ID);

  const totals = { likes: 0, comments: 0, shares: 0, views: 0 };
  const mappedPosts = posts.map(p => {
    const m = p.metrics || {};
    const mapped = {
      postId: p.externalId ?? null,
      date: (p.createdAt || '').slice(0, 10),
      title: videoTitle(p.content),
      likes: toNum(m.likes),
      comments: toNum(m.comments),
      shares: toNum(m.shares),
      views: toNum(m.views),
    };
    totals.likes += mapped.likes;
    totals.comments += mapped.comments;
    totals.shares += mapped.shares;
    totals.views += mapped.views;
    return mapped;
  });

  const engagements = totals.likes + totals.comments + totals.shares;
  const topPosts = mappedPosts
    .map(p => ({ ...p, engagements: p.likes + p.comments + p.shares }))
    .sort((a, b) => b.engagements - a.engagements)
    .slice(0, 3);

  let subsGained = null, subsTotal = null, subsTotalAsOf = null;
  try {
    const sub = await computeNetSubscriberGrowth(profileId, startDate, endDate);
    if (sub) { subsGained = sub.gained; subsTotal = sub.total; subsTotalAsOf = sub.totalAsOf; }
  } catch (e) {
    console.warn(`Could not compute net subscriber growth (non-fatal): ${e.message}`);
  }

  const result = {
    startDate, endDate,
    engagements, likes: totals.likes, comments: totals.comments, shares: totals.shares,
    views: totals.views, posts: mappedPosts.length,
    topPosts,
    subscribersGainedThisWeek: subsGained,
    subscribersTotal: subsTotal,
    subscribersTotalAsOf: subsTotalAsOf,
  };

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }

  console.log(`\nYouTube ${startDate} -> ${endDate}`);
  console.log(`  Engagements: ${engagements}  (likes ${totals.likes}, comments ${totals.comments}, shares ${totals.shares})`);
  console.log(`  Views:       ${totals.views}`);
  console.log(`  Posts:       ${mappedPosts.length}`);
  console.log(`  Subscribers gained this week: ${subsGained ?? 'unavailable'}`);
  console.log(`  Subscribers total (as of ${subsTotalAsOf}): ${subsTotal}`);
  console.log(`  Top posts:`);
  topPosts.forEach((p, i) => console.log(`    ${i + 1}. [${p.date}] eng=${p.engagements} likes=${p.likes} views=${p.views} — ${p.title}`));
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
