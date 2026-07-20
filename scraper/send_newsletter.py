"""
EPG Weekly Newsletter — Automation Script
Runs every Tuesday. Reads Hootsuite CSVs from local ZIP files,
computes weekly totals, and sends the HTML newsletter.

Data sources:
  - Instagram & YouTube : Hootsuite weekly CSV exports (saved to scraper/data/)
  - LinkedIn            : weekly-data.json (written by index.js scraper)
  - Podcast (Simplecast): Simplecast REST API
"""

import smtplib, ssl, zipfile, csv, io, urllib.request, re, os, sys, json, subprocess
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# Guard win32com — only used in legacy Outlook path, not in the main pipeline
try:
    import win32com.client
    _HAS_WIN32 = True
except ImportError:
    _HAS_WIN32 = False

# ── Credentials ────────────────────────────────────────────────────────────────
SMTP_SERVER   = "smtp.office365.com"
PORT_SMTP     = 587
USERNAME      = "Pabloacosta@eliteconsultingpartners.com"
PASSWORD      = os.environ.get("ECP_EMAIL_PASS", "Datamagic26$")
HOOTSUITE_ZIP_PASS = os.environ.get("HOOTSUITE_PASS", "SebastianFabian2026!").encode()

# ── Recipients ─────────────────────────────────────────────────────────────────
# Pablo is first — receives it before it reaches the rest of the list.
# Add Frank and Brian's emails below once confirmed.
SEND_TO = [
    "pabloacosta@eliteconsultingpartners.com",
    "JohnSchreppler@eliteconsultingpartners.com",
    "frank@eliteconsultingpartners.com",
    "brianlutz@eliteconsultingpartners.com",
    # "FrankLaRosa@eliteconsultingpartners.com",   # ← add Frank's email here
    # "Brian@eliteconsultingpartners.com",          # ← add Brian's email here
]

# Q2 LinkedIn goal
LI_QUARTERLY_GOAL = 2250
LI_WEEKLY_GOAL    = 187

DASHBOARD_URL       = "https://elite-landing-eta.vercel.app/"
LINKEDIN_URL        = "https://epg-marketing-dashboard.vercel.app/"
INSTAGRAM_URL       = "https://epg-instagram-dashboard.vercel.app/"
YOUTUBE_URL         = "https://epg-youtube-dashboard.vercel.app/"
PODCAST_URL         = "https://epg-simplecast-podcast.vercel.app/"


# ── Outlook COM: find latest Hootsuite export email (legacy path) ─────────────
def find_hootsuite_csv_url(report_keyword: str):
    if not _HAS_WIN32:
        return None
    outlook = win32com.client.Dispatch("Outlook.Application").GetNamespace("MAPI")
    inbox   = outlook.GetDefaultFolder(6)
    messages = inbox.Items
    messages.Sort("[ReceivedTime]", True)
    cutoff = datetime.now() - timedelta(days=8)
    best_msg, best_date = None, None
    for msg in messages:
        try:
            received = msg.ReceivedTime.replace(tzinfo=None)
        except Exception:
            continue
        if received < cutoff:
            break
        try:
            sender  = msg.SenderEmailAddress.lower()
            subject = msg.Subject.lower()
        except Exception:
            continue
        if "hootsuite" not in sender:
            continue
        if report_keyword.lower() not in subject:
            continue
        if best_date is None or received > best_date:
            best_date = received
            best_msg  = msg
    if best_msg is None:
        return None
    body = best_msg.HTMLBody or best_msg.Body
    urls = re.findall(r'href="(https://url\d+\.reports\.hootsuite\.com/[^"]+)"', body)
    return urls[0] if urls else None


