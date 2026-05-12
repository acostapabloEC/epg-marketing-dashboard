import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, 'reports');

export function readHootsuiteReports() {
  const instagram = readPlatformReport('instagram');
  const youtube   = readPlatformReport('youtube');
  return { instagram, youtube };
}

function readPlatformReport(platform) {
  const empty = { available: false };
  if (!fs.existsSync(REPORTS_DIR)) return empty;

  // Accept both ZIP and CSV/XLSX
  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.toLowerCase().includes(platform) && f.match(/\.(csv|xlsx?|zip)$/i))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(REPORTS_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) {
    console.log(`  No ${platform} report found in scraper/reports/`);
    return empty;
  }

  const filePath = path.join(REPORTS_DIR, files[0].name);
  console.log(`  Reading ${platform} report: ${files[0].name}`);

  let csvText = null;

  if (files[0].name.toLowerCase().endsWith('.zip')) {
    const zip = new AdmZip(filePath);
    // Find account_metrics CSV inside the ZIP
    const entry = zip.getEntries().find(e =>
      e.entryName.toLowerCase().includes('account_metrics') &&
      e.entryName.toLowerCase().endsWith('.csv')
    );
    if (!entry) {
      console.log(`  No account_metrics.csv found inside ${files[0].name}`);
      return empty;
    }
    csvText = zip.readAsText(entry);
  } else {
    csvText = fs.readFileSync(filePath, 'utf8');
  }

  const rows = parseCSV(csvText);
  if (!rows.length) return empty;

  return extractDailyMetrics(rows, platform);
}

// ── Daily metrics extractor ───────────────────────────────────────────────────
// Hootsuite exports daily rows. We sum the last 7 days (current week)
// and the 7 days before that (previous week) to compute % change.

function extractDailyMetrics(rows, platform) {
  // Sort rows by date ascending, filter to rows that have a valid date
  const dated = rows
    .map(r => ({ ...r, _date: parseDate(r['Date (GMT)'] || r['Date'] || '') }))
    .filter(r => r._date)
    .sort((a, b) => a._date - b._date);

  if (!dated.length) return { available: false };

  const today     = new Date();
  today.setHours(0, 0, 0, 0);
  const d7  = new Date(today - 7  * 864e5);
  const d14 = new Date(today - 14 * 864e5);

  const thisWeek = dated.filter(r => r._date >= d7  && r._date < today);
  const lastWeek = dated.filter(r => r._date >= d14 && r._date < d7);

  // Find column names by partial match
  const cols = Object.keys(dated[0]).filter(k => k !== '_date');

  function findCol(...terms) {
    return cols.find(c => terms.every(t => c.toLowerCase().includes(t.toLowerCase())));
  }

  function sumCol(rowSet, col) {
    if (!col) return 0;
    return rowSet.reduce((acc, r) => acc + (parseNum(r[col]) || 0), 0);
  }

  function withPct(cur, prev) {
    const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
    return { current: Math.round(cur), previous: Math.round(prev), pct };
  }

  if (platform === 'instagram') {
    const engCol   = findCol('Post engagement', 'Daily');
    const viewCol  = findCol('Post views', 'Daily');
    const likeCol  = findCol('Post likes', 'Daily');

    const engCur  = sumCol(thisWeek, engCol);
    const engPrev = sumCol(lastWeek, engCol);
    const reachCur  = sumCol(thisWeek, viewCol  || likeCol);
    const reachPrev = sumCol(lastWeek, viewCol  || likeCol);

    console.log(`  Instagram: ${engCur} engagements this week (${thisWeek.length} days), ${reachCur} views`);

    return {
      available: engCur > 0 || reachCur > 0,
      engagements: withPct(engCur, engPrev),
      reach:       withPct(reachCur, reachPrev),
      followers:   { current: 0, previous: 0, pct: 0 },
    };
  }

  // YouTube
  const viewCol  = findCol('Post video views', 'Daily');
  const likeCol  = findCol('Post likes', 'Overall');
  const subCol   = findCol('subscribers gained', 'Overall');

  const viewCur  = sumCol(thisWeek, viewCol);
  const viewPrev = sumCol(lastWeek, viewCol);
  const subCur   = sumCol(thisWeek, subCol);
  const subPrev  = sumCol(lastWeek, subCol);

  console.log(`  YouTube: ${viewCur} video views this week (${thisWeek.length} days)`);

  return {
    available: viewCur > 0 || subCur > 0,
    views:       withPct(viewCur, viewPrev),
    engagements: withPct(sumCol(thisWeek, likeCol), sumCol(lastWeek, likeCol)),
    subscribers: withPct(subCur, subPrev),
  };
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (vals[i] || '').trim()]));
  });
}

function splitLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

function parseNum(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[^0-9.-]/g, '')) || 0;
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d) ? null : d;
}
