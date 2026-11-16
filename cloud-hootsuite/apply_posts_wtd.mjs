/**
 * apply_posts_wtd.mjs — merges posts_wtd.json into the Posting Volume dashboard's
 * src/posts-data.json (Instagram, YouTube, Facebook only; everything else is left alone).
 * Usage: node apply_posts_wtd.mjs <posts_wtd.json> <path/to/posts-data.json>
 * Idempotent: re-running with the same input changes nothing. Only touches the two weeks in the input.
 */
import { readFileSync, writeFileSync } from 'fs';

const [src, dest] = process.argv.slice(2);
const w = JSON.parse(readFileSync(src, 'utf8'));
const data = JSON.parse(readFileSync(dest, 'utf8'));
const plat = id => data.platforms.find(p => p.id === id);
const st = (label, value = null, change = null) => ({ label, value, change });

const ok = c => c && !c.error;
const weeks = [[w.prevMon, 'previous'], [w.curMon, 'current']];

if (!data.weeks.includes(w.curMon)) data.weeks.push(w.curMon);
data.weeks.sort();
data.asOf = w.asOf;

for (const [monday, which] of weeks) {
  const ig = w.channels.instagram?.[which];
  const yt = w.channels.youtube?.[which];
  const fbs = [w.channels.facebook_frank?.[which], w.channels.facebook_ecp?.[which]];
  const labels = [w.channels.facebook_frank?.label, w.channels.facebook_ecp?.label];

  if (ok(ig)) {
    const p = plat('instagram');
    p.weekly[monday] = ig.posts;
    p.pageDetail ||= {};
    p.pageDetail[monday] = [{ name: 'Frank LaRosa', posts: ig.posts, stats: [st('Views', ig.views), st('Engagement', ig.engagement), st('Followers', null, ig.netFollowers)] }];
  }
  if (ok(yt)) plat('youtube').weekly[monday] = yt.posts;
  if (fbs.every(ok)) {
    const p = plat('facebook');
    p.weekly[monday] = fbs.reduce((s, c) => s + c.posts, 0);
    p.pageDetail ||= {};
    p.pageDetail[monday] = fbs.map((c, i) => ({ name: labels[i], posts: c.posts, stats: [st('Views', c.views), st('Engagement', c.engagement), st('Followers', c.followers, c.netFollowers)] }));
  }
}

data.updatedAt = w.asOf;
writeFileSync(dest, JSON.stringify(data, null, 1) + '\n');
console.log(`Applied weeks ${w.prevMon} and ${w.curMon} (as of ${w.asOf}) to ${dest}`);
