# EPG LinkedIn / Marketing Dashboard

React/Vite app. Start sessions from this folder so this context loads automatically.

- **Local:** `C:\Users\ECP\epg-marketing-dashboard\`
- **GitHub:** acostapabloEC/epg-marketing-dashboard
- **Vercel:** epg-marketing-dashboard.vercel.app ✓ auto-deploy on push
- **Password:** Elite2026

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
   - **Carla Wade** (carlawade@eliteconsultingpartners.com) — engagement-only summary (no impressions/posts/followers, by design). As of 2026-07-16: `node send_carla_email.js --send` in `scraper/` reads this week's row straight out of `src/App.jsx` (no re-scrape — the update above already put it there) and emails Carla. Built and preview-tested but not yet live-sent or scheduled — see `C:\Users\ECP\carla\CLAUDE.md` for details.
   - **John Schreppler** — fully automated as of 2026-07-15: the `epg-john-report-weekly` scheduled task (Mondays ~9:26am, ~18 min after this LinkedIn task) reads the freshly-updated `weeklyData` row above and sends John's email + Teams DM itself. Nothing to do here manually. Scripts live in `C:\Users\ECP\epg-marketing-dashboard\john_report\` (moved from `frank\john_report\`); the old `1 - PREVIEW.bat` / `2 - SEND TO JOHN.bat` still work for an ad-hoc resend if ever needed.

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
