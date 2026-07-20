"""
Monday Morning Routine — EPG Weekly Newsletter + Dashboard Update
Runs automatically every Monday at 9am via Windows Task Scheduler.

Order of operations:
  1. Pull Simplecast podcast data (API)
  2. Read LinkedIn weekly numbers + top posts from the live dashboard (src/App.jsx)
  3. Read Instagram + YouTube weekly numbers via instagram_report.mjs / youtube_report.mjs
     (--no-scrape — reuses each platform's own already-refreshed daily archive)
  4. Read Google Reviews rating from the live dashboard
  5. Build newsletter HTML with send_newsletter.build_html() (the branded template)
  6. Save to epg-exec-form, deploy Vercel
  7. Email Pablo with "Send to Brian" button, newsletter embedded for review
  8. Carla's LinkedIn engagement report (carla_report.js — separate script, separate email)

Note: this script does NOT scrape or parse raw platform exports itself — every
number comes from a platform's already-updated dashboard or its own canonical
report script. See [[feedback_newsletter_no_scraping]] if touching this file.
"""

import os, sys, subprocess, json, re
from datetime import datetime, timedelta
from pathlib import Path

SCRAPER_DIR = Path(__file__).parent
REPO_ROOT   = SCRAPER_DIR.parent

sys.path.insert(0, str(SCRAPER_DIR))

# Console codepage on Windows Task Scheduler runs is cp1252, which can't
# print characters like → or ★ used in a couple of log() calls below — that
# raised UnicodeEncodeError mid-try-block and got mislabeled as a data parse
# failure. Force UTF-8 stdout so a print never masquerades as a real error.
sys.stdout.reconfigure(encoding="utf-8")


def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


# ── 1. Compute week string ────────────────────────────────────────────────────

today          = datetime.now()
days_since_mon = today.weekday()                        # Mon=0
week_end       = today - timedelta(days=days_since_mon + 1)   # last Sunday
week_start     = week_end - timedelta(days=6)                  # prior Monday
WEEK_STR = f"{week_start.strftime('%b %#d')} – {week_end.strftime('%#d, %Y')}"
log(f"Week: {WEEK_STR}")


# ── 2. Pull Simplecast ────────────────────────────────────────────────────────

log("Fetching Simplecast data...")
import send_newsletter as nl
pod = nl.fetch_simplecast_stats(
    week_start=week_start.strftime("%Y-%m-%d"),
    week_end=week_end.strftime("%Y-%m-%d"),
)
log(f"  Podcast: {pod['downloads']} downloads")


# ── 3. Read LinkedIn from App.jsx (the live dashboard — source of truth) ──────
#
# (Previously this step also ran `top_posts.js --write` — a live LinkedIn
# browser scrape to fetch post preview text into weekly-data.json. Removed
# 2026-07-20: it's a second live scrape on top of the one epg-linkedin-
# weekly-update already did that morning, it wasn't reliably producing
# preview text anyway, and this script doesn't read weekly-data.json's
# topPosts — LinkedIn top posts come from App.jsx below, same as everything
# else LinkedIn.)
#
# weekly-data.json's linkedin.engagements/impressions/followers/history fields
# are NOT kept current: top_posts.js (step 2b above) only writes topPosts into
# that file. The actual weekly numbers are written to src/App.jsx's weeklyData
# array by the separate epg-linkedin-weekly-update scheduled task, so that's
# the only place with this week's real figures — read it directly, the same
# way send_carla_email.js does.

log("Reading LinkedIn data from App.jsx...")
app_jsx_path = REPO_ROOT / "src" / "App.jsx"
li = {"engagements": 0, "prev_engagements": 0, "impressions": 0,
      "prev_impressions": 0, "followers": 0, "total_followers": 0,
      "members_reached": 0, "prev_members_reached": 0,
      "month_total": 0, "top_posts": []}
