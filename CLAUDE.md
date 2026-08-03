# EPG LinkedIn / Marketing Dashboard

React/Vite app. Start sessions from this folder so this context loads automatically.

- **Local:** `C:\Users\ECP\epg-marketing-dashboard\`
- **GitHub:** acostapabloEC/epg-marketing-dashboard
- **Vercel:** epg-marketing-dashboard.vercel.app ✓ auto-deploy on push
- **Password:** Elite2026

---

## ⚠ Playwright scraper PAUSED (2026-08-03, at Pablo's request — until further notice)

`carla_report.js`, `top_posts.js`, and `linkedin_report.js` all automate a real login +
UI navigation on Frank's actual LinkedIn account. Even though this reuses a real browser
(lower-risk than API/cookie-replay automation) it's still automated access under a strict
reading of LinkedIn's ToS, and Frank's account is his real professional identity — not
something to risk for a weekly report. **Do not run any of these three scripts** (or
anything that calls `ensureLoggedIn`/`setCustomDateRange`/`exportAnalyticsWorkbook` in
`linkedin_export.mjs`) until Pablo explicitly says to resume.

**Current process instead:** Pablo exports the report by hand from LinkedIn (Creator
Analytics → Export → Custom range) and provides the file — drop it in
`scraper/manual-exports/`. Then run:
```
node parse_manual_export.js manual-exports/<file>.xlsx <startDate> <endDate>
```
This produces the exact same JSON shape `linkedin_report.js` did (engagements,
impressions, membersReached, posts, followersGained, followersTotal, topPosts[]) — purely
local file parsing, zero LinkedIn interaction. The rest of the weekly update (editing
`App.jsx`, build, push, verify, log, notify) is unchanged.

**One gap:** the export's TOP POSTS sheet has each post's URL/date/numbers but not its
caption text — getting that required visiting each post's page directly (the live
scraper's `fetchPostPreview`), which is exactly the automated-access risk being avoided.
`topPosts[].preview` comes back empty from `parse_manual_export.js`; leave it blank or
fill it in by hand if captions are wanted on the dashboard.

Carla's and John's reports are unaffected — they already read from `App.jsx`'s already-
updated `weeklyData`, not a live scrape (see `C:\Users\ECP\carla\CLAUDE.md` and
`john_report\` for detail).

---

## The one file to edit

**`src/App.jsx`** — all weekly data lives here. Four things to update each week:

| Array | What it holds |
|---|---|
| `weeklyData` | One row per week — engagements, impressions, posts, followers, membersReached |
| `monthlyData` | Running monthly totals + goal |
| `topPosts` | Top 3 posts of the week |
| `TOTAL_FOLLOWERS` | Cumulative follower count (line ~59) |

Everything else (header dates, KPI labels, banner, footer) derives automatically from `weeklyData[last]`. Never hardcode dates anywhere else.

---

## Weekly update workflow

1. **Get the export** — LinkedIn Analytics → Creator → Export → Custom range (Mon–Sun).
   File lands in Downloads: `AggregateAnalytics_Frank LaRosa_<start>_<end>.xlsx`
   Sheets: DISCOVERY (totals), ENGAGEMENT (daily), TOP POSTS, FOLLOWERS, DEMOGRAPHICS

2. **Pull numbers from the export:**
   - ENGAGEMENT sheet: sum daily engagements and impressions for the week
   - DISCOVERY sheet: impressions + members reached (totals)
   - FOLLOWERS sheet: sum new followers column for the week; read total followers
   - TOP POSTS sheet: top 3 by engagements for the week

3. **Edit `src/App.jsx`:**
   - Append to `weeklyData`: `{ week: "Mon DD", engagements: N, impressions: N, posts: N, followers: N }`
   - Update current month in `monthlyData` (add new week's engagements to running total)
   - Replace `topPosts` array with this week's top 3
   - Update `TOTAL_FOLLOWERS`

4. **Build and push:**
   ```
   npm run build        ← always run first; catches syntax errors before they break Vercel
   git add src/App.jsx
   git commit -m "Data: <Mon DD>-<Sun DD> — <N> eng"
   git push             ← Vercel auto-deploys
   ```

5. **Verify deploy:** `bfb3c87`-style — check Vercel API or visit the live URL.

6. **Update TV dashboard** — `C:\Users\ECP\epg-tv-dashboard\src\App.jsx` has its own copy of `weeklyData`. Same numbers, no `posts` field. Update and push in the same session.

7. **Notify:**
   - **Carla Wade** (carlawade@eliteconsultingpartners.com) — fully automated as of 2026-07-20: the `epg-carla-report-weekly` scheduled task (Mondays ~9:22am, between this LinkedIn task and John's) runs `send_carla_email.js --send`, which reads this week's row from `src/App.jsx` (no re-scrape) plus a daily breakdown from `linkedin_report_export_tmp.xlsx`. Engagement numbers only, by design — never add impressions/posts/followers. Nothing to do here manually. Full detail (including a since-fixed SMTP DNS bug) in `C:\Users\ECP\carla\CLAUDE.md`.
   - **John Schreppler** — fully automated as of 2026-07-15, **chained directly into this LinkedIn task as of 2026-07-27**: Step 9 of `epg-linkedin-weekly-update` sends John's email (+ Teams DM if ever configured) as its own final step, right after this task verifies its dashboard deploy went live. Nothing to do here manually. The old standalone `epg-john-report-weekly` scheduled task is now disabled (kept only as a manual-fallback path, same script) — chaining replaced it after the standalone task's fixed ~18-minute clock offset proved unreliable when both tasks caught up in the same burst after the app was reopened. Scripts live in `C:\Users\ECP\epg-marketing-dashboard\john_report\` (moved from `frank\john_report\`); the old `1 - PREVIEW.bat` / `2 - SEND TO JOHN.bat` still work for an ad-hoc resend if ever needed.

---

## Week labeling convention

Label = **Monday start date**: `"Mon DD"` (3-letter month, space, day with no leading zero).
- ✓ `"Jul 06"`, `"Jun 29"`, `"Mar 02"`
- ✗ `"Jul 7"`, `"July 06"`, `"07/06"`

The dashboard computes the end date as start + 6 days. The header will automatically show "Jul 6–12".

---

## Data rules and gotchas

- **Always include `followers` on new rows.** The follower KPI card uses `latestWeek.followers`. Missing = NaN on screen.
- **The last two rows must both have `followers`** — the MoM delta divides by `prevWeek.followers`. If it's undefined, you get NaN/Infinity.
- **Month straddle** (e.g., Jun 30 – Jul 6): LinkedIn export can't cross months. Pull two separate exports and sum them. Enter as one row in `weeklyData` using the Monday start date.
- **The Jun 28 / Jun 29 duplicate rows** are a known data entry error — two overlapping rows at the Jun/Jul boundary. Don't replicate the pattern.
- **May 2026 numbers are intentionally low** — posting frequency was cut deliberately. Not a bug.
- **LinkedIn numbers revise throughout the day.** Tuesday 11am is the canonical reading time.
- **`membersReached` (added 2026-07-20)** — `linkedin_report.js` always computes this; the newsletter build (`monday_routine.py`) reads it straight off the last `weeklyData` row. Rows before Jul 13 don't have it and don't need backfilling — the newsletter falls back to that week's `epg\log\` entry for older weeks.
- **The "Top Posts by Engagements" subtitle is auto-derived (fixed 2026-07-20)** — `topPostsLabel` in `App.jsx` computes `"${weekLabel} · Top ${topPosts.length} · LinkedIn export"` automatically. It used to be a hardcoded string (`"Jan–Apr 2026 · Top 5 · LinkedIn export"`) that went stale for months and even claimed "Top 5" while only 3 posts rendered. Never hand-edit this subtitle — only edit the `topPosts` array itself.

---

## Scraper — `scraper/carla_report.js`

Playwright + MS Edge persistent profile (`scraper/edge-profile/`). Navigates to LinkedIn Creator Analytics, sets a custom date range, clicks Export, downloads the XLSX, parses daily rows.

**Run:** `node carla_report.js 2026-07-06 2026-07-12`
**JSON mode:** `node carla_report.js 2026-07-06 2026-07-12 --json`
**Credentials:** `scraper/.env` — `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD`

**Known issues:**
- Date picker — fixed 2026-07-14 (bilingual EN/ES selector matching + retry-based hydration wait in `linkedin_export.mjs`). This section previously said it was still broken; it wasn't, as of the last check.
- When Export fails: fallback reads page text for "last 7 days" total — inaccurate for partial weeks.
- If session expires (LinkedIn 2FA): run with `headless: false`, log in manually, profile saves the session.
- Debug screenshots saved to: `scraper/debug-carla-before.png`, `scraper/debug-carla-picker.png`

**Fixed bugs (already in code):**
- `fs` not imported in `tryExportAndParse` — fixed
- `setCustomDateRange()` defined but never called before export — fixed
- Page load wait increased from 4s → 8s for analytics to render
- **`fetchPostPreview` selectors were dead (fixed 2026-07-20)** — LinkedIn shipped a frontend rebuild that replaced its old stable classes (`.feed-shared-text`, `dir="ltr"` spans) with hashed/atomic CSS class names, so every `topPosts[].preview` silently came back `""` for weeks. Now uses `span[data-testid="expandable-text-box"]` (falls back to `p[componentkey^="feed-commentary_"]`, then the old selectors in case LinkedIn A/B-tests an older build). Verified working on live posts 2026-07-20. If previews go empty again, LinkedIn likely changed its DOM again — re-run the debug approach (navigate to a post URL, find the text node, walk up the DOM for a stable `data-testid`/`componentkey` attribute) rather than reverting to the old `dir="ltr"` selectors.
- **`notify_pablo.mjs` DNS bug (fixed 2026-07-20)** — nodemailer's internal hostname resolution uses a raw `dns.Resolver().resolve4()` UDP query, which times out (`ETIMEOUT`) on this machine's network even though the OS resolver (`dns.lookup`) works fine. Fixed by pre-resolving the SMTP host via `dns.lookup` and connecting by IP with `tls: { servername }` set for SNI/cert validation. The same underlying issue likely affects any other nodemailer script here (e.g. `send_carla_email.js`) if it ever starts failing with a DNS timeout.
- **Export downloads silently hung forever (fixed 2026-08-03)** — LinkedIn now opens the analytics export in a new browser tab instead of firing the download on the original page. `exportAnalyticsWorkbook()` in `linkedin_export.mjs` only listened for the `download` event on `page`, so it never saw it — Export and Confirm both click fine, then it just times out with no error pointing at the real cause. Fixed by listening on `page.context().waitForEvent('download', ...)` instead (catches a download on any tab the context opens). Affects every script that calls `exportAnalyticsWorkbook()` (`carla_report.js`, `top_posts.js`, `linkedin_report.js`) since the fix lives in the shared module.

**Workaround while scraper is broken:** Download the export manually from LinkedIn and read it with:
```
node -e "import('xlsx').then(X=>{const XLSX=X.default||X;const wb=XLSX.readFile('path/to/file.xlsx');wb.SheetNames.forEach(n=>{const rows=XLSX.utils.sheet_to_json(wb.Sheets[n],{raw:false});console.log(n,JSON.stringify(rows))})})"
```
Run from `C:\Users\ECP\epg-marketing-dashboard\scraper\` (xlsx is installed there).

---

## Newsletter build automation (rewritten 2026-07-20)

`scraper/monday_routine.py` builds the newsletter, deploys the preview to `epg-exec-form`,
and emails Pablo for approval — scheduled (`epg-newsletter-weekly-build`, Mondays 9:35am,
after all the per-platform tasks it depends on). It does **not** send to Brian, John, Frank,
or the full list — that stays a manual, human-approved step per the 3-step send workflow in
`epg-exec-form/CLAUDE.md`.

**Rewritten 2026-07-20** after the first live scheduled run surfaced a chain of bugs (empty
preview email → wrong engagement numbers → wrong template entirely → stale Brian commentary →
missing Members Reached → fabricated Instagram Reach). Full history in memory
`project_epg_newsletter_automation` / `feedback_newsletter_no_scraping`. Current correct state:

- **Never scrapes or re-parses raw exports itself** — LinkedIn comes from `src/App.jsx`'s
  `weeklyData`/`topPosts` (not the orphaned `weekly-data.json`); Instagram/YouTube come from
  `instagram_report.mjs`/`youtube_report.mjs --no-scrape` (reused archives, called for both the
  current and prior week so trend badges are real); Google Reviews from
  `epg-google-reviews-dashboard/src/App.jsx`. No more `top_posts.js` step — it was a redundant
  live LinkedIn scrape whose output wasn't even being read.
- **Builds with `send_newsletter.build_html()`** (the branded "Elite Partners Group" dark/gold
  template) — NOT `send_weekly_newsletter.build_email()` (a plainer, older template). Calling the
  wrong one was the actual "design is wrong" bug.
- `membersReached` is now part of `weeklyData` rows (added by `epg-linkedin-weekly-update`,
  see that section above) and top-post `preview` text is now reliably populated
  (`linkedin_export.mjs`'s scrape-selector fix, also above) — the newsletter reads both straight
  off `App.jsx`.
- **No Instagram "Reach" stat** — removed, no real weekly source exists (Hootsuite's export has
  no Reach column; the retired parser used to silently copy Views into it).
- **`what_happened.json` (Brian's commentary) is never read by this initial build** — it can only
  hold a stale prior week's writeup at the time this runs. A separate, later, human-triggered
  step includes it.
- Deleted 4 dead one-off scripts from an earlier hand-patched send (`send_final_jul06.py` and
  3 siblings) — not git-tracked, nothing to purge from history.

Known but not fixed (low priority, doesn't block the build):
- `send_weekly_newsletter.py` / `send_newsletter.py` still fall back to a hardcoded plaintext
  SMTP password if `ECP_EMAIL_PASS` isn't set (it never is — `.env` uses a different variable
  name, `SMTP_PASS`, that these scripts don't read). Works today because the hardcoded fallback
  matches the live password.

## Open items

- [ ] Live-test `send_carla_email.js` end-to-end (real login, real send) — built 2026-07-16, unverified
- [ ] TV dashboard gets out of sync — consider a shared data source or a reminder to update both in the same session
- [ ] `weekly-data.json` outbound/activity section is stale (not updated since Jun 16)
- [ ] Clean up the Jun 28/Jun 29 duplicate rows in weeklyData
- [ ] Wire `send_weekly_newsletter.py`/`send_newsletter.py` to read `.env`'s `SMTP_PASS` instead of the hardcoded plaintext fallback
