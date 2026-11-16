/**
 * facebook_test.mjs — one-off: pull the two Facebook Pages we care about (Frank LaRosa, Elite
 * Consulting Partners) via the Hootsuite Analytics API for one week.
 * Usage: node facebook_test.mjs <startDate> <endDate>
 * Headline metric = number of posts; views / engagement / followers sit below it, same layout as
 * the newsletter's platform sections. Writes the run summary and facebook_section.html (a preview
 * of that newsletter-style section). Read-only.
 * Per-post sums only (profile-level views/engagement are a different, larger metric); follower
 * growth is a followers_count snapshot delta (gross "gained" ignores unfollows).
 */
import { appendFileSync, writeFileSync } from 'fs';
import { listSocialProfiles, listProfileMetrics, listPosts } from './hootsuite_api.mjs';

const [start, end] = process.argv.slice(2);
if (!start || !end) { console.error('Usage: node facebook_test.mjs <start> <end>'); process.exit(2); }
const NET = 'FACEBOOKPAGE';
const PAGES = ['Frank LaRosa', 'Elite Consulting Partners'];

const num = v => Number((v && typeof v === 'object') ? v.total : v) || 0;
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = n => n.toLocaleString('en-US');

const profiles = (await listSocialProfiles()).filter(p => p.type === NET && PAGES.includes(p.socialNetworkUsername));
const results = [];
for (const name of PAGES) {
  const p = profiles.find(x => x.socialNetworkUsername === name);
  if (!p) { results.push({ name, error: 'page not found in Hootsuite' }); continue; }
  try {
    // posts endpoint `until` is exclusive -> +1 day (same fix as youtube_report.mjs)
    const posts = await listPosts(p.id, start, addDays(end, 1), NET);
    const sum = k => posts.reduce((s, x) => s + num(x.metrics?.[k]), 0);
    const rows = (await listProfileMetrics(p.id, addDays(start, -1), end, NET)).sort((a, b) => a.date.localeCompare(b.date));
    const first = num(rows[0]?.metrics?.followers_count), last = num(rows.at(-1)?.metrics?.followers_count);
    results.push({ name, posts: posts.length, views: sum('views'), engagement: sum('engagement'), followers: last, netFollowers: last - first });
  } catch (e) { results.push({ name, error: String(e.message).slice(0, 300) }); }
}

// run summary
const md = [`## Facebook — ${start} to ${end}`, ''];
for (const r of results) {
  if (r.error) { md.push(`### ${r.name}`, `ERROR: ${r.error}`, ''); continue; }
  md.push(`### ${r.name}`, `# **${r.posts} posts**`, '',
    `- Views: ${fmt(r.views)}`, `- Engagement: ${fmt(r.engagement)}`,
    `- Followers: ${fmt(r.followers)} (${r.netFollowers >= 0 ? '+' : ''}${r.netFollowers} this week)`, '');
}
console.log(md.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');

// newsletter-style preview
const label = t => `<div style="font-family:monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8892a4;margin-bottom:4px">${t}</div>`;
const sub = (t, v, extra = '') => `<td style="text-align:center;padding:8px 6px;vertical-align:top">${label(t)}<div style="font-size:18px;font-weight:700;color:#f0f6fc">${v}</div>${extra}</td>`;
const col = r => r.error ? `<td style="padding:16px;color:#f85149">${r.name}: ${r.error}</td>` : `
<td style="width:50%;vertical-align:top;padding:16px 12px">
  <div style="font-family:monospace;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#6ea8fe;text-align:center;margin-bottom:12px">${r.name}</div>
  <div style="text-align:center;margin-bottom:12px">${label('Posts')}<div style="font-size:40px;font-weight:700;color:#f0f6fc;line-height:1">${r.posts}</div></div>
  <table width="100%"><tbody><tr>
    ${sub('Views', fmt(r.views))}${sub('Engagement', fmt(r.engagement))}
    ${sub('Followers', fmt(r.followers), `<div style="font-family:monospace;font-size:10px;color:#8892a4">${r.netFollowers >= 0 ? '+' : ''}${r.netFollowers} this week</div>`)}
  </tr></tbody></table>
</td>`;
writeFileSync('facebook_section.html', `<!doctype html><html><body style="margin:0;background:#0a0f1e;padding:24px;font-family:Arial,sans-serif">
<table width="640" style="margin:0 auto;border:1px solid #1e2a3a;border-radius:12px;overflow:hidden"><tbody>
<tr><td colspan="2" style="background:#1877f2;height:3px"></td></tr>
<tr><td colspan="2" style="background:#111827;padding:16px 24px 12px;border-bottom:1px solid #1e2a3a;font-family:monospace;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6ea8fe">Facebook <span style="float:right;color:#8892a4;font-size:10px">${start} &ndash; ${end}</span></td></tr>
<tr style="background:#111827">${results.map(col).join('<td style="background:#1e2a3a;width:1px"></td>')}</tr>
</tbody></table></body></html>`);