if app_jsx_path.exists():
    app_jsx_text = app_jsx_path.read_text(encoding="utf-8")

    array_match = re.search(r"const weeklyData\s*=\s*\[([\s\S]*?)\n\];", app_jsx_text)
    if array_match:
        row_pattern = re.compile(
            r'week:\s*"([^"]+)",\s*engagements:\s*(\d+),\s*impressions:\s*(\d+),\s*posts:\s*(\d+)'
            r'(?:,\s*followers:\s*(\d+))?(?:,\s*membersReached:\s*(\d+))?'
        )
        rows = row_pattern.findall(array_match.group(1))
        if rows:
            last = rows[-1]
            li["engagements"]     = int(last[1])
            li["impressions"]     = int(last[2])
            li["followers"]       = int(last[4]) if last[4] else 0
            li["members_reached"] = int(last[5]) if last[5] else 0
            if len(rows) > 1:
                prev = rows[-2]
                li["prev_engagements"]     = int(prev[1])
                li["prev_impressions"]     = int(prev[2])
                li["prev_members_reached"] = int(prev[5]) if prev[5] else 0
        else:
            log("  WARNING: weeklyData array in App.jsx had no parseable rows")
    else:
        log("  WARNING: could not find weeklyData array in App.jsx")

    total_followers_match = re.search(r"TOTAL_FOLLOWERS\s*=\s*(\d+)", app_jsx_text)
    li["total_followers"] = int(total_followers_match.group(1)) if total_followers_match else li["followers"]

    monthly_match = re.search(r"const monthlyData\s*=\s*\[([\s\S]*?)\n\];", app_jsx_text)
    if monthly_match:
        month_pattern = re.compile(r'month:\s*"([^"]+)",\s*engagements:\s*(\d+)')
        month_rows = dict(month_pattern.findall(monthly_match.group(1)))
        li["month_total"] = int(month_rows.get(week_start.strftime("%b"), li["engagements"]))
    else:
        li["month_total"] = li["engagements"]

    top_posts_match = re.search(r"const topPosts\s*=\s*\[([\s\S]*?)\n\];", app_jsx_text)
    if top_posts_match:
        post_pattern = re.compile(
            r'date:\s*"([^"]+)",\s*engagements:\s*(\d+),\s*impressions:\s*(\d+),\s*format:\s*"[^"]*",\s*preview:\s*"((?:[^"\\]|\\.)*)"'
        )
        li["top_posts"] = [
            {"date": d, "engagements": int(e), "impressions": int(i), "preview": p.replace('\\"', '"')}
            for d, e, i, p in post_pattern.findall(top_posts_match.group(1))
        ]

    log(f"  LinkedIn: {li['engagements']} eng, {li['impressions']} impressions")
else:
    log("  WARNING: App.jsx not found — LinkedIn numbers will be 0")


# ── 4. Read Instagram + YouTube from the already-updated dashboards ──────────
#
# Do NOT re-parse raw Hootsuite exports here. instagram_report.mjs and
# youtube_report.mjs are the canonical scripts for exact weekly totals — they
# already handle Hootsuite reordering its Daily-vs-Overall columns between
# runs, and they archive each day's data so an exact week stays computable
# after a month boundary. --no-scrape reuses today's archive (already
# refreshed this morning by the epg-instagram/youtube-weekly-update tasks)
# instead of launching a second live browser scrape.

log("Reading Instagram + YouTube report scripts (--no-scrape)...")
start_str, end_str = week_start.strftime("%Y-%m-%d"), week_end.strftime("%Y-%m-%d")
prev_week_end = week_start - timedelta(days=1)
prev_week_start = prev_week_end - timedelta(days=6)
prev_start_str, prev_end_str = prev_week_start.strftime("%Y-%m-%d"), prev_week_end.strftime("%Y-%m-%d")

def run_report(script, start, end):
    result = subprocess.run(
        ["node", script, start, end, "--json", "--no-scrape"],
        cwd=str(SCRAPER_DIR), capture_output=True, text=True, encoding="utf-8",
        errors="replace", shell=True
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout)[-500:])
    return json.loads(result.stdout.strip().splitlines()[-1])

