/**
 * run_platform.mjs — one platform's whole weekly update: pull -> edit -> build -> commit/push -> verify.
 * Usage: node run_platform.mjs <youtube|instagram> <repoDir> <startDate> <endDate>
 * Env:   DRY_RUN=true  -> pull/edit/build only, no commit/push/verify
 *        SKIP_BUILD=1  -> skip npm ci/build (local testing)
 *        RESULT_DIR    -> where result_<platform>.json is written (default cwd)
 * Always exits 0 and records the outcome in result_<platform>.json; the workflow decides pass/fail.
 */
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyYouTube, applyInstagram, monDD } from './update_dashboards.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [platform, repoDir, start, end] = process.argv.slice(2);
const isTrue = v => v === 'true' || v === '1';
const DRY = isTrue(process.env.DRY_RUN);
const SITES = { youtube: 'https://epg-youtube-dashboard.vercel.app', instagram: 'https://epg-instagram-dashboard.vercel.app' };

if (!SITES[platform] || !repoDir || !start || !end) {
  console.error('Usage: node run_platform.mjs <youtube|instagram> <repoDir> <startDate> <endDate>');
  process.exit(2);
}

const result = { platform, start, end, status: 'failed', step: '', message: '', summary: '', notes: [] };
function done() {
  writeFileSync(path.join(process.env.RESULT_DIR || '.', `result_${platform}.json`), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result));
  process.exit(0);
}
function fail(step, message) { result.step = step; result.message = String(message).slice(-1500); result.status = 'failed'; done(); }
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024, ...opts });

// 1. pull
const script = path.join(__dirname, platform === 'youtube' ? 'youtube_report.mjs' : 'instagram_report.mjs');
let report;
if (process.env.REPORT_FIXTURE) { // local testing only: use a saved report instead of calling Hootsuite
  report = JSON.parse(readFileSync(process.env.REPORT_FIXTURE, 'utf8'));
} else {
  const pull = run('node', [script, start, end, '--json']);
  if (pull.status !== 0) fail('pull', pull.stderr || pull.stdout);
  try { report = JSON.parse(pull.stdout.trim().split('\n').pop()); } catch (e) { fail('pull', `Unparseable report output: ${pull.stdout.slice(-300)}`); }
}

// 2. edit
let edit;
try { edit = platform === 'youtube' ? applyYouTube(repoDir, report) : applyInstagram(repoDir, report); }
catch (e) { fail('edit', e.message); }
result.summary = edit.summary; result.notes = edit.notes;
if (edit.status === 'already_applied') { result.status = 'already_applied'; done(); }

// 3. build
if (process.env.SKIP_BUILD !== '1') {
  const ci = run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: repoDir });
  if (ci.status !== 0) fail('build', `npm ci failed:\n${ci.stderr || ci.stdout}`);
  const b = run('npm', ['run', 'build'], { cwd: repoDir });
  if (b.status !== 0) fail('build', b.stderr || b.stdout);
}
if (DRY) { result.status = 'dry_run_ok'; done(); }

// 4. commit + push (only the one data file)
const rel = path.relative(repoDir, edit.file).replace(/\\/g, '/');
const msg = `Data: ${monDD(start)}-${monDD(end)} — ${edit.eng} eng`;
for (const args of [['add', rel], ['commit', '-m', msg], ['push']]) {
  const g = run('git', args, { cwd: repoDir });
  if (g.status !== 0) fail('push', `git ${args[0]} failed:\n${g.stderr || g.stdout}`);
}

// 5. verify the deploy is live: the new data must appear in the served JS bundle
const marker = platform === 'youtube' ? new RegExp(`week:["'\`]${monDD(start)}["'\`]`) : new RegExp(end);
const site = SITES[platform];
async function live() {
  const html = await (await fetch(`${site}/?t=${Date.now()}`)).text();
  const srcs = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  for (const s of srcs) if (marker.test(await (await fetch(site + s)).text())) return true;
  return false;
}
let ok = false;
for (let i = 0; i < 15 && !ok; i++) {
  await new Promise(r => setTimeout(r, 20000));
  try { ok = await live(); } catch { /* retry */ }
}
result.status = ok ? 'updated' : 'pushed_unverified';
if (!ok) { result.step = 'verify'; result.message = `Pushed, but ${site} did not show the new data within 5 minutes.`; }
done();
