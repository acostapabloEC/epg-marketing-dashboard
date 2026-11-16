/**
 * facebook_test.mjs — ONE-OFF discovery run: can the Hootsuite Analytics API pull our Facebook Pages?
 * Usage: node facebook_test.mjs <startDate> <endDate>
 * For every FACEBOOKPAGE social profile, pulls per-post metrics and profile-level daily metrics
 * for the range and prints a table + raw metric names. Writes the same to $GITHUB_STEP_SUMMARY.
 * Read-only. Never fails the job: each page's error is reported in its own row.
 */
import { appendFileSync } from 'fs';
import { listSocialProfiles, listProfileMetrics, listPosts } from './hootsuite_api.mjs';

const [start, end] = process.argv.slice(2);
if (!start || !end) { console.error('Usage: node facebook_test.mjs <start> <end>'); process.exit(2); }
const NET = 'FACEBOOKPAGE';

const num = v => Number((v && typeof v === 'object') ? v.total : v) || 0;
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const out = [];
const log = s => { console.log(s); out.push(s); };

const profiles = (await listSocialProfiles()).filter(p => p.type === NET);
log(`## Facebook Pages via Hootsuite Analytics API — ${start} to ${end}\n`);
log(`Found ${profiles.length} FACEBOOKPAGE profiles: ${profiles.map(p => `${p.socialNetworkUsername} (${p.id})`).join(', ')}\n`);

for (const p of profiles) {
  log(`### ${p.socialNetworkUsername} (id ${p.id})`);
  // Posts. Note: posts endpoint `until` is exclusive, so +1 day (see youtube_report.mjs).
  try {
    const posts = await listPosts(p.id, start, addDays(end, 1), NET);
    const totals = {};
    for (const post of posts) for (const [k, v] of Object.entries(post.metrics || {})) {
      const n = num(v); if (n) totals[k] = (totals[k] || 0) + n;
    }
    log(`- Posts published in range: **${posts.length}**`);
    log(`- Summed post metrics (non-zero): ${Object.keys(totals).length ? '`' + JSON.stringify(totals) + '`' : '(none)'}`);
    for (const post of posts.slice(0, 3)) log(`  - ${(post.createdAt || '').slice(0, 10)} — ${String(post.content || '').replace(/\s+/g, ' ').slice(0, 70)}`);
  } catch (e) { log(`- Posts: ERROR ${String(e.message).slice(0, 300)}`); }
  // Profile-level daily metrics (inclusive until). Day before start for the follower snapshot delta.
  try {
    const rows = (await listProfileMetrics(p.id, addDays(start, -1), end, NET)).sort((a, b) => a.date.localeCompare(b.date));
    const keys = new Set(); rows.forEach(r => Object.keys(r.metrics || {}).forEach(k => keys.add(k)));
    const first = rows[0]?.metrics?.followers_count, last = rows.at(-1)?.metrics?.followers_count;
    const sum = k => rows.reduce((s, r) => s + num(r.metrics?.[k]), 0);
    log(`- Profile days returned: ${rows.length}; metric names: \`${[...keys].join(', ')}\``);
    log(`- Followers: ${num(last)} as of ${rows.at(-1)?.date} (net change over range: ${num(last) - num(first)}); gross gained ${sum('new_followers_count')}, lost ${sum('lost_followers_count')}`);
    log(`- Profile-level sums (NOT comparable to post sums): engagement ${sum('engagement')}, views ${sum('views')}, video_views ${sum('video_views')}`);
  } catch (e) { log(`- Profile metrics: ERROR ${String(e.message).slice(0, 300)}`); }
  log('');
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