# ── Download + decrypt ZIP → dict of {filename: csv_text} ─────────────────────
def download_and_decrypt(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r:
        raw = r.read()
    buf = io.BytesIO(raw)
    result = {}
    with zipfile.ZipFile(buf) as zf:
        for name in zf.namelist():
            data = zf.read(name, pwd=HOOTSUITE_ZIP_PASS)
            result[name] = data.decode("utf-8-sig", errors="replace")
    return result


# ── Parse Instagram metrics ────────────────────────────────────────────────────
def parse_instagram(csvs: dict, week_start: str = None, week_end: str = None) -> dict:
    acct = next(v for k, v in csvs.items() if "account_metrics" in k)
    posts_csv = next((v for k, v in csvs.items() if "ig_posts_table" in k), None)

    rows = list(csv.DictReader(io.StringIO(acct)))
    if week_start and week_end:
        rows = [r for r in rows if week_start <= r.get("Date (GMT)", "")[:10] <= week_end]
    eng_key   = next((k for k in rows[0] if "Post engagement ("  in k and "Daily" in k), None) if rows else None
    views_key = next((k for k in rows[0] if "Post views ("       in k and "Daily" in k), None) if rows else None

    total_eng   = sum(float(r.get(eng_key,   0) or 0) for r in rows) if eng_key   else 0
    total_reach = sum(float(r.get(views_key, 0) or 0) for r in rows) if views_key else 0

    # Top posts: use posts_table filtered to the week, sorted by engagement
    top_rows = []
    if posts_csv:
        all_posts = list(csv.DictReader(io.StringIO(posts_csv)))
        if week_start and week_end:
            all_posts = [r for r in all_posts if week_start <= r.get("Date (GMT)", "")[:10] <= week_end]
        all_posts.sort(key=lambda r: float(r.get("Engagement", 0) or 0), reverse=True)
        top_rows = all_posts[:3]

    return {
        "engagements": int(total_eng),
        "reach":       int(total_reach),
        "followers":   0,
        "top_posts":   top_rows,
    }


# ── Parse YouTube metrics ──────────────────────────────────────────────────────
def parse_youtube(csvs: dict, week_start: str = None, week_end: str = None) -> dict:
    acct = next(v for k, v in csvs.items() if "account_metrics" in k)
    top  = next((v for k, v in csvs.items() if "top_posts"       in k), None)
    posts_csv = next((v for k, v in csvs.items() if "posts_table" in k), None)

    all_rows = list(csv.DictReader(io.StringIO(acct)))
    rows = [r for r in all_rows if week_start <= r.get("Date (GMT)", "")[:10] <= week_end] if (week_start and week_end) else all_rows
    views_key = next((k for k in all_rows[0] if "video view" in k.lower() and "Daily" in k), None) if all_rows else None
    if not views_key:
        views_key = next((k for k in all_rows[0] if "page views" in k.lower() and "Daily" in k), None) if all_rows else None
    # "gained" = net new this week (single aggregate value, last non-empty row)
    gained_key    = next((k for k in all_rows[0] if "subscriber" in k.lower() and "gained" in k.lower()), None) if all_rows else None
    # "Daily aggregated" = daily snapshots of total — use last row for current total
    daily_subs_key = next((k for k in all_rows[0] if "subscriber" in k.lower() and "daily" in k.lower() and "gained" not in k.lower()), None) if all_rows else None

    total_views  = int(sum(float(r.get(views_key, 0) or 0) for r in rows)) if views_key else 0

    # Net new subs = end-of-week total minus start-of-week total (from daily snapshot column)
    if daily_subs_key and rows:
        total_subs = int(float(rows[-1].get(daily_subs_key, 0) or 0))
        first_val  = next((float(r.get(daily_subs_key, 0) or 0) for r in rows if r.get(daily_subs_key, "")), 0)
        net_new_subs = total_subs - int(first_val)
    else:
        total_subs   = 0
        net_new_subs = 0

    all_post_rows = list(csv.DictReader(io.StringIO(posts_csv))) if posts_csv else []
    post_rows = [r for r in all_post_rows if week_start <= r.get("Date (GMT)", "")[:10] <= week_end] if (week_start and week_end) else all_post_rows
    total_likes    = sum(int(float(r.get("Likes","0")    or 0)) for r in post_rows)
    total_comments = sum(int(float(r.get("Comments","0") or 0)) for r in post_rows)
    total_shares   = sum(int(float(r.get("Shares","0")   or 0)) for r in post_rows)
    engagements = total_likes + total_comments + total_shares

    top_rows = sorted(post_rows, key=lambda r: int(float(r.get("Likes","0") or 0)) + int(float(r.get("Comments","0") or 0)) + int(float(r.get("Shares","0") or 0)), reverse=True)[:3] if post_rows else []

    return {
        "views":        total_views,
        "engagements":  engagements,
        "subscribers":  net_new_subs,   # net new this week
        "total_subs":   total_subs,     # cumulative total (latest value)
        "top_posts":    top_rows[:3],
    }


# ── Format helpers ─────────────────────────────────────────────────────────────
def fmt_num(n) -> str:
    n = int(n or 0)
    if n >= 1000:
        return f"{n/1000:.1f}K"
    return str(n)

def fmt_pct(curr, prev) -> str:
    curr, prev = int(curr or 0), int(prev or 0)
    if prev == 0:
        return ""
    pct = ((curr - prev) / prev) * 100
    arrow = "&#8593;" if pct >= 0 else "&#8595;"
    color = "#3fb950" if pct >= 0 else "#f85149"
    return f'<span style="color:{color};font-size:11px">{arrow} {abs(pct):.0f}%</span>'


# ── Executive Summary ──────────────────────────────────────────────────────────
def build_exec_summary(li_eng, li_prev, li_imp, li_imp_prev,
                       ig_eng, ig_prev, ig_views,
                       yt_views, yt_views_prev,
                       pod_dl, pod_prev, episodes) -> str:

    def pct(curr, prev):
        return ((curr - prev) / prev * 100) if prev else None

    def badge(d):
        if d is None: return ""
        return f"&#8593; +{abs(d):.0f}%" if d >= 0 else f"&#8595; {d:.0f}%"

    def badge_color(d):
        if d is None: return "#8892a4"
        return "#3fb950" if d >= 0 else "#f85149"

    li_d  = pct(li_imp, li_imp_prev)
    ig_d  = pct(ig_eng, ig_prev)
    yt_d  = pct(yt_views, yt_views_prev)
    pod_d = pct(pod_dl, pod_prev)

    positives = sum(1 for d in [li_d, ig_d, yt_d, pod_d] if d is not None and d > 0)
    if positives >= 3:
        tone     = "Strong week across all channels."
        tone_col = "#3fb950"
    elif positives >= 2:
        tone     = "Mixed signals this week — highlights below."
        tone_col = "#c9a84c"
    else:
        tone     = "Quiet week — engagement held steady."
        tone_col = "#8892a4"

    top_ep   = episodes[0] if episodes else None
    pod_note = ""
    if top_ep:
        title    = (top_ep.get("title") or "")[:48]
        pod_note = f"<br><span style='font-size:12px;color:#8892a4'>Top ep: <em>\"{title}…\"</em> &mdash; {top_ep.get('downloads', 0)} dl</span>"

    platform_colors = {
        "LinkedIn":  "#5ba3f5",
        "Instagram": "#e1306c",
        "YouTube":   "#ff4444",
        "Podcast":   "#a855f7",
    }
    platform_urls = {
        "LinkedIn":  LINKEDIN_URL,
        "Instagram": INSTAGRAM_URL,
        "YouTube":   YOUTUBE_URL,
        "Podcast":   PODCAST_URL,
    }

    rows = [
        ("LinkedIn",  f"{li_eng:,} engagements &nbsp;&middot;&nbsp; {li_imp:,} impressions", li_d),
        ("Instagram", f"{ig_eng:,} engagements &nbsp;&middot;&nbsp; {ig_views:,} views",     ig_d),
        ("YouTube",   f"{yt_views:,} views",                                                  yt_d),
        ("Podcast",   f"{pod_dl:,} downloads{pod_note}",                                      pod_d),
    ]

    rows_html = ""
    for platform, text, d in rows:
        col = platform_colors[platform]
        url = platform_urls[platform]
        rows_html += f"""
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #1e2a3a;vertical-align:middle">
          <table width="100%"><tbody><tr>
            <td style="width:90px;vertical-align:top;padding-top:2px">
              <a href="{url}" style="font-family:monospace;font-size:11px;font-weight:700;color:{col};letter-spacing:1.5px;text-transform:uppercase;text-decoration:none">{platform}</a>
            </td>
            <td style="padding-left:12px;vertical-align:middle">
              <span style="font-size:14px;color:#f0f6fc;line-height:1.6">{text}</span>
            </td>
            <td style="width:72px;text-align:right;vertical-align:top;padding-top:2px;white-space:nowrap">
              <span style="font-family:monospace;font-size:13px;font-weight:700;color:{badge_color(d)}">{badge(d)}</span>
            </td>
          </tr></tbody></table>
        </td>
      </tr>"""

    return f"""<tr><td>
<table width="100%" style="border:1px solid rgba(201,168,76,0.4);border-radius:12px;overflow:hidden"><tbody>
  <tr><td style="background:linear-gradient(90deg,#c9a84c,#e8c96a);height:4px"></td></tr>
  <tr><td style="background:#111827;padding:18px 24px 16px;border-bottom:1px solid #1e2a3a">
    <table width="100%"><tbody><tr>
      <td><span style="font-family:monospace;font-size:13px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#c9a84c">Week in Review</span></td>
      <td align="right"><span style="font-family:monospace;font-size:11px;color:#8892a4">Executive Summary</span></td>
    </tr></tbody></table>
  </td></tr>
  <tr><td style="background:#0d1117;padding:16px 24px 6px">
    <div style="font-size:15px;font-weight:700;color:{tone_col};margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #1e2a3a">{tone}</div>
    <table width="100%"><tbody>{rows_html}
    </tbody></table>
  </td></tr>
</tbody></table>
</td></tr>
<tr><td style="height:16px;background:#0a0f1e"></td></tr>"""


# ── Build HTML ─────────────────────────────────────────────────────────────────
EXEC_FORM_URL = "https://epg-exec-form.vercel.app"

def build_what_happened(items: list) -> str:
    """items = [{"platform": "Podcast", "metric": "1,062 downloads (+252%)", "body": "..."}]"""
    if not items:
        return f"""<tr><td>
<table width="100%" style="border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden"><tbody>
  <tr><td style="background:linear-gradient(90deg,#1a2235,#0d1117);height:4px"></td></tr>
  <tr><td style="background:#111827;padding:18px 24px 16px;border-bottom:1px solid #1e2a3a">
    <span style="font-family:monospace;font-size:13px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#f0f6fc">What Happened This Week</span>
  </td></tr>
  <tr><td style="background:#0d1117;padding:28px 24px;text-align:center">
    <div style="font-size:14px;color:#8892a4;margin-bottom:16px;line-height:1.7">This section is waiting for your commentary.<br>Fill out the form below and it will be included in the next send.</div>
    <a href="{EXEC_FORM_URL}" style="display:inline-block;background:#c9a84c;color:#0a0f1e;font-family:monospace;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:13px 32px;border-radius:8px">&#8594; &nbsp;Add Your Commentary</a>
  </td></tr>
</tbody></table>
</td></tr>
<tr><td style="height:16px;background:#0a0f1e"></td></tr>"""

    PLATFORM_COLORS = {
        "Podcast":   "#a855f7",
        "LinkedIn":  "#5ba3f5",
        "Instagram": "#e1306c",
        "YouTube":   "#ff4444",
        "Google":    "#3fb950",
    }

    rows_html = ""
    for item in items:
        col = PLATFORM_COLORS.get(item.get("platform", ""), "#c9a84c")
        rows_html += f"""
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #1e2a3a;vertical-align:top">
          <div style="margin-bottom:5px">
            <span style="font-family:monospace;font-size:11px;font-weight:700;color:{col};letter-spacing:1px;text-transform:uppercase">{item.get("platform","")}</span>
            <span style="font-family:monospace;font-size:11px;color:#c9a84c;margin-left:10px">{item.get("metric","")}</span>
          </div>
          <div style="font-size:13px;color:#d0dae8;line-height:1.65">{item.get("body","")}</div>
        </td>
      </tr>"""

    return f"""<tr><td>
<table width="100%" style="border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden"><tbody>
  <tr><td style="background:linear-gradient(90deg,#1a2235,#0d1117);height:4px"></td></tr>
  <tr><td style="background:#111827;padding:18px 24px 16px;border-bottom:1px solid #1e2a3a">
    <table width="100%"><tbody><tr>
      <td><span style="font-family:monospace;font-size:13px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#f0f6fc">What Happened This Week</span></td>
      <td style="text-align:right"><span style="font-size:11px;color:#8892a4;font-style:italic">by Brian Lutz</span></td>
    </tr></tbody></table>
  </td></tr>
  <tr><td style="background:#0d1117;padding:6px 24px 10px">
    <table width="100%"><tbody>{rows_html}
    </tbody></table>
  </td></tr>
</tbody></table>
</td></tr>
<tr><td style="height:16px;background:#0a0f1e"></td></tr>"""


def build_html(ig: dict, yt: dict, li: dict, pod: dict, week_str: str, what_happened: list = None) -> str:
    li_eng        = int(li.get("engagements", 0))
    li_prev       = int(li.get("prev_engagements", 0))
    li_imp        = int(li.get("impressions", 0))
    li_imp_prev   = int(li.get("prev_impressions", 0))
    li_reach      = int(li.get("members_reached", 0))
    li_reach_prev = int(li.get("prev_members_reached", 0))
    li_followers  = int(li.get("followers", 0))
    li_goal_pct   = round((li_eng / LI_WEEKLY_GOAL) * 100) if LI_WEEKLY_GOAL else 0
    li_goal_bar   = min(li_goal_pct, 100)
    li_needed     = max(0, LI_WEEKLY_GOAL - li_eng)
    li_top_posts  = li.get("top_posts", [])

    ig_eng        = int(ig.get("engagements", 0))
    ig_prev       = int(ig.get("prev_engagements", 96))
    ig_views      = int(ig.get("views", 0))
    ig_views_prev = int(ig.get("prev_views", 0))

    yt_views      = int(yt.get("views", 0))
    yt_views_prev = int(yt.get("prev_views", 9700))
    yt_subs       = int(yt.get("subscribers", 0))    # net new this week
    yt_total_subs = int(yt.get("total_subs", 0))     # cumulative total
    yt_eng        = int(yt.get("engagements", 0))

    pod_dl   = int(pod.get("downloads", 0))
    pod_prev = int(pod.get("prev_downloads", 0))

    # ── Episode rows ──────────────────────────────────────────────────────────
    def ep_row(ep):
        return f"""
        <tr><td style="background:#111827;padding:12px 16px;border-top:1px solid #1e2a3a">
          <table width="100%"><tbody><tr>
            <td style="vertical-align:middle">
              <div style="font-family:monospace;font-size:9px;color:#8892a4;margin-bottom:4px">{ep.get('ep','')}</div>
              <div style="font-size:13px;color:#f0f6fc;line-height:1.45">{ep.get('title','')}</div>
            </td>
            <td style="white-space:nowrap;padding-left:16px;vertical-align:middle;text-align:right">
              <div style="font-size:26px;font-weight:700;color:#a855f7;line-height:1">{ep.get('downloads','—')}</div>
              <div style="font-family:monospace;font-size:9px;color:#8892a4">downloads</div>
            </td>
          </tr></tbody></table>
        </td></tr>"""

    # ── Instagram top post rows ───────────────────────────────────────────────
    def ig_post_row(r, rank):
        msg  = (r.get("Post Message", "") or "")[:80] + "…"
        likes = r.get("Likes", "0")
        url   = r.get("Post Permalink", "#")
        bg    = "#1a1208" if rank == 1 else "#111827"
        sep   = "border-top:1px solid #1e2a3a;" if rank > 1 else ""
        return f"""
        <tr><td style="background:{bg};padding:10px 16px;{sep}">
          <table><tbody><tr>
            <td style="vertical-align:top;padding-top:2px;color:#c9a84c;font-size:11px;white-space:nowrap">#{rank}</td>
            <td style="padding-left:8px">
              <a href="{url}" style="font-size:13px;text-decoration:none;line-height:1.5;display:block;margin-bottom:4px"><span style="color:#f0f6fc !important">{msg}</span></a>
              <div style="font-family:monospace;font-size:10px;color:#8892a4">{likes} likes</div>
            </td>
          </tr></tbody></table>
        </td></tr>"""

    ig_posts_html = "".join(ig_post_row(r, i+1) for i, r in enumerate(ig.get("top_posts", [])[:3]))
    if not ig_posts_html:
        ig_posts_html = '<tr><td style="background:#111827;padding:12px 16px;color:#3a4a5a;font-size:11px;font-family:monospace">No post data available this week</td></tr>'

    # ── LinkedIn top post rows ────────────────────────────────────────────────
    def li_post_row(p, rank):
        text  = (p.get("preview", p.get("text", p.get("Post Message", ""))) or "")[:100] + "…"
        eng   = p.get("reactions", p.get("engagements", p.get("Likes", "—")))
        url   = p.get("url", p.get("Post Permalink", "#"))
        bg    = "#0a1628" if rank == 1 else "#111827"
        sep   = "border-top:1px solid #1e2a3a;" if rank > 1 else ""
        return f"""
        <tr><td style="background:{bg};padding:10px 16px;{sep}">
          <table><tbody><tr>
            <td style="vertical-align:top;padding-top:2px;color:#5ba3f5;font-size:11px;white-space:nowrap">#{rank}</td>
            <td style="padding-left:8px">
              <a href="{url}" style="font-size:13px;text-decoration:none;line-height:1.5;display:block;margin-bottom:4px"><span style="color:#f0f6fc !important">{text}</span></a>
              <div style="font-family:monospace;font-size:10px;color:#8892a4">{eng} engagements</div>
            </td>
          </tr></tbody></table>
        </td></tr>"""

    li_posts_html = "".join(li_post_row(p, i+1) for i, p in enumerate(li_top_posts[:3]))
    if not li_posts_html:
        li_posts_html = '<tr><td style="background:#111827;padding:12px 16px;color:#3a4a5a;font-size:11px;font-family:monospace">No post data this week — export LinkedIn content report to populate.</td></tr>'

    # ── Goal bar color (red if behind, gold if on track, green if ahead) ─────
    bar_color = "#3fb950" if li_goal_pct >= 100 else ("#c9a84c" if li_goal_pct >= 60 else "#f85149")
    needed_color = "#3fb950" if li_needed == 0 else "#c9a84c"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Weekly Marketing Performance Report</title>
  <style>
    @media only screen and (max-width: 620px) {{
      .email-body  {{ padding: 12px 6px !important; }}
      .email-wrap  {{ width: 100% !important; }}
      .stat-col    {{ display: block !important; width: 100% !important; text-align: center !important; padding: 14px 20px !important; border-top: 1px solid #1e2a3a !important; }}
      .stat-div    {{ display: none !important; width: 0 !important; }}
      .nav-left    {{ display: none !important; }}
      .hero-num    {{ font-size: 30px !important; }}
      .cta-block   {{ padding: 20px 16px !important; }}
      .cta-btn     {{ padding: 13px 24px !important; font-size: 13px !important; }}
      .hdr-right   {{ display: none !important; }}
    }}
  </style>
</head>
<body style="margin:0;padding:0;background:#f0f2f5">
<table width="100%" class="email-body" style="background:#f0f2f5;padding:24px 16px"><tbody><tr><td align="center">
<table class="email-wrap" style="max-width:600px;width:100%;background:#0a0f1e;border-radius:16px;overflow:hidden"><tbody>

<!-- ═══════════════════════════════ HEADER ═══════════════════════════════ -->
<tr><td style="background:#111827;border-radius:12px 12px 0 0;border:1px solid #1e2a3a;border-bottom:none;padding:20px 28px 18px">
  <table width="100%"><tbody><tr>
    <td>
      <div style="font-size:16px;font-weight:700;color:#f0f6fc;font-family:Arial,sans-serif;letter-spacing:-.2px">Elite Partners Group</div>
      <div style="font-family:monospace;font-size:10px;color:#8892a4;letter-spacing:1.5px;text-transform:uppercase;margin-top:4px">Frank LaRosa &middot; Weekly Marketing Performance</div>
    </td>
    <td align="right" class="hdr-right">
      <div style="background:#1e2a3a;border:1px solid rgba(201,168,76,0.25);border-radius:6px;padding:6px 14px;display:inline-block">
        <div style="font-family:monospace;font-size:9px;color:#8892a4;letter-spacing:2px;text-transform:uppercase">Week of</div>
        <div style="font-family:monospace;font-size:12px;font-weight:600;color:#c9a84c;margin-top:3px">{week_str}</div>
      </div>
    </td>
  </tr></tbody></table>
</td></tr>

<!-- ═══════════════════════════════ NAV BAR ══════════════════════════════ -->
<tr><td style="background:#0d1117;padding:10px 28px;border-left:1px solid #1e2a3a;border-right:1px solid #1e2a3a">
  <table width="100%"><tbody><tr>
    <td class="nav-left"></td>
    <td align="right"><a href="{DASHBOARD_URL}" style="font-family:monospace;font-size:10px;font-weight:600;color:#c9a84c;text-decoration:none">&#8594; View Live Dashboard</a></td>
  </tr></tbody></table>
</td></tr>
<tr><td style="height:16px;background:#0a0f1e"></td></tr>

<!-- ═══════════════════════════ DASHBOARD CTA ════════════════════════════ -->
<tr><td>
  <table width="100%" style="border-radius:12px;overflow:hidden;border:2px solid rgba(201,168,76,0.4)"><tbody>
    <tr><td style="background:linear-gradient(135deg,#1a1208 0%,#252010 100%)" class="cta-block" align="center" style="padding:28px 32px;text-align:center">
      <div style="font-family:monospace;font-size:9px;color:#8892a4;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px">Elite Consulting Partners</div>
      <div style="font-size:20px;font-weight:700;color:#c9a84c;font-family:Arial,sans-serif;margin-bottom:8px">Marketing Performance Dashboard</div>
      <div style="font-size:12px;color:#8892a4;margin-bottom:20px;line-height:1.6">Live view of all channels &mdash; LinkedIn &middot; Instagram &middot; YouTube &middot; Podcast &middot; Google Reviews</div>
      <a href="{DASHBOARD_URL}" class="cta-btn" style="display:inline-block;background:#c9a84c;color:#0a0f1e;font-family:monospace;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:14px 36px;border-radius:8px">&#8594; &nbsp;VIEW DASHBOARD</a>
    </td></tr>
  </tbody></table>
</td></tr>
<tr><td style="height:16px;background:#0a0f1e"></td></tr>

<!-- ══════════════════════════ EXECUTIVE SUMMARY ════════════════════════ -->
{build_exec_summary(li_eng, li_prev, li_imp, li_imp_prev, ig_eng, ig_prev, ig_views, yt_views, yt_views_prev, pod_dl, pod_prev, pod.get("episodes", []))}

<!-- ══════════════════════════ WHAT HAPPENED ════════════════════════════ -->
{build_what_happened(what_happened or [])}

<!-- ═══════════════════════════════ LINKEDIN ═════════════════════════════ -->
<tr><td>
<table width="100%" style="border:1px solid #1e2a3a;border-radius:12px;overflow:hidden"><tbody>
  <tr><td style="background:#0a66c2;height:3px"></td></tr>
  <!-- Section header -->
  <tr><td style="background:#111827;padding:16px 24px 12px;border-bottom:1px solid #1e2a3a">
    <table width="100%"><tbody><tr>
      <td><a href="{LINKEDIN_URL}" style="font-family:monospace;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#5ba3f5;text-decoration:none">LinkedIn &middot; Frank LaRosa</a></td>
      <td align="right"><div style="font-family:monospace;font-size:10px;color:#8892a4">Last 7 days</div></td>
    </tr></tbody></table>
  </td></tr>
  <!-- Hero engagement number -->
  <tr><td style="background:#111827;padding:20px 24px 18px;text-align:center;border-bottom:1px solid #1e2a3a">
    <div style="font-family:monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#8892a4;margin-bottom:10px">Total Engagements This Week</div>
    <div class="hero-num" style="font-size:40px;font-weight:700;color:#f0f6fc;line-height:1">{li_eng} &nbsp;{fmt_pct(li_eng, li_prev)}</div>
    <div style="font-family:monospace;font-size:10px;color:#8892a4;margin-top:10px">vs {li_prev} last week</div>
  </td></tr>
  <!-- Q2 Goal progress bar -->
  <tr><td style="background:#111827;padding:14px 24px;border-bottom:1px solid #1e2a3a">
    <div style="background:#0d1117;border:1px solid rgba(201,168,76,0.2);border-radius:8px;padding:12px 16px">
      <table width="100%"><tbody><tr>
        <td style="font-family:monospace;font-size:10px;color:#8892a4">Q2 Weekly Goal</td>
        <td align="right" style="font-family:monospace;font-size:10px;color:#c9a84c">{li_eng} / {LI_WEEKLY_GOAL} &nbsp;({li_goal_pct}%)</td>
      </tr></tbody></table>
      <table width="100%" style="margin-top:8px;border-radius:3px;overflow:hidden"><tbody><tr>
        <td style="width:{li_goal_bar}%;background:{bar_color};height:5px;font-size:0;line-height:0">&nbsp;</td>
        <td style="background:#1e2a3a;height:5px;font-size:0;line-height:0">&nbsp;</td>
      </tr></tbody></table>
    </div>
  </td></tr>
  <!-- Stats row (responsive: stacks on mobile) -->
  <tr><td style="background:#111827;border-bottom:1px solid #1e2a3a;padding:0">
    <table width="100%"><tbody><tr>
      <td class="stat-col" style="text-align:center;padding:16px 8px;vertical-align:top">
        <div style="font-family:monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8892a4;margin-bottom:6px">Impressions</div>
        <div style="font-size:26px;font-weight:700;color:#f0f6fc;line-height:1;margin-bottom:6px">{fmt_num(li_imp)}</div>
        {fmt_pct(li_imp, li_imp_prev)}
      </td>
      <td class="stat-div" style="background:#1e2a3a;width:1px;font-size:0;line-height:0">&nbsp;</td>
      <td class="stat-col" style="text-align:center;padding:16px 8px;vertical-align:top">
        <div style="font-family:monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8892a4;margin-bottom:6px">Members Reached</div>
        <div style="font-size:26px;font-weight:700;color:#f0f6fc;line-height:1;margin-bottom:6px">{fmt_num(li_reach)}</div>
        {fmt_pct(li_reach, li_reach_prev)}
      </td>
      <td class="stat-div" style="background:#1e2a3a;width:1px;font-size:0;line-height:0">&nbsp;</td>
      <td class="stat-col" style="text-align:center;padding:16px 8px;vertical-align:top">
        <div style="font-family:monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8892a4;margin-bottom:6px">New Followers</div>
        <div style="font-size:26px;font-weight:700;color:#f0f6fc;line-height:1;margin-bottom:6px">+{li_followers}</div>
      </td>
    </tr></tbody></table>
  </td></tr>
  <!-- LinkedIn top posts -->
  <tr><td style="background:#111827;padding:16px 24px 20px">
    <div style="font-family:monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#8892a4;margin-bottom:10px">Top Posts This Week</div>
    <table width="100%" style="border:1px solid #1e2a3a;border-radius:8px;overflow:hidden"><tbody>
      {li_posts_html}
    </tbody></table>
  </td></tr>
</tbody></table>
</td></tr>
<tr><td style="height:16px;background:#0a0f1e"></td></tr>

<!-- ═══════════════════════════════ PODCAST ══════════════════════════════ -->
<tr><td>
<table width="100%" style="border:1px solid #1e2a3a;border-radius:12px;overflow:hidden"><tbody>
  <tr><td style="background:#a855f7;height:3px"></td></tr>
  <tr><td style="background:#111827;padding:16px 24px 12px;border-bottom:1px solid #1e2a3a">
    <table width="100%"><tbody><tr>
      <td><a href="{PODCAST_URL}" style="font-family:monospace;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#a855f7;text-decoration:none">Advisor Talk &middot; Simplecast</a></td>
      <td align="right"><div style="font-family:monospace;font-size:10px;color:#8892a4">Last 7 days</div></td>
    </tr></tbody></table>
  </td></tr>
  <tr><td style="background:#111827;padding:20px 24px 18px;text-align:center;border-bottom:1px solid #1e2a3a">
    <div style="font-family:monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#8892a4;margin-bottom:10px">Total Downloads This Week</div>
    <div class="hero-num" style="font-size:40px;font-weight:700;color:#f0f6fc;line-height:1">{pod_dl} &nbsp;{fmt_pct(pod_dl, pod_prev)}</div>
    <div style="font-family:monospace;font-size:10px;color:#8892a4;margin-top:10px">vs {pod_prev} last week</div>
  </td></tr>
  <tr><td style="background:#111827;padding:16px 24px 20px">
    <div style="font-family:monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#8892a4;margin-bottom:10px">Recent Episodes</div>
    <table width="100%" style="border:1px solid #1e2a3a;border-radius:8px;overflow:hidden"><tbody>
      {"".join(ep_row(ep) for ep in pod.get("episodes", []))}
    </tbody></table>
  </td></tr>
</tbody></table>
</td></tr>
<tr><td style="height:16px;background:#0a0f1e"></td></tr>

<!-- ═══════════════════════════════ INSTAGRAM ════════════════════════════ -->
<tr><td>
<table width="100%" style="border:1px solid #1e2a3a;border-radius:12px;overflow:hidden"><tbody>
  <tr><td style="background:#e1306c;height:3px"></td></tr>
  <tr><td style="background:#111827;padding:16px 24px 12px;border-bottom:1px solid #1e2a3a">
    <table width="100%"><tbody><tr>
      <td><a href="{INSTAGRAM_URL}" style="font-family:monospace;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#e1306c;text-decoration:none">Instagram &middot; @franklarosa.elite</a></td>
      <td align="right"><div style="font-family:monospace;font-size:10px;color:#8892a4">Last 7 days</div></td>
    </tr></tbody></table>
  </td></tr>
  <!-- Stats row -->
  <tr><td style="background:#111827;border-bottom:1px solid #1e2a3a;padding:0">
    <table width="100%"><tbody><tr>
      <td class="stat-col" style="text-align:center;padding:16px 8px;vertical-align:top">
        <div style="font-family:monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8892a4;margin-bottom:6px">Engagements</div>
        <div style="font-size:26px;font-weight:700;color:#f0f6fc;line-height:1;margin-bottom:6px">{ig_eng}</div>
        {fmt_pct(ig_eng, ig_prev)}
        <div style="font-family:monospace;font-size:9px;color:#8892a4;margin-top:4px">vs {ig_prev} last week</div>
      </td>
      <td class="stat-div" style="background:#1e2a3a;width:1px;font-size:0;line-height:0">&nbsp;</td>
      <td class="stat-col" style="text-align:center;padding:16px 8px;vertical-align:top">
        <div style="font-family:monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8892a4;margin-bottom:6px">Views</div>
        <div style="font-size:26px;font-weight:700;color:#f0f6fc;line-height:1;margin-bottom:6px">{fmt_num(ig_views)}</div>
        {fmt_pct(ig_views, ig_views_prev)}
        <div style="font-family:monospace;font-size:9px;color:#8892a4;margin-top:4px">vs {fmt_num(ig_views_prev)} last week</div>
      </td>
    </tr></tbody></table>
  </td></tr>
  <!-- Instagram top posts -->
  <tr><td style="background:#111827;padding:16px 24px 20px">
    <div style="font-family:monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#8892a4;margin-bottom:10px">Top Posts This Week</div>
    <table width="100%" style="border:1px solid #1e2a3a;border-radius:8px;overflow:hidden"><tbody>
      {ig_posts_html}
    </tbody></table>
  </td></tr>
</tbody></table>
</td></tr>
<tr><td style="height:16px;background:#0a0f1e"></td></tr>

<!-- ═══════════════════════════════ YOUTUBE ══════════════════════════════ -->
<tr><td>
<table width="100%" style="border:1px solid #1e2a3a;border-radius:12px;overflow:hidden"><tbody>
  <tr><td style="background:#ff0000;height:3px"></td></tr>
  <tr><td style="background:#111827;padding:16px 24px 12px;border-bottom:1px solid #1e2a3a">
    <table width="100%"><tbody><tr>
      <td><a href="{YOUTUBE_URL}" style="font-family:monospace;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#ff4444;text-decoration:none">YouTube &middot; Advisor Talk</a></td>
      <td align="right"><div style="font-family:monospace;font-size:10px;color:#8892a4">Last 7 days</div></td>
    </tr></tbody></table>
  </td></tr>
  <!-- Stats row -->
  <tr><td style="background:#111827;padding:0">
    <table width="100%"><tbody><tr>
      <td class="stat-col" style="text-align:center;padding:16px 8px;vertical-align:top">
        <div style="font-family:monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8892a4;margin-bottom:6px">Views</div>
        <div style="font-size:26px;font-weight:700;color:#f0f6fc;line-height:1;margin-bottom:6px">{fmt_num(yt_views)}</div>
        {fmt_pct(yt_views, yt_views_prev)}
        <div style="font-family:monospace;font-size:9px;color:#8892a4;margin-top:4px">vs {fmt_num(yt_views_prev)} last week</div>
      </td>
      <td class="stat-div" style="background:#1e2a3a;width:1px;font-size:0;line-height:0">&nbsp;</td>
      <td class="stat-col" style="text-align:center;padding:16px 8px;vertical-align:top">
        <div style="font-family:monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8892a4;margin-bottom:6px">Engagements</div>
        <div style="font-size:26px;font-weight:700;color:#f0f6fc;line-height:1;margin-bottom:6px">{yt_eng:,}</div>
      </td>
      <td class="stat-div" style="background:#1e2a3a;width:1px;font-size:0;line-height:0">&nbsp;</td>
      <td class="stat-col" style="text-align:center;padding:16px 8px;vertical-align:top">
        <div style="font-family:monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8892a4;margin-bottom:6px">New Subscribers</div>
        <div style="font-size:26px;font-weight:700;color:#f0f6fc;line-height:1;margin-bottom:4px">+{yt_subs:,}</div>
        <div style="font-family:monospace;font-size:10px;color:#8892a4">{yt_total_subs:,} total</div>
      </td>
    </tr></tbody></table>
  </td></tr>
</tbody></table>
</td></tr>
<tr><td style="height:16px;background:#0a0f1e"></td></tr>

<!-- ═══════════════════════════════ CTA REPEAT ═══════════════════════════ -->
<tr><td align="center" style="padding-bottom:4px">
  <a href="{DASHBOARD_URL}" style="display:inline-block;background:#c9a84c;color:#0a0f1e;font-family:monospace;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:13px 32px;border-radius:8px">&#8594; &nbsp;OPEN LIVE DASHBOARD</a>
</td></tr>

<!-- ═══════════════════════════════ FOOTER ═══════════════════════════════ -->
<tr><td style="background:#111827;border-radius:0 0 12px 12px;border:1px solid #1e2a3a;border-top:none;padding:14px 28px;margin-top:4px">
  <table width="100%"><tbody><tr>
    <td>
      <div style="font-family:monospace;font-size:9px;color:#8892a4">Elite Partners Group &middot; Frank LaRosa &middot; Weekly Marketing Report</div>
    </td>
    <td align="right" class="hdr-right">
      <div style="font-family:monospace;font-size:9px;color:#c9a84c">LinkedIn Goal: {LI_WEEKLY_GOAL} eng/wk</div>
      <div style="font-family:monospace;font-size:9px;color:#8892a4;margin-top:3px">Q2 Target: {LI_QUARTERLY_GOAL:,} total</div>
    </td>
  </tr></tbody></table>
</td></tr>

</tbody></table>
</td></tr></tbody></table>
</body></html>"""


# ── Send email ─────────────────────────────────────────────────────────────────
def send_email(subject: str, html: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = USERNAME
    msg["To"]      = ", ".join(SEND_TO)
    msg.attach(MIMEText(html, "html", "utf-8"))

    ctx = ssl.create_default_context()
    with smtplib.SMTP(SMTP_SERVER, PORT_SMTP) as server:
        server.ehlo()
        server.starttls(context=ctx)
        server.ehlo()
        server.login(USERNAME, PASSWORD)
        server.sendmail(USERNAME, SEND_TO, msg.as_string())
    print(f"  Sent to: {', '.join(SEND_TO)}")


# ── Simplecast API ────────────────────────────────────────────────────────────
SIMPLECAST_API_KEY = os.environ.get("SIMPLECAST_API_KEY",
    "eyJhcGlfa2V5IjoiMzVmMTFkM2I5YTY2MmE1YWMxZDM5YjNjYjE0M2ZhMTcifQ==")
SIMPLECAST_PODCAST_ID = "2636c469-8b34-4ec7-8457-71f1b27ee304"

def _sc_get(path: str) -> dict:
    url = f"https://api.simplecast.com{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {SIMPLECAST_API_KEY}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())

def fetch_simplecast_stats(week_start: str = None, week_end: str = None) -> dict:
    if week_start and week_end:
        start_date = week_start
        end_date   = (datetime.strptime(week_end, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        prev_end   = week_start
        prev_start = (datetime.strptime(week_start, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
    else:
        end_date   = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")   # +1 because API end_date is exclusive
        start_date = (datetime.now() - timedelta(days=6)).strftime("%Y-%m-%d")   # 7 days inclusive (matches Simplecast UI)
        prev_end   = datetime.now().strftime("%Y-%m-%d")                          # exclusive = through yesterday
        prev_start = (datetime.now() - timedelta(days=13)).strftime("%Y-%m-%d")  # prior 7-day window

    try:
        this_week = _sc_get(f"/analytics/downloads?podcast={SIMPLECAST_PODCAST_ID}"
                            f"&start_date={start_date}&end_date={end_date}").get("total", 0)
        last_week = _sc_get(f"/analytics/downloads?podcast={SIMPLECAST_PODCAST_ID}"
                            f"&start_date={prev_start}&end_date={prev_end}").get("total", 0)
        ep_data = _sc_get(f"/podcasts/{SIMPLECAST_PODCAST_ID}/episodes?limit=5&status=published")
        episodes = []
        for ep in ep_data.get("collection", [])[:3]:
            ep_id  = ep["id"]
            ep_num = ep.get("number", "?")
            title  = ep.get("title", "")
            pub    = ep.get("published_at", "")[:10]
            try:
                pub_fmt = datetime.strptime(pub, "%Y-%m-%d").strftime("%b %-d")
            except Exception:
                try:
                    pub_fmt = datetime.strptime(pub, "%Y-%m-%d").strftime("%b %d").lstrip("0")
                except Exception:
                    pub_fmt = pub
            dl = _sc_get(f"/analytics/downloads?episode={ep_id}"
                         f"&start_date={start_date}&end_date={end_date}").get("total", 0)
            episodes.append({"ep": f"Ep {ep_num} · {pub_fmt}", "title": title, "downloads": dl})
        return {"downloads": this_week, "prev_downloads": last_week, "episodes": episodes}
    except Exception as e:
        print(f"  Simplecast error: {e}")
        return {"downloads": 0, "prev_downloads": 0, "episodes": []}


# ── LinkedIn Playwright scraper (called from main() only) ─────────────────────
SCRAPER_DIR = os.path.dirname(os.path.abspath(__file__))

def fetch_linkedin_stats() -> dict:
    result = subprocess.run(
        ["node", "index.js"],
        cwd=SCRAPER_DIR,
        capture_output=True, text=True, timeout=180,
        env={**os.environ, "HEADLESS": "true"}
    )
    if result.returncode != 0:
        print(f"  LinkedIn scraper stderr: {result.stderr[:400]}")
        return _li_fallback()
    try:
        data_file = os.path.join(SCRAPER_DIR, '..', 'src', 'data', 'weekly-data.json')
        if os.path.exists(data_file):
            with open(data_file, encoding='utf-8') as f:
                data = json.load(f)
            li = data.get('linkedin', {})
            return {
                "engagements":          li.get('engagements',    {}).get('current',  0),
                "prev_engagements":     li.get('engagements',    {}).get('previous', 0),
                "impressions":          li.get('impressions',    {}).get('current',  0),
                "prev_impressions":     li.get('impressions',    {}).get('previous', 0),
                "members_reached":      li.get('membersReached', {}).get('current',  0),
                "prev_members_reached": li.get('membersReached', {}).get('previous', 0),
                "followers":            li.get('followers',      {}).get('gained',   0),
                "top_posts":            li.get('topPosts', []),
            }
        raise FileNotFoundError("weekly-data.json not found")
    except Exception as e:
        print(f"  LinkedIn data parse error: {e}")
        return _li_fallback()

def _li_fallback() -> dict:
    print("  Using last-known LinkedIn values")
    return {
        "engagements": 36, "prev_engagements": 26,
        "impressions": 3900, "prev_impressions": 2900,
        "members_reached": 1200, "prev_members_reached": 900,
        "followers": 0, "top_posts": [],
    }


# ── Main (standalone mode) ────────────────────────────────────────────────────
def main():
    week_str = datetime.now().strftime("%b %d, %Y")
    print(f"Building newsletter for week of {week_str}...")

    print("  Fetching Instagram export...")
    ig_url = find_hootsuite_csv_url("instagram engagement")
    if ig_url:
        ig_csvs = download_and_decrypt(ig_url)
        ig = parse_instagram(ig_csvs)
    else:
        print("  No Instagram export found — using last known values")
        ig = {"engagements": 47, "reach": 5000, "followers": 0, "top_posts": []}
    ig.setdefault("prev_engagements", 96)
    ig.setdefault("prev_reach", 12200)

    print("  Fetching YouTube export...")
    yt_url = find_hootsuite_csv_url("youtube overview")
    if yt_url:
        yt_csvs = download_and_decrypt(yt_url)
        yt = parse_youtube(yt_csvs)
    else:
        print("  No YouTube export found — using last known values")
        yt = {"views": 5400, "engagements": 1731, "subscribers": 444, "top_posts": []}
    yt.setdefault("prev_views", 9700)

    print("  Running LinkedIn scraper...")
    li = fetch_linkedin_stats()

    print("  Fetching Simplecast data...")
    pod = fetch_simplecast_stats()

    subject = f"Weekly Marketing Performance Report — {week_str}"
    html = build_html(ig, yt, li, pod, week_str)
    send_email(subject, html)


if __name__ == "__main__":
    main()