# build_html() falls back to hardcoded placeholder numbers (96 / 9700) for
# prev-week comparisons if we don't supply real ones — always fetch last
# week too (still --no-scrape, still just reading the archive) so a real
# week-over-week trend never gets silently replaced by a fake one.
ig = {"engagements": 0, "views": 0, "likes": 0, "shares": 0, "saves": 0, "top_posts": [],
      "prev_engagements": 0, "prev_views": 0}
try:
    ig_json = run_report("instagram_report.mjs", start_str, end_str)
    ig.update({
        "engagements": ig_json.get("engagement", 0),
        "views":       ig_json.get("views", 0),
        "likes":       ig_json.get("likes", 0),
        "shares":      ig_json.get("shares", 0),
        "saves":       ig_json.get("saves", 0),
        "top_posts":   ig_json.get("topPosts", []),
    })
    log(f"  Instagram: {ig['engagements']} eng, {ig['views']} views")
    try:
        ig_prev_json = run_report("instagram_report.mjs", prev_start_str, prev_end_str)
        ig["prev_engagements"] = ig_prev_json.get("engagement", 0)
        ig["prev_views"]       = ig_prev_json.get("views", 0)
    except Exception as e:
        log(f"  WARNING: could not read prior-week Instagram report: {e}")
except Exception as e:
    log(f"  WARNING: could not read Instagram report: {e}")

yt = {"views": 0, "subscribers": 0, "total_subs": 0, "engagements": 0, "prev_views": 0}
try:
    yt_json = run_report("youtube_report.mjs", start_str, end_str)
    yt.update({
        "views":       yt_json.get("views", 0),
        "subscribers": yt_json.get("subscribersGainedThisWeek", 0),
        "total_subs":  yt_json.get("subscribersTotal", 0),
        "engagements": yt_json.get("engagements", 0),
    })
    log(f"  YouTube: {yt['views']} views, +{yt['subscribers']} subs, total {yt['total_subs']}")
    try:
        yt_prev_json = run_report("youtube_report.mjs", prev_start_str, prev_end_str)
        yt["prev_views"] = yt_prev_json.get("views", 0)
    except Exception as e:
        log(f"  WARNING: could not read prior-week YouTube report: {e}")
except Exception as e:
    log(f"  WARNING: could not read YouTube report: {e}")

log("Reading Google Reviews...")
reviews = {"rating": "4.8", "count": "22"}
try:
    gr_app_jsx = (REPO_ROOT.parent / "epg-google-reviews-dashboard" / "src" / "App.jsx").read_text(encoding="utf-8")
    rating_match = re.search(r"const currentRating\s*=\s*([\d.]+)", gr_app_jsx)
    count_match  = re.search(r"const totalReviews\s*=\s*(\d+)", gr_app_jsx)
    if rating_match and count_match:
        reviews = {"rating": rating_match.group(1), "count": count_match.group(1)}
        log(f"  Google Reviews: {reviews['rating']}★, {reviews['count']} reviews")
    else:
        log("  WARNING: could not find rating/count in epg-google-reviews-dashboard/src/App.jsx — using last-known fallback")
except Exception as e:
    log(f"  WARNING: could not read Google Reviews dashboard: {e} — using last-known fallback")


# ── 5. Adapt data to send_newsletter.build_html()'s expected shape ────────────
#
# build_html is the branded "Elite Partners Group" template — the one Pablo
# actually reviews and sends out. It wants a couple of fields in a different
# shape than what the dashboards/report scripts hand back above.

li_for_html = dict(li)

