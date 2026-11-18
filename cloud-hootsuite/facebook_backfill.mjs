/**
 * facebook_backfill.mjs — one-off: weekly Facebook + Instagram post counts for the last N complete weeks
 * (Frank LaRosa + Elite Consulting Partners Pages), to set a historical baseline.
 * Usage: node facebook_backfill.mjs <out.json> [weeks=12]
 * Same method as posts_wtd.mjs: count of POST /analytics/posts rows, `until` = end + 1 day (exclusive).
 * Read-only. Run only from the cloud workflow (single-use Hootsuite token).
 */
import { writeFileSync } from 'fs';
import { listSocialProfiles, listPosts } from './hootsuite_api.mjs';

const out = process.argv[2];
const N = Number(process.argv[3] || 12);
if (!out) { console.error('Usage: node facebook_backfill.mjs <out.json> [weeks]'); process.exit(2); }

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const curMon = addDays(asOf, -((new Date(asOf + 'T12:00:00Z').getUTCDay() + 6) % 7));

const SPECS = {
  frank: { type: 'FACEBOOKPAGE', name: 'Frank LaRosa' },
  ecp: { type: 'FACEBOOKPAGE', name: 'Elite Consulting Partners' },
  instagram: { type: 'INSTAGRAMBUSINESS', name: 'franklarosa.elite' },
};
const profiles = await listSocialProfiles();
const result = { generatedAt: new Date().toISOString(), curMon, weeks: {} };

for (let i = N; i >= 1; i--) {
  const mon = addDays(curMon, -7 * i), sun = addDays(mon, 6);
  result.weeks[mon] = {};
  for (const [key, spec] of Object.entries(SPECS)) {
    const name = spec.name;
    const prof = profiles.find(p => p.type === spec.type && p.socialNetworkUsername === name);
    if (!prof) { result.weeks[mon][key] = { error: `profile "${name}" not found` }; continue; }
    try {
      const posts = await listPosts(prof.id, mon, addDays(sun, 1), spec.type);
      result.weeks[mon][key] = posts.length;
    } catch (e) {
      result.weeks[mon][key] = { error: String(e.message).slice(0, 200) };
    }
  }
  console.log(mon, JSON.stringify(result.weeks[mon]));
}
writeFileSync(out, JSON.stringify(result, null, 2));
