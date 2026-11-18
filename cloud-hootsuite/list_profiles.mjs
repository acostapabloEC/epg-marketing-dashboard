/**
 * list_profiles.mjs — one-off: which Hootsuite social profiles exist, and can we count their posts?
 * Usage: node list_profiles.mjs <out.json> [weeks=4]
 * Prints ONLY network type + public handle + post counts for the last N complete weeks (no ids/tokens;
 * this repo is public). Read-only. Run only from the cloud workflow (single-use Hootsuite token).
 */
import { writeFileSync } from 'fs';
import { listSocialProfiles, listPosts } from './hootsuite_api.mjs';

const out = process.argv[2];
const N = Number(process.argv[3] || 4);
if (!out) { console.error('Usage: node list_profiles.mjs <out.json> [weeks]'); process.exit(2); }

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const curMon = addDays(asOf, -((new Date(asOf + 'T12:00:00Z').getUTCDay() + 6) % 7));

const profiles = await listSocialProfiles();
const result = [];
for (const p of profiles) {
  const row = { type: p.type, handle: p.socialNetworkUsername, weeks: {} };
  if (p.type === 'LINKEDIN' || p.type === 'LINKEDINCOMPANY') { row.note = 'skipped (LinkedIn not supported by analytics API)'; result.push(row); console.log(row.type, '|', row.handle, '|', row.note); continue; }
  for (let i = N; i >= 1; i--) {
    const mon = addDays(curMon, -7 * i);
    try {
      const posts = await listPosts(p.id, mon, addDays(mon, 7), p.type);
      row.weeks[mon] = posts.length;
    } catch (e) {
      row.weeks[mon] = 'ERR ' + String(e.message).replace(/\s+/g, ' ').slice(0, 90);
    }
  }
  result.push(row);
  console.log(row.type, '|', row.handle, '|', JSON.stringify(row.weeks));
}
writeFileSync(out, JSON.stringify(result, null, 2));