# epg-linkedin-weekly-update now saves membersReached into App.jsx's
# weeklyData rows directly (fixed 2026-07-20) — that's the normal path
# going forward. Rows written before that fix won't have it, so fall back
# to reading it out of that week's epg\log\ entry (linkedin_report.js always
# computed it, it just wasn't being persisted anywhere structured yet).
if not li_for_html.get("members_reached"):
    log_path = REPO_ROOT.parent / "epg" / "log" / f"{week_start.year}-W-{week_start.strftime('%b').lower()}{week_start.strftime('%d')}-{week_end.strftime('%d')}.md"
    if log_path.exists():
        m = re.search(r"Members reached:\s*\*{0,2}([\d,]+)\*{0,2}", log_path.read_text(encoding="utf-8"))
        if m:
            li_for_html["members_reached"] = int(m.group(1).replace(",", ""))
            log(f"  Members reached (from {log_path.name}): {li_for_html['members_reached']:,}")
        else:
            log(f"  WARNING: {log_path.name} exists but has no 'Members reached' line")
    else:
        log(f"  WARNING: {log_path.name} not found — members_reached will show 0")

ig_for_html = dict(ig)
ig_for_html.setdefault("reach", 0)                 # not tracked by instagram_report.mjs's summary
ig_for_html.setdefault("prev_reach", 0)
ig_for_html["top_posts"] = [
    {"Post Message": p.get("caption", ""), "Likes": p.get("likes", 0), "Post Permalink": "#"}
    for p in ig.get("top_posts", [])[:3]
]

# "What Happened This Week" is Brian's own commentary, submitted only AFTER
# he's seen this week's numbers (Pablo → Brian → his form → what_happened.json).
# At the time this initial build runs, Brian hasn't seen this week's newsletter
# yet, so there is no current commentary — what_happened.json at this point can
# only hold a stale prior week's writeup. Always build Pablo's first-look
# newsletter with the empty "waiting for your commentary" state; a later,
# separate re-send (after Brian submits) is what actually includes his notes.
what_happened = []


# ── 6. Build HTML + save + deploy + email Pablo ───────────────────────────────

from send_weekly_newsletter import send, USERNAME

log("Building newsletter HTML...")
html = nl.build_html(ig_for_html, yt, li_for_html, pod, WEEK_STR, what_happened=what_happened)

# Save to epg-exec-form
form_repo    = REPO_ROOT.parent / "epg-exec-form"
current_path = form_repo / "newsletter-current.html"
current_path.write_text(html, encoding="utf-8")
log(f"Saved to {current_path}")

# Deploy epg-exec-form
log("Deploying epg-exec-form...")
result = subprocess.run(
    ["npx", "vercel@latest", "deploy", "--prod", "--yes"],
    cwd=str(form_repo), capture_output=True, text=True, encoding="utf-8", errors="replace", shell=True
)
if result.returncode == 0:
    log("  Deployed successfully.")
else:
    log(f"  Deploy warning: {result.stderr[-200:]}")

# Email Pablo with Send-to-Brian button, followed by the actual newsletter to review
body_match = re.search(r"<body[^>]*>(.*)</body>", html, re.DOTALL)
newsletter_body = body_match.group(1) if body_match else html

pablo_html = f"""<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;"><tr><td align="center" style="padding:24px 16px 0;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#0a0f1e;border-radius:16px;overflow:hidden;">
  <tr><td style="padding:24px 28px;">
    <p style="margin:0 0 6px;font-size:18px;font-weight:bold;color:#f0f6fc;font-family:Arial,sans-serif;">Weekly Newsletter — Ready</p>
    <p style="margin:0 0 18px;font-family:monospace;font-size:11px;color:#8892a4;">{WEEK_STR} &nbsp;&middot;&nbsp; Review below, then send to Brian</p>
    <a href="https://epg-exec-form.vercel.app/api/send-to-brian" style="display:inline-block;background:#c9a84c;color:#0a0f1e;font-family:monospace;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:12px 28px;border-radius:8px;">Send to Brian &rarr;</a>
  </td></tr>
</table>
</td></tr></table>
{newsletter_body}
</body></html>"""

send(USERNAME, f"[ACTION NEEDED] Newsletter ready — {WEEK_STR}", pablo_html)
log(f"Email sent to Pablo.")

# Note: Carla's LinkedIn engagement report is NOT sent from here — it's owned
# entirely by the separate `epg-carla-report-weekly` scheduled task, which reads
# the dashboard independently. Sending it from both places would double-email her.

log("Done.")
