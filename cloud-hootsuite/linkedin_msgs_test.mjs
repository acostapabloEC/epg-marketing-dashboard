/**
 * linkedin_msgs_test.mjs — one-off: can Hootsuite's /messages endpoint count LinkedIn posts?
 * Usage: node linkedin_msgs_test.mjs <out.json> [weeks=4]
 * Prints ONLY network type + public handle + per-week counts by message state (no ids/tokens/text;
 * this repo is public). Read-only. Only sees posts made THROUGH Hootsuite (not native LinkedIn posts).
 */
import { writeFileSync } from 'fs';
import { listSocialProfiles, apiGet } from './hootsuite_api.mjs';

const out = process.argv[2];
const N = Number(process.argv[3] || 4);
if (!out) { console.error('Usage: node linkedin_msgs_test.mjs <out.json> [weeks]'); process.exit(2); }

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const curMon = addDays(asOf, -((new Date(asOf + 'T12:00:00Z').getUTCDay() + 6) % 7));

const profiles = (await listSocialProfiles()).filter(p => String(p.type).startsWith('LINKEDIN'));
const result = [];
for (const p of profiles) {
  const row = { type: p.type, handle: p.socialNetworkUsername, weeks: {} };
  for (let i = N; i >= 1; i--) {
    const mon = addDays(curMon, -7 * i);
    const qs = new URLSearchParams({
      startTime: `${mon}T00:00:00Z`,
      endTime: `${addDays(mon, 7)}T00:00:00Z`,
      limit: '100',
    });
    qs.append('socialProfileIds', p.id);
    try {
      const r = await apiGet(`/messages?${qs}`);
      const msgs = r.data ?? [];
      const byState = {};
      for (const m of msgs) byState[m.state ?? 'UNKNOWN'] = (byState[m.state ?? 'UNKNOWN'] || 0) + 1;
      row.weeks[mon] = { total: msgs.length, byState };
    } catch (e) {
      row.weeks[mon] = 'ERR ' + String(e.message).replace(/\s+/g, ' ').slice(0, 160);
    }
  }
  result.push(row);
  console.log(row.type, '|', row.handle, '|', JSON.stringify(row.weeks));
}
writeFileSync(out, JSON.stringify(result, null, 2));
