/**
 * notify_summary.mjs — one email to Pablo summarising the YouTube + Instagram run.
 * Env: SMTP_HOST/PORT/USER/PASS, EMAIL_FROM, RESULT_DIR, START, END, PERSIST_OUTCOME, DRY_RUN, RUN_URL
 * Prints the email instead of sending when DRY_PRINT=1.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const dir = process.env.RESULT_DIR || '.';
const load = p => { const f = path.join(dir, `result_${p}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
const results = [load('youtube'), load('instagram')];
const names = { youtube: 'YouTube', instagram: 'Instagram' };
const persistFailed = process.env.PERSIST_OUTCOME === 'failure';
const OK = new Set(['updated', 'already_applied', 'dry_run_ok']);
const anyBad = persistFailed || results.some(r => !r || !OK.has(r.status));
const week = `${process.env.START} to ${process.env.END}`;

const lines = [];
for (const [i, p] of ['youtube', 'instagram'].entries()) {
  const r = results[i];
  if (!r) { lines.push(`${names[p]}: NO RESULT (step did not run).`); continue; }
  if (r.status === 'updated') lines.push(`${names[p]}: updated and verified live. ${r.summary}`);
  else if (r.status === 'already_applied') lines.push(`${names[p]}: already up to date for this week, nothing changed.`);
  else if (r.status === 'dry_run_ok') lines.push(`${names[p]}: DRY RUN ok (built, not pushed). ${r.summary}`);
  else if (r.status === 'pushed_unverified') lines.push(`${names[p]}: PUSHED but not confirmed live — check the Vercel deploy. ${r.summary}`);
  else lines.push(`${names[p]}: FAILED at "${r.step}". ${r.message}`);
  for (const n of r.notes || []) lines.push(`   - ${n}`);
}
if (persistFailed) {
  lines.push('', 'URGENT: the rotated Hootsuite refresh token could NOT be saved back to GitHub. The token chain is likely broken for next week. Run `node hootsuite_oauth.mjs` on the laptop, then update the HOOTSUITE_REFRESH_TOKEN secret (set_hootsuite_secrets.sh).');
}
lines.push('', `Run: ${process.env.RUN_URL || '(local)'}`);

const subject = `${anyBad ? 'YouTube + Instagram weekly update FAILED' : 'YouTube + Instagram weekly update'} — ${week}${process.env.DRY_RUN === 'true' ? ' (dry run)' : ''}`;
const body = lines.join('\n');

if (process.env.DRY_PRINT === '1') { console.log(subject + '\n\n' + body); process.exit(0); }

const { default: nodemailer } = await import('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
const t = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure: false, auth: { user: SMTP_USER, pass: SMTP_PASS } });
await t.sendMail({ from: EMAIL_FROM || SMTP_USER, to: 'pabloacosta@eliteconsultingpartners.com', subject, text: body });
console.log('Notification sent.');
if (anyBad) process.exit(1); // surface failure in the Actions UI too
