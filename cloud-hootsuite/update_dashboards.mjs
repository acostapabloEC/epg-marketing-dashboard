/**
 * update_dashboards.mjs — deterministic replacements for the edits Claude used to make by hand
 * each Monday (see the epg-youtube-weekly-update / epg-instagram-weekly-update task rules).
 * Both functions are idempotent: re-running for an already-applied week changes nothing.
 *
 * applyYouTube(repoDir, report)   -> edits src/App.jsx (weeklyData, monthlyData, Subscribers KPI, topPosts)
 * applyInstagram(repoDir, report) -> edits src/instagram-data.json (monthly, topMedia, updatedAt)
 * Return: { status: 'applied'|'already_applied', file, eng, notes[], summary }
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = n => String(n).padStart(2, '0');
const parse = s => new Date(s + 'T00:00:00Z');
export const monDD = s => { const d = parse(s); return `${MON[d.getUTCMonth()]} ${pad2(d.getUTCDate())}`; };
const monD = s => { const d = parse(s); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const fmtInt = n => Number(n).toLocaleString('en-US');

export function applyYouTube(repoDir, r) {
  const file = path.join(repoDir, 'src', 'App.jsx');
  const raw = readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let t = raw.replace(/\r\n/g, '\n');
  const notes = [];
  const label = monDD(r.startDate);
  const month = MON[parse(r.startDate).getUTCMonth()];

  // (a) weeklyData
  const wm = t.match(/const weeklyData = \[\n([\s\S]*?)\n\];/);
  if (!wm) throw new Error('weeklyData block not found in App.jsx');
  if (new RegExp(`week:\\s*"${label}"`).test(wm[1])) {
    return { status: 'already_applied', file, eng: r.engagements, notes: [`weeklyData already has "${label}"`], summary: '' };
  }
  const row = `  { week: "${label}", engagements: ${r.engagements}, likes: ${r.likes}, comments: ${r.comments}, shares: ${r.shares}, views: ${r.views}, posts: ${r.posts} },`;
  t = t.replace(wm[0], `const weeklyData = [\n${wm[1]}\n${row}\n];`);

  // (b) monthlyData
  const mm = t.match(/const monthlyData = \[\n([\s\S]*?)\n\];/);
  if (!mm) throw new Error('monthlyData block not found in App.jsx');
  const lines = mm[1].split('\n');
  const rowRe = /^(\s*)\{ month: "(\w+)",\s+engagements: (\d+),\s+likes: (\d+),\s+comments: (\d+),\s+shares: (\d+),\s+views: (\d+),\s+posts: (\d+) \},?\s*$/;
  const last = lines[lines.length - 1].match(rowRe);
  if (!last) throw new Error('Could not parse last monthlyData row');
  const fmtRow = (m, v) => `  { month: "${m}", engagements: ${v[0]}, likes: ${v[1]}, comments: ${v[2]}, shares: ${v[3]}, views: ${v[4]}, posts: ${v[5]} },`;
  const wk = [r.engagements, r.likes, r.comments, r.shares, r.views, r.posts];
  if (last[2] === month) {
    const cur = last.slice(3, 9).map(Number);
    lines[lines.length - 1] = fmtRow(month, cur.map((x, i) => x + wk[i]));
  } else {
    lines.push(fmtRow(month, wk));
  }
  t = t.replace(mm[0], `const monthlyData = [\n${lines.join('\n')}\n];`);
  if (parse(r.endDate).getUTCMonth() !== parse(r.startDate).getUTCMonth()) {
    notes.push(`Week straddles two months; whole week assigned to ${month} (start-date convention).`);
  }

  // (c) Subscribers KPI
  if (r.subscribersTotal != null) {
    const kpi = /(label="Subscribers" value=")([\d,]+)(")/;
    if (!kpi.test(t)) throw new Error('Subscribers KpiCard value not found');
    t = t.replace(kpi, `$1${fmtInt(r.subscribersTotal)}$3`);
  } else notes.push('subscribersTotal unavailable; Subscribers value left unchanged.');
  if (r.subscribersGainedThisWeek != null) {
    const g = r.subscribersGainedThisWeek;
    const sub = /(label="Subscribers"[^\n]*· )[+-]?\d+( this week)/;
    if (!sub.test(t)) throw new Error('Subscribers "this week" fragment not found');
    t = t.replace(sub, `$1${g >= 0 ? '+' : '-'}${Math.abs(g)}$2`);
  } else notes.push('subscribersGainedThisWeek unavailable (null); "+N this week" left at previous value.');

  // (d) topPosts
  const tm = t.match(/const topPosts = \[\n([\s\S]*?)\n\];/);
  if (!tm) throw new Error('topPosts block not found in App.jsx');
  if (r.topPosts?.length) {
    const items = r.topPosts.slice(0, 3).map(p =>
      `  { date: "${monD(p.date)}", engagements: ${p.engagements}, likes: ${p.likes}, views: ${p.views}, title: "${esc(p.title)}" },`);
    t = t.replace(tm[0], `const topPosts = [\n${items.join('\n')}\n];`);
  } else notes.push('No posts this week; topPosts left unchanged.');

  writeFileSync(file, t.replace(/\n/g, eol), 'utf8');
  return {
    status: 'applied', file, eng: r.engagements, notes,
    summary: `${r.engagements} engagements (${r.likes} likes, ${r.comments} comments, ${r.shares} shares), ${fmtInt(r.views)} views, ${r.posts} posts; subscribers ${r.subscribersTotal ?? 'n/a'} (${r.subscribersGainedThisWeek ?? 'n/a'} this week)`,
  };
}

export function applyInstagram(repoDir, r) {
  const file = path.join(repoDir, 'src', 'instagram-data.json');
  const raw = readFileSync(file, 'utf8');
  const d = JSON.parse(raw);
  const notes = [];
  if (d.updatedAt >= r.endDate) {
    return { status: 'already_applied', file, eng: r.engagement, notes: [`updatedAt ${d.updatedAt} already >= ${r.endDate}`], summary: '' };
  }
  const key = r.startDate.slice(0, 7);

  // (a) monthly running rollup
  const last = d.monthly[d.monthly.length - 1];
  if (last && last.month === key) {
    last.eng += r.engagement; last.views += r.views; last.likes += r.likes;
    last.shares += r.shares; last.saves += r.saves;
    if (r.newFollowers != null) last.newFollowers = (last.newFollowers ?? 0) + r.newFollowers;
    else notes.push('newFollowers unavailable (null); not touched.');
  } else {
    const row = { month: key, eng: r.engagement, views: r.views, likes: r.likes, shares: r.shares, saves: r.saves };
    if (r.newFollowers != null) row.newFollowers = r.newFollowers;
    else notes.push('newFollowers unavailable (null); omitted from new month row.');
    d.monthly.push(row);
  }
  if (r.endDate.slice(0, 7) !== key) notes.push(`Week straddles two months; whole week assigned to ${key} (start-date convention).`);

  // (b) all-time top-5, only if this week's best post beats the current lowest
  const top = r.topPosts?.[0];
  let topChanged = false;
  if (top && d.topMedia.length) {
    const lowest = d.topMedia.reduce((a, b) => (b.engagement < a.engagement ? b : a));
    const dup = d.topMedia.some(m => m.date === top.date && m.caption === top.caption);
    if (top.engagement > lowest.engagement && !dup) {
      d.topMedia.splice(d.topMedia.indexOf(lowest), 1);
      d.topMedia.push({
        date: top.date, type: top.type, caption: top.caption, likes: top.likes, comments: top.comments,
        shares: top.shares, saves: top.saves, views: top.views, reach: top.reach,
        engagement: top.engagement, engRate: top.engRate,
      });
      d.topMedia.sort((a, b) => b.engagement - a.engagement);
      topChanged = true;
    }
  }
  notes.push(topChanged ? 'topMedia CHANGED (new all-time top-5 entry).' : 'topMedia unchanged.');

  // (c) updatedAt
  d.updatedAt = r.endDate;

  writeFileSync(file, JSON.stringify(d, null, 2), 'utf8'); // file has no trailing newline, 2-space indent
  return {
    status: 'applied', file, eng: r.engagement, notes,
    summary: `${r.engagement} engagement, ${fmtInt(r.views)} views, ${r.likes} likes, ${r.comments} comments, ${r.saves} saves, ${r.shares} shares, ${r.postsCount} posts; net followers ${r.newFollowers ?? 'n/a'}`,
  };
}
