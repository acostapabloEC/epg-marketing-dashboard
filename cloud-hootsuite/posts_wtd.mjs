/**
 * posts_wtd.mjs — nightly week-to-date post counts for the Posting Volume dashboard.
 * Usage: node posts_wtd.mjs <out.json>
 *
 * Pulls, via the Hootsuite Analytics API, for TWO ranges: the previous complete Mon-Sun week
 * (so the final numbers land) and the current week so far (Monday through today, US Eastern):
 *   - Instagram  (franklarosa.elite)
 *   - YouTube    (Advisor Talk with Frank LaRosa)  — posts only
 *   - Facebook   (Frank LaRosa + Elite Consulting Partners Pages)
 *
 * Same method rules as youtube_report / instagram_report / facebook_test:
 *   - weekly totals = SUM of per-post metrics from POST /analytics/posts (not profile-level)
 *   - posts endpoint `until` is EXCLUSIVE -> query endDate + 1 day
 *   - follower change = followers_count snapshot delta (day before start .. end)
 * Read-only. Needs HOOTSUITE_* env + HOOTSUITE_STATE_FILE (the workflow saves the rotated token).
 */
import { writeFileSync } from 'fs';
import { listSocialProfiles, listProfileMetrics, listPosts } from './hootsuite_api.mjs';

const out = process.argv[2];
if (!out) { console.error('Usage: node posts_wtd.mjs <out.json>'); process.exit(2); }

const num = v => Number((v && typeof v === 'object') ? v.total : v) || 0;
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// "Today" in US Eastern (the team's clock); the nightly run happens ~11pm ET.
const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const dow = (new Date(asOf + 'T12:00:00Z').getUTCDay() + 6) % 7; // Mon=0
const curMon = addDays(asOf, -dow);
const prevMon = addDays(curMon, -7);
const prevSun = addDays(curMon, -1);
const RANGES = { previous: [prevMon, prevSun], current: [curMon, asOf] };

const SPECS = {
  instagram: { type: 'INSTAGRAMBUSINESS', name: 'franklarosa.elite', follow: 'followers_count', label: 'Frank LaRosa' },
  youtube: { type: 'YOUTUBECHANNEL', name: 'Advisor Talk with Frank LaRosa', follow: 'subscribers_count', label: 'Advisor Talk' },
  facebook_frank: { type: 'FACEBOOKPAGE', name: 'Frank LaRosa', follow: 'followers_count', label: 'Frank LaRosa' },
  facebook_ecp: { type: 'FACEBOOKPAGE', name: 'Elite Consulting Partners', follow: 'followers_count', label: 'Elite Consulting Partners' },
};

const profiles = await listSocialProfiles();
const result = { generatedAt: new Date().toISOString(), asOf, curMon, prevMon, channels: {} };

for (const [key, spec] of Object.entries(SPECS)) {
  const prof = profiles.find(p => p.type === spec.type && p.socialNetworkUsername === spec.name);
  if (!prof) { result.channels[key] = { error: `profile "${spec.name}" (${spec.type}) not found` }; continue; }
  result.channels[key] = { label: spec.label };
  for (const [which, [start, end]] of Object.entries(RANGES)) {
    try {
      const posts = await listPosts(prof.id, start, addDays(end, 1), spec.type);
      const sum = k => posts.reduce((s, p) => s + num(p.metrics?.[k]), 0);
      const rows = (await listProfileMetrics(prof.id, addDays(start, -1), end, spec.type)).sort((a, b) => a.date.localeCompare(b.date));
      const first = num(rows[0]?.metrics?.[spec.follow]), last = num(rows.at(-1)?.metrics?.[spec.follow]);
      result.channels[key][which] = {
        start, end, posts: posts.length, views: sum('views'), engagement: sum('engagement'),
        followers: last || null, netFollowers: rows.length > 1 ? last - first : null,
      };
    } catch (e) {
      result.channels[key][which] = { start, end, error: String(e.message).slice(0, 300) };
    }
  }
}

writeFileSync(out, JSON.stringify(result, null, 2));
const line = c => (c.error ? `ERROR ${c.error}` : `${c.posts} posts, ${c.views} views, ${c.engagement} eng, net ${c.netFollowers}`);
for (const [k, v] of Object.entries(result.channels)) {
  if (v.error) { console.log(`${k}: ${v.error}`); continue; }
  console.log(`${k}  prev ${prevMon}: ${line(v.previous)}  |  current ${curMon}..${asOf}: ${line(v.current)}`);
}
if (Object.values(result.channels).some(v => v.error || v.previous?.error || v.current?.error)) process.exitCode = 1;
