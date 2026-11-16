/**
 * instagram_backfill.mjs — one-off. For each complete Mon-Sun week from FIRST_MONDAY through LAST_MONDAY,
 * pull Instagram post totals two ways and report the difference:
 *   old = posts endpoint with until = Sunday            (what the weekly job used to do; Sunday dropped)
 *   new = posts endpoint with until = Sunday + 1 day    (correct; `until` is exclusive)
 * Both are read from the API *today*, so the delta isolates the dropped-Sunday effect only (view counts
 * that grew since the original pull don't leak into it). Also lists the extra (Sunday) posts.
 * Usage: node instagram_backfill.mjs <firstMonday> <lastMonday> <out.json>
 * Read-only. Run only via the GitHub workflow (Hootsuite refresh token is single-use).
 */
import { writeFileSync } from 'fs';
import { listSocialProfiles, listPosts } from './hootsuite_api.mjs';

const [first, last, out] = process.argv.slice(2);
if (!first || !last || !out) { console.error('Usage: node instagram_backfill.mjs <firstMonday> <lastMonday> <out.json>'); process.exit(2); }
const num = v => Number((v && typeof v === 'object') ? v.total : v) || 0;
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const KEYS = ['likes', 'comments', 'shares', 'saves', 'views', 'engagement'];
const totals = posts => { const t = { posts: posts.length }; for (const k of KEYS) t[k] = posts.reduce((s, p) => s + num(p.metrics?.[k]), 0); return t; };

const prof = (await listSocialProfiles()).find(p => p.type === 'INSTAGRAMBUSINESS' && p.socialNetworkUsername === 'franklarosa.elite');
if (!prof) throw new Error('Instagram profile franklarosa.elite not found');

const weeks = [];
for (let mon = first; mon <= last; mon = addDays(mon, 7)) {
  const sun = addDays(mon, 6);
  const oldPosts = await listPosts(prof.id, mon, sun);                 // exclusive until = Sunday (old behaviour)
  const newPosts = await listPosts(prof.id, mon, addDays(sun, 1));     // correct
  const oldIds = new Set(oldPosts.map(p => p.id ?? p.externalId));
  const extra = newPosts.filter(p => !oldIds.has(p.id ?? p.externalId)).map(p => ({
    date: (p.createdAt || '').slice(0, 10), engagement: num(p.metrics?.engagement), views: num(p.metrics?.views),
    likes: num(p.metrics?.likes), comments: num(p.metrics?.comments), shares: num(p.metrics?.shares), saves: num(p.metrics?.saves),
    type: p.metadata?.postType || p.metadata?.mediaType || 'Post', caption: (p.content || '').slice(0, 140),
  }));
  const o = totals(oldPosts), n = totals(newPosts);
  const delta = {}; for (const k of ['posts', ...KEYS]) delta[k] = n[k] - o[k];
  weeks.push({ start: mon, end: sun, old: o, new: n, delta, extra });
  console.log(`${mon}: posts ${o.posts} -> ${n.posts} (+${delta.posts}), eng +${delta.engagement}, views +${delta.views}`);
  await new Promise(r => setTimeout(r, 400));
}
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), weeks }, null, 2));
