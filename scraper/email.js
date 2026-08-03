import nodemailer from 'nodemailer';
import dns from 'node:dns';
import { promisify } from 'node:util';

const dnsLookup = promisify(dns.lookup);

// Nodemailer resolves its SMTP host with its own dns.Resolver (raw UDP/c-ares queries),
// which times out on networks where that path is blocked even though the OS resolver
// (dns.lookup, same as `nslookup`) works fine. Resolve via dns.lookup ourselves and hand
// nodemailer the IP directly, with `servername` set so TLS still validates the real hostname.
async function createTransport(host, port) {
  const { address } = await dnsLookup(host);
  return nodemailer.createTransport({
    host: address,
    port,
    secure: false,
    tls: { servername: host },
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// Carla Wade gets engagement numbers ONLY — no impressions, posts, or followers.
// Pablo has repeatedly insisted this stays scoped; don't add other metrics here.
// As of 2026-07-20 the report shows a daily breakdown (not just the weekly total) and
// links to the live dashboard, per Pablo's explicit format request.
export async function sendCarlaEmail({ engagement, startDate, endDate, daily, cc }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
  if (!SMTP_USER || !SMTP_PASS) throw new Error('Missing SMTP_USER or SMTP_PASS in .env');

  const transporter = await createTransport(SMTP_HOST || 'smtp.office365.com', parseInt(SMTP_PORT || '587'));

  const rangeLabel = `${formatShortDate(startDate)}–${formatShortDate(endDate)}`;
  const longRangeLabel = `${formatLongDate(startDate)} – ${formatLongDate(endDate)}`;
  const dailyLines = (daily || [])
    .map(d => `* ${formatShortDate(d.date)}: ${d.engagements.toLocaleString()}`)
    .join('\n');

  const text = `Hi Carla,\n\n` +
    `Here is the LinkedIn Engagement total for the week of ${longRangeLabel}: ${engagement.toLocaleString()} engagements\n\n` +
    `Daily breakdown:\n\n${dailyLines}\n\n` +
    `The LinkedIn Dashboard has been updated and is live here: https://epg-marketing-dashboard.vercel.app/\n\n` +
    `Best,\nEPG Marketing`;

  await transporter.sendMail({
    from: EMAIL_FROM || `EPG Marketing <${SMTP_USER}>`,
    to: 'carlawade@eliteconsultingpartners.com',
    ...(cc ? { cc } : {}),
    subject: `Frank LaRosa LinkedIn Engagement — ${rangeLabel}`,
    text,
  });
}

function formatLongDate(isoDateStr) {
  const d = new Date(isoDateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatShortDate(isoDateStr) {
  const d = new Date(isoDateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export async function sendNewsletterEmail(data) {
  const { EMAIL_TO, EMAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) throw new Error('Missing SMTP_USER or SMTP_PASS in .env');

  const transporter = await createTransport(SMTP_HOST || 'smtp.office365.com', parseInt(SMTP_PORT || '587'));

  await transporter.sendMail({
    from: EMAIL_FROM || `EPG Marketing <${SMTP_USER}>`,
    to: EMAIL_TO || 'pabloacosta@eliteconsultingpartners.com',
    subject: `EPG Weekly Report — ${data.weekOf}`,
    html: buildHtml(data),
  });
}

// ─── Color palette (mirrors the dashboard exactly) ───────────────────────────
const BG      = '#0a0f1e';
const SURFACE = '#111827';
const BORDER  = '#1e2a3a';
const GOLD    = '#c9a84c';
const GOLD_D  = '#252010';
const GREEN   = '#3fb950';
const GREEN_D = '#162a1a';
const RED     = '#f85149';
const RED_D   = '#2d1518';
const BLUE    = '#58a6ff';
const PURPLE  = '#a855f7';
const MUTED   = '#8892a4';
const TEXT    = '#f0f6fc';
const TEXT2   = '#a0aab4';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badge(pct, large = false) {
  if (!pct) return '';
  const up = pct > 0;
  return `<span style="display:inline-block;background:${up ? GREEN_D : RED_D};color:${up ? GREEN : RED};font-size:${large ? '13px' : '11px'};font-weight:700;padding:${large ? '5px 13px' : '3px 9px'};border-radius:20px;font-family:'DM Mono',Courier New,monospace;">${up ? '&#8593;' : '&#8595;'} ${Math.abs(pct)}%</span>`;
}

function statCol(label, value, pct, note) {
  return `
    <td style="text-align:center;padding:16px 8px;vertical-align:top;">
      <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};margin-bottom:6px;">${label}</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:26px;font-weight:700;color:${TEXT};line-height:1;margin-bottom:6px;">${value}</div>
      ${pct ? badge(pct) : ''}
      ${note ? `<div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;color:${MUTED};margin-top:4px;">${note}</div>` : ''}
    </td>`;
}

function colDivider() {
  return `<td width="1" style="background:${BORDER};font-size:0;line-height:0;">&nbsp;</td>`;
}

function cardAccent(color) {
  return `<tr><td height="3" bgcolor="${color}" style="background:${color};font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

function cardHeader(platformLabel, platformColor) {
  return `
    <tr>
      <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:16px 24px 12px;border-bottom:1px solid ${BORDER};">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><div style="font-family:'DM Mono',Courier New,monospace;font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${platformColor};">${platformLabel}</div></td>
          <td align="right"><div style="font-family:'DM Mono',Courier New,monospace;font-size:10px;color:${MUTED};">Last 7 days</div></td>
        </tr></table>
      </td>
    </tr>`;
}

function unavailableRow(name, color) {
  return `
    <tr>
      <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:22px 24px;text-align:center;">
        <div style="font-family:'DM Mono',Courier New,monospace;font-size:10px;letter-spacing:1px;color:${MUTED};">
          No <span style="color:${color};">${name}</span> report found &mdash; drop the Hootsuite CSV into
          <code style="background:${BORDER};color:${TEXT2};padding:2px 6px;border-radius:4px;">scraper/reports/</code> by Monday evening
        </div>
      </td>
    </tr>`;
}

function formatK(n) {
  if (!n) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Section spacer between cards ────────────────────────────────────────────
function spacer() {
  return `<tr><td height="16" style="font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

// ─── Main HTML builder ────────────────────────────────────────────────────────

function buildHtml(data) {
  const li  = data.linkedin  || {};
  const pod = data.podcast   || {};
  const ig  = data.instagram || {};
  const yt  = data.youtube   || {};

  const eng     = li.engagements || { current: 0, pct: 0, previous: 0 };
  const goalPct = Math.min(Math.round((eng.current / (li.weeklyGoal || 187)) * 100), 100);
  const goalColor = goalPct >= 100 ? GREEN : goalPct >= 70 ? GOLD : RED;
  const goalText  = goalPct >= 100
    ? 'Goal reached this week!'
    : goalPct >= 70
      ? `On track &mdash; ${(li.weeklyGoal || 187) - eng.current} more to hit goal`
      : `${(li.weeklyGoal || 187) - eng.current} more engagements needed`;

  // ── Top posts ──────────────────────────────────────────────────────────────
  const topPostsRows = (li.topPosts || []).length > 0
    ? li.topPosts.map((p, i) => `
      <tr>
        <td bgcolor="${i === 0 ? GOLD_D : SURFACE}" style="background:${i === 0 ? GOLD_D : SURFACE};padding:10px 16px;${i > 0 ? `border-top:1px solid ${BORDER};` : ''}">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="22" style="vertical-align:top;padding-top:2px;">
              <span style="font-family:'DM Mono',Courier New,monospace;font-size:11px;font-weight:700;color:${i === 0 ? GOLD : BORDER};">#${i + 1}</span>
            </td>
            <td style="padding-left:6px;">
              <div style="font-size:12px;color:${TEXT};line-height:1.5;margin-bottom:4px;">${(p.preview || '').slice(0, 120)}${(p.preview || '').length > 120 ? '&hellip;' : ''}</div>
              <div style="font-family:'DM Mono',Courier New,monospace;font-size:10px;color:${MUTED};">
                ${(p.reactions || 0) > 0 ? `<span style="color:${GOLD};font-weight:700;">${p.reactions} reactions</span>&nbsp;&nbsp;` : ''}
                ${(p.impressions || 0) > 0 ? `${p.impressions.toLocaleString()} impressions` : ''}
              </div>
            </td>
            <td align="right" width="36" style="vertical-align:middle;padding-left:8px;">
              <span style="font-family:'DM Mono',Courier New,monospace;font-size:15px;font-weight:700;color:${i === 0 ? GOLD : GREEN};">${p.reactions || 0}</span>
            </td>
          </tr></table>
        </td>
      </tr>`).join('')
    : `<tr><td bgcolor="${SURFACE}" style="background:${SURFACE};padding:14px 16px;"><span style="font-size:12px;color:${MUTED};font-style:italic;">No post data captured this week.</span></td></tr>`;

  // ── Episode rows ───────────────────────────────────────────────────────────
  const episodeRows = (pod.episodes || []).map((ep, i) => `
    <tr>
      <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:12px 16px;${i > 0 ? `border-top:1px solid ${BORDER};` : ''}">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;">
            <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;letter-spacing:1px;color:${MUTED};margin-bottom:4px;">Ep ${ep.number || ''} &middot; ${fmtDate(ep.publishedAt)}</div>
            <div style="font-size:13px;color:${TEXT};line-height:1.45;">${ep.title || ''}</div>
          </td>
          <td align="right" style="white-space:nowrap;padding-left:16px;vertical-align:middle;">
            <div style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:700;color:${PURPLE};line-height:1;">${ep.weekDownloads || 0}</div>
            <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;color:${MUTED};text-align:right;margin-top:2px;">downloads</div>
          </td>
        </tr></table>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>EPG Weekly Marketing Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background:${BG};">

<table width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background:${BG};padding:24px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

  <!-- ════ HEADER ══════════════════════════════════════════════════════════ -->
  <tr>
    <td bgcolor="${SURFACE}" style="background:${SURFACE};border-radius:12px 12px 0 0;border:1px solid ${BORDER};border-bottom:none;padding:20px 28px 18px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td width="40" height="40" bgcolor="${GOLD}" style="background:${GOLD};border-radius:8px;text-align:center;vertical-align:middle;">
              <span style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:700;color:${BG};display:block;line-height:40px;">E</span>
            </td>
            <td style="padding-left:12px;vertical-align:middle;">
              <div style="font-size:15px;font-weight:600;color:${TEXT};letter-spacing:-0.01em;font-family:Arial,sans-serif;">Elite Partners Group &mdash; Marketing Performance</div>
              <div style="font-family:'DM Mono',Courier New,monospace;font-size:10px;color:${MUTED};letter-spacing:1.5px;text-transform:uppercase;margin-top:3px;">Frank LaRosa &middot; Weekly Report</div>
            </td>
          </tr></table>
        </td>
        <td align="right" style="vertical-align:middle;">
          <div style="display:inline-block;background:${GOLD_D};border:1px solid rgba(201,168,76,0.25);border-radius:6px;padding:6px 14px;">
            <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${GOLD};">Week of</div>
            <div style="font-family:'DM Mono',Courier New,monospace;font-size:12px;font-weight:600;color:${GOLD};margin-top:3px;">${data.weekOf}</div>
          </div>
        </td>
      </tr></table>
    </td>
  </tr>
  <tr><td height="1" bgcolor="${BORDER}" style="background:${BORDER};font-size:0;line-height:0;">&nbsp;</td></tr>
  <!-- Landing page link bar -->
  <tr>
    <td bgcolor="${GOLD_D}" style="background:${GOLD_D};padding:10px 28px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><span style="font-family:'DM Mono',Courier New,monospace;font-size:10px;color:${MUTED};">Elite Consulting Partners</span></td>
        <td align="right">
          <a href="https://elite-landing-eta.vercel.app/" style="font-family:'DM Mono',Courier New,monospace;font-size:10px;font-weight:600;color:${GOLD};text-decoration:none;letter-spacing:1px;">&#8594; View Marketing Dashboard</a>
        </td>
      </tr></table>
    </td>
  </tr>
  <tr><td height="16" bgcolor="${BG}" style="background:${BG};font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- ════ LINKEDIN ════════════════════════════════════════════════════════ -->
  <tr>
    <td>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">

        ${cardAccent('#0a66c2')}
        ${cardHeader('LinkedIn &middot; Frank LaRosa', '#5ba3f5')}

        <!-- Engagement hero -->
        <tr>
          <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:20px 24px 18px;text-align:center;border-bottom:1px solid ${BORDER};">
            <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};margin-bottom:12px;">Total Engagements This Week</div>
            <div style="line-height:1;">
              <span style="font-family:'Playfair Display',Georgia,serif;font-size:64px;font-weight:700;color:${TEXT};letter-spacing:-3px;line-height:1;">${eng.current.toLocaleString()}</span>
              &nbsp;${badge(eng.pct, true)}
            </div>
            ${eng.previous > 0 ? `<div style="font-family:'DM Mono',Courier New,monospace;font-size:10px;color:${MUTED};margin-top:10px;">vs ${eng.previous.toLocaleString()} last week</div>` : ''}
          </td>
        </tr>

        <!-- Goal progress -->
        <tr>
          <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:16px 24px;border-bottom:1px solid ${BORDER};">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:${GOLD_D};border:1px solid rgba(201,168,76,0.2);border-radius:8px;overflow:hidden;">
              <tr>
                <td style="padding:12px 16px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td><span style="font-family:'DM Mono',Courier New,monospace;font-size:10px;font-weight:600;color:${GOLD};text-transform:uppercase;letter-spacing:1px;">Q2 Weekly Goal</span></td>
                      <td align="right">
                        <span style="font-family:'DM Mono',Courier New,monospace;font-size:13px;font-weight:700;color:${goalColor};">${eng.current} / ${li.weeklyGoal || 187}</span>
                        <span style="font-family:'DM Mono',Courier New,monospace;font-size:10px;color:${MUTED};margin-left:4px;">(${goalPct}%)</span>
                      </td>
                    </tr>
                  </table>
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-radius:3px;overflow:hidden;">
                    <tr>
                      ${goalPct > 0 ? `<td width="${goalPct}%" height="6" bgcolor="${goalColor}" style="background:${goalColor};font-size:0;line-height:0;">&nbsp;</td>` : ''}
                      ${goalPct < 100 ? `<td height="6" bgcolor="${BORDER}" style="background:${BORDER};font-size:0;line-height:0;">&nbsp;</td>` : ''}
                    </tr>
                  </table>
                  <div style="font-family:'DM Mono',Courier New,monospace;font-size:10px;color:${goalColor};margin-top:6px;">${goalText}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Supporting metrics -->
        <tr>
          <td bgcolor="${SURFACE}" style="background:${SURFACE};border-bottom:1px solid ${BORDER};padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              ${statCol('Impressions', formatK(li.impressions?.current), li.impressions?.pct)}
              ${colDivider()}
              ${statCol('Members Reached', formatK(li.membersReached?.current), li.membersReached?.pct)}
              ${colDivider()}
              ${statCol('New Followers', `+${li.followers?.gained || 0}`, null, `${(li.followers?.total || 0).toLocaleString()} total`)}
              ${colDivider()}
              ${statCol('Posts', li.posts || '&mdash;', null, 'this week')}
            </tr></table>
          </td>
        </tr>

        <!-- Top posts -->
        <tr>
          <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:16px 24px 20px;">
            <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};margin-bottom:10px;">Top Posts This Week</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
              ${topPostsRows}
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>

  ${spacer()}

  <!-- ════ PODCAST ══════════════════════════════════════════════════════════ -->
  <tr>
    <td>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">

        ${cardAccent(PURPLE)}
        ${cardHeader('Advisor Talk &middot; Simplecast', PURPLE)}

        <!-- Downloads hero -->
        <tr>
          <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:20px 24px 18px;text-align:center;border-bottom:1px solid ${BORDER};">
            <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};margin-bottom:12px;">Total Downloads This Week</div>
            <div style="line-height:1;">
              <span style="font-family:'Playfair Display',Georgia,serif;font-size:56px;font-weight:700;color:${TEXT};letter-spacing:-2px;line-height:1;">${(pod.downloads?.current || 0).toLocaleString()}</span>
              &nbsp;${badge(pod.downloads?.pct, true)}
            </div>
            ${(pod.downloads?.previous || 0) > 0 ? `<div style="font-family:'DM Mono',Courier New,monospace;font-size:10px;color:${MUTED};margin-top:10px;">vs ${pod.downloads.previous.toLocaleString()} last week</div>` : ''}
          </td>
        </tr>

        <!-- Episodes -->
        <tr>
          <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:16px 24px 20px;">
            <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};margin-bottom:10px;">Recent Episodes</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
              ${episodeRows || `<tr><td bgcolor="${SURFACE}" style="background:${SURFACE};padding:14px 16px;"><span style="font-size:12px;color:${MUTED};font-style:italic;">No episode data available.</span></td></tr>`}
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>

  ${spacer()}

  <!-- ════ INSTAGRAM ════════════════════════════════════════════════════════ -->
  <tr>
    <td>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">

        ${cardAccent('#e1306c')}
        ${cardHeader('Instagram &middot; Hootsuite Export', '#e1306c')}

        ${ig.available ? `
        <tr>
          <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:0;border-top:1px solid ${BORDER};">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              ${statCol('Engagements', (ig.engagements?.current || 0).toLocaleString(), ig.engagements?.pct, ig.engagements?.previous ? `vs ${ig.engagements.previous.toLocaleString()} last week` : '')}
              ${colDivider()}
              ${statCol('Reach', formatK(ig.reach?.current), ig.reach?.pct, ig.reach?.previous ? `vs ${formatK(ig.reach.previous)} last week` : '')}
              ${colDivider()}
              ${statCol('Followers', `+${ig.followers?.current || 0}`, ig.followers?.pct, ig.followers?.previous ? `vs +${ig.followers.previous} last week` : '')}
            </tr></table>
          </td>
        </tr>` : unavailableRow('Instagram', '#e1306c')}

      </table>
    </td>
  </tr>

  ${spacer()}

  <!-- ════ YOUTUBE ═════════════════════════════════════════════════════════ -->
  <tr>
    <td>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">

        ${cardAccent('#ff0000')}
        ${cardHeader('YouTube &middot; Hootsuite Export', '#ff4444')}

        ${yt.available ? `
        <tr>
          <td bgcolor="${SURFACE}" style="background:${SURFACE};padding:0;border-top:1px solid ${BORDER};">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              ${statCol('Views', formatK(yt.views?.current), yt.views?.pct, yt.views?.previous ? `vs ${formatK(yt.views.previous)} last week` : '')}
              ${colDivider()}
              ${statCol('Engagements', (yt.engagements?.current || 0).toLocaleString(), yt.engagements?.pct, yt.engagements?.previous ? `vs ${yt.engagements.previous.toLocaleString()} last week` : '')}
              ${colDivider()}
              ${statCol('Subscribers', `+${yt.subscribers?.current || 0}`, yt.subscribers?.pct, yt.subscribers?.previous ? `vs +${yt.subscribers.previous} last week` : '')}
            </tr></table>
          </td>
        </tr>` : unavailableRow('YouTube', '#ff4444')}

      </table>
    </td>
  </tr>

  <!-- ════ FOOTER ══════════════════════════════════════════════════════════ -->
  <tr>
    <td height="1" bgcolor="${BORDER}" style="background:${BORDER};margin-top:24px;font-size:0;line-height:0;">&nbsp;</td>
  </tr>
  <tr>
    <td bgcolor="${SURFACE}" style="background:${SURFACE};border-radius:0 0 12px 12px;border:1px solid ${BORDER};border-top:none;padding:14px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;">
          <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;color:${MUTED};">Elite Partners Group &middot; Marketing Dashboard &middot; Frank LaRosa LinkedIn</div>
          <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;color:${BORDER};margin-top:3px;">Auto-generated Tuesday 11 AM Buenos Aires</div>
        </td>
        <td align="right" style="vertical-align:middle;">
          <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;color:${GOLD};">LinkedIn Goal: 187 eng/week</div>
          <div style="font-family:'DM Mono',Courier New,monospace;font-size:9px;color:${MUTED};margin-top:3px;">Q2 Target: 2,250 total</div>
        </td>
      </tr></table>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}
