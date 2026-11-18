/**
 * diag_access.mjs — one-off, read-only: why does the API only see some Hootsuite profiles?
 * Usage: node diag_access.mjs
 * Prints ONLY structure and counts (response keys, how many orgs / profiles / teams, HTTP statuses,
 * short error codes). No names, emails or ids: this repo is public. Run only from the cloud workflow
 * (single-use Hootsuite token).
 */
import { apiGet } from './hootsuite_api.mjs';

const short = (e) => String(e.message).replace(/\s+/g, ' ').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|\b\d{6,}\b/gi, '<id>').slice(0, 160);
const step = async (label, fn) => {
  try { const r = await fn(); console.log(`OK   ${label}: ${r}`); return r; }
  catch (e) { console.log(`FAIL ${label}: ${short(e)}`); return null; }
};
const keys = (o) => Object.keys(o || {}).join(',');

// 1) the authorizing member
let me = null;
await step('GET /me', async () => { me = await apiGet('/me'); return `keys=[${keys(me?.data ?? me)}]`; });

// 2) organizations that member belongs to
let orgs = [];
await step('GET /me/organizations', async () => {
  const r = await apiGet('/me/organizations');
  orgs = r.data ?? [];
  return `${orgs.length} org(s); item keys=[${keys(orgs[0])}]; top keys=[${keys(r)}]`;
});

// 3) social profiles: raw shape (paging?) + counts by type
await step('GET /socialProfiles', async () => {
  const r = await apiGet('/socialProfiles');
  const list = r.data ?? r;
  const byType = {};
  for (const p of list) byType[p.type] = (byType[p.type] || 0) + 1;
  return `${list.length} profile(s); top keys=[${keys(r)}]; metadata=${JSON.stringify(r.metadata ?? null).slice(0, 120)}; byType=${JSON.stringify(byType)}; profile keys=[${keys(list[0])}]`;
});
await step('GET /socialProfiles?limit=100', async () => {
  const r = await apiGet('/socialProfiles?limit=100');
  return `${(r.data ?? r).length} profile(s)`;
});

// 4) per-organization views
for (const [i, org] of orgs.entries()) {
  const id = org.id;
  await step(`org#${i} GET /organizations/<id>/socialProfiles`, async () => {
    const r = await apiGet(`/organizations/${id}/socialProfiles`);
    return `${(r.data ?? r).length} profile(s)`;
  });
  await step(`org#${i} GET /organizations/<id>/members?limit=100`, async () => {
    const r = await apiGet(`/organizations/${id}/members?limit=100`);
    const m = r.data ?? r;
    const roles = {};
    for (const x of m) { const k = x.role || x.organizationRole || '?'; roles[k] = (roles[k] || 0) + 1; }
    return `${m.length} member(s); roles=${JSON.stringify(roles)}; member keys=[${keys(m[0])}]`;
  });
  await step(`org#${i} GET /organizations/<id>/teams`, async () => {
    const r = await apiGet(`/organizations/${id}/teams`);
    return `${(r.data ?? r).length} team(s)`;
  });
}

// 5) is the profile list the same as what is reachable through teams?
await step('GET /me/teams (if exists)', async () => {
  const r = await apiGet('/me/teams');
  return `${(r.data ?? r).length} team(s)`;
});
