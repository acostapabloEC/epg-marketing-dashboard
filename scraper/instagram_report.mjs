/**
 * instagram_report.mjs
 * Pull Instagram engagement totals + top posts for an exact date range, via the
 * Hootsuite Analytics API — not browser scraping.
 * Usage: node instagram_report.mjs <startDate> <endDate> [--json]
 * Example: node instagram_report.mjs 2026-07-06 2026-07-12
 *
 * Rewritten 2026-07-20. Requires HOOTSUITE_CLIENT_ID/_CLIENT_SECRET/_ACCESS_TOKEN/
 * _REFRESH_TOKEN in .env — run `node hootsuite_oauth.mjs` once first to set these up
 * (needs the Advanced Analytics add-on + a Hootsuite Developer app with the
 * analytics:read scope; see hootsuite_oauth.mjs's header comment).
 *
 * Replaces the old Playwright/browser-scraper version, which fought two structural
 * problems: Hootsuite's Instagram export has no date-range picker (always
 * month-to-date-through-yesterday, requiring a local archive to survive month
 * rollover) and an unstable Daily-vs-Overall duplicate-column layout that silently
 * corrupted a real month's data before it was caught. The Analytics API takes an
 * exact date range natively and returns each metric once, under its own name —
 * neither problem exists here.
 *
 * IMPORTANT METRIC GOTCHA (found validating this rewrite, still true of the API):
 * POST /v1/analytics/profiles' daily engagement/views are NOT the same metric as
 * "sum of this week's posts' engagement/views" — they read ~6-13x larger, some
 * broader profile-level definition (closer to Instagram's own reach/impressions
 * concept than to "views on posts you made"). Weekly eng/views/likes/etc totals
 * MUST come from summing POST /v1/analytics/posts (per-post, filtered to posts
 * created in the target range) — that's what reconciled with previously-validated
 * numbers from the old scraper. Only new_followers_count is pulled from the
 * profile-level endpoint, since no per-post equivalent exists for that metric.
 * Don't "simplify" by switching eng/views to the profile endpoint.
 */
import 'dotenv/config';
import { listSocialProfiles, listProfileMetrics, listPosts } from './hootsuite_api.mjs';

const INSTAGRAM_USERNAME = 'franklarosa.elite';

const rawArgs = process.argv.slice(2);
const jsonMode = rawArgs.includes('--json');
const args = rawArgs.filter(a => !a.startsWith('--'));
const [startDate, endDate] = args;

if (!startDate || !endDate) {
  console.error('Usage: node instagram_report.mjs <startDate YYYY-MM-DD> <endDate YYYY-MM-DD> [--json]');
  process.exit(1);
}

function toNum(v) {
  const n = (v && typeof v === 'object') ? v.total : v;
  return Number(n) || 0;
}

function friendlyType(metadata) {
  const postType = (metadata?.post_type || '').toUpperCase();
  const mediaType = (metadata?.media_type || '').toUpperCase();
  if (postType === 'REEL' || postType === 'REELS') return 'Reel';
  if (postType === 'STORY') return 'Story';
  if (postType === 'CAROUSEL' || postType === 'CAROUSEL_ALBUM' || mediaType === 'CAROUSEL_ALBUM') return 'Carousel';
  if (postType === 'PHOTO' || postType === 'IMAGE' || mediaType === 'PHOTO' || mediaType === 'IMAGE') return 'Photo';
  if (postType === 'VIDEO' || mediaType === 'VIDEO') return 'Video';
  // Unknown value — return Title Case rather than a raw uppercase API constant.
  const raw = postType || mediaType || 'Post';
  return raw.charAt(0) + raw.slice(1).toLowerCase();
}

// NOTE: new_followers_count is a GROSS gain metric (Hootsuite separately exposes
// lost_followers_count) — summing it alone overstates growth by roughly 2x, since
// it ignores unfollows entirely. True net growth is computed here from the
// followers_count snapshot delta instead (verified against gained-minus-lost:
// the two methods reconciled within ~3% on a 19-day test — close enough to trust
// the simpler, more directly verifiable snapshot-delta approach as primary).
async function computeNetFollowerGrowth(profileId, startDate, endDate) {
  const dayBefore = new Date(startDate + 'T00:00:00Z');
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const since = dayBefore.toISOString().slice(0, 10);
  const metrics = await listProfileMetrics(profileId, since, endDate);
  if (metrics.length < 2) return null;
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  const first = toNum(sorted[0].metrics?.followers_count);
  const last = toNum(sorted[sorted.length - 1].metrics?.followers_count);
  return last - first;
}

async function findProfileId() {
  const profiles = await listSocialProfiles();
  const match = profiles.find(p => p.type === 'INSTAGRAMBUSINESS' && p.socialNetworkUsername === INSTAGRAM_USERNAME);
  if (!match) {
    throw new Error(`Could not find Instagram Business profile "${INSTAGRAM_USERNAME}" among Hootsuite's connected social profiles.`);
  }
  return match.id;
}

async function main() {
  const profileId = await findProfileId();
  const posts = await listPosts(profileId, startDate, endDate);

  const totals = { likes: 0, views: 0, comments: 0, saves: 0, engagement: 0, shares: 0 };
  const mappedPosts = posts.map(p => {
    const m = p.metrics || {};
    const mapped = {
      postId: p.externalId ?? null,
      date: (p.createdAt || '').slice(0, 10),
      type: friendlyType(p.metadata),
      caption: p.content || '',
      likes: toNum(m.likes),
      comments: toNum(m.comments),
      shares: toNum(m.shares),
      saves: toNum(m.saves),
      views: toNum(m.views),
      reach: toNum(m.reach),
      engagement: toNum(m.engagement),
      engRate: toNum(m.engagement_rate),
    };
    totals.likes += mapped.likes;
    totals.views += mapped.views;
    totals.comments += mapped.comments;
    totals.saves += mapped.saves;
    totals.engagement += mapped.engagement;
    totals.shares += mapped.shares;
    return mapped;
  });

  const topPosts = [...mappedPosts].sort((a, b) => b.engagement - a.engagement).slice(0, 3);

  let newFollowers = null;
  try {
    newFollowers = await computeNetFollowerGrowth(profileId, startDate, endDate);
  } catch (e) {
    console.warn(`Could not compute net follower growth (non-fatal): ${e.message}`);
  }

  const result = { startDate, endDate, ...totals, postsCount: posts.length, newFollowers, topPosts };

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }

  console.log(`\nInstagram ${startDate} -> ${endDate} (${posts.length} posts published)`);
  console.log(`  Engagement:    ${totals.engagement}`);
  console.log(`  Views:         ${totals.views}`);
  console.log(`  Likes:         ${totals.likes}`);
  console.log(`  Comments:      ${totals.comments}`);
  console.log(`  Saves:         ${totals.saves}`);
  console.log(`  Shares:        ${totals.shares}`);
  console.log(`  New followers: ${newFollowers ?? 'unavailable'}`);
  console.log(`  Top posts:`);
  for (const p of topPosts) {
    console.log(`    ${p.date} [${p.type}] eng=${p.engagement} views=${p.views} - ${p.caption.slice(0, 60)}`);
  }
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
