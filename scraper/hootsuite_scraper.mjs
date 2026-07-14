/**
 * DEPRECATED for weekly updates (2026-07-14). This pulls Instagram AND YouTube
 * together, which conflicts with running them as separate dedicated sessions/
 * automations. Use instagram_report.mjs or youtube_report.mjs instead — each
 * is platform-isolated, takes an exact date range, and archives daily rows so
 * numbers survive Hootsuite's month-to-date export window. Left here only for
 * manual one-off use if a future need calls for pulling both at once.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, 'hootsuite-profile');
const DOWNLOAD_DIR = path.join(__dirname, 'hootsuite-downloads');
mkdirSync(DOWNLOAD_DIR, { recursive: true });

function downloadFile(url, destPath, cookieHeader) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const req = lib.get({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath, cookieHeader).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => { writeFileSync(destPath, Buffer.concat(chunks)); resolve(destPath); });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

console.log('Launching Edge...');
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'msedge',
  headless: false,
  slowMo: 200,
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});

const page = await context.newPage();
await page.goto('https://hootsuite.com/dashboard#/analytics', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

if (page.url().includes('signin') || page.url().includes('login')) {
  console.log('\n⚠ Please log in to Hootsuite in the browser window, then leave it open.');
  await page.waitForURL('**hootsuite.com/dashboard**', { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.goto('https://hootsuite.com/dashboard#/analytics', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
}

console.log('Logged in.');

async function dismissCookieModal(page) {
  const btn = page.locator('button:has-text("Confirm My Choices")').first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(800);
  }
}

await dismissCookieModal(page);

async function exportReport(page, reportUrl, label, filename) {
  console.log(`\n--- Exporting ${label} ---`);

  await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  await dismissCookieModal(page);

  // Intercept the POST /exports/ response — the download link is in it immediately
  let fileUrl = null;
  const responseHandler = async res => {
    if (res.url().includes('/service/web/v1/exports/') && res.request().method() === 'POST') {
      try {
        const body = await res.json();
        console.log(`  POST response (full): ${JSON.stringify(body)}`);
        // Extract link from links array
        const links = body.links || [];
        for (const l of links) {
          const href = l.link || l.href || l.url;
          if (href) {
            fileUrl = href.startsWith('http') ? href : `https://measure.hootsuite.com${href}`;
            console.log(`  Download URL from POST: ${fileUrl}`);
            break;
          }
        }
        // Fallback: direct url fields
        if (!fileUrl) {
          fileUrl = body.file_url || body.url || body.download_url;
        }
      } catch (e) {
        console.log(`  Could not parse POST response: ${e.message}`);
      }
    }
  };
  page.on('response', responseHandler);

  // Click Export button
  const exportBtn = page.locator('button:has-text("Export")').first();
  await exportBtn.waitFor({ state: 'visible', timeout: 10000 });
  await exportBtn.click();
  await page.waitForTimeout(1500);

  // Click Excel option by scanning all elements
  const allEls = await page.locator('button, div, span, li').all();
  let clicked = false;
  for (const el of allEls) {
    const text = await el.innerText({ timeout: 100 }).catch(() => '');
    if (text.trim() === 'Microsoft Excel (.xlsx)') {
      const box = await el.boundingBox();
      if (box && box.width > 0) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        console.log(`  Clicked Excel option.`);
        clicked = true;
        break;
      }
    }
  }

  if (!clicked) {
    console.log(`  ERROR: Could not find Excel option for ${label}`);
    page.off('response', responseHandler);
    return null;
  }

  // Wait for POST response to capture the export ID
  let exportId = null;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    if (fileUrl || exportId) break;
  }

  page.off('response', responseHandler);

  // fileUrl from POST is the self-link (status URL), not the actual file.
  // Poll via Playwright's authenticated request context until url field is populated.
  if (fileUrl && fileUrl.includes('/exports/')) {
    console.log(`  Polling export status via browser session...`);
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(3000);
      const resp = await page.request.get(fileUrl, {
        headers: { Accept: 'application/json' }
      });
      const body = await resp.json().catch(() => ({}));
      console.log(`  poll ${i + 1}: state=${body.state} url=${body.url || '(empty)'}`);
      if (body.url && body.url.length > 0) {
        fileUrl = body.url;
        console.log(`  File ready: ${fileUrl}`);
        break;
      }
      if (body.state === 'failed') {
        console.log(`  Export failed.`);
        return null;
      }
    }
  }

  if (!fileUrl || fileUrl.includes('/exports/')) {
    console.log(`  ERROR: No download URL found for ${label}`);
    return null;
  }

  // Download using Playwright's authenticated request context
  const destPath = path.join(DOWNLOAD_DIR, filename);
  console.log(`  Downloading to ${destPath}...`);
  const fileResp = await page.request.get(fileUrl);
  const buffer = await fileResp.body();
  writeFileSync(destPath, buffer);
  console.log(`  Saved: ${destPath}`);
  return destPath;
}

const today = new Date().toISOString().slice(0, 10);

const igFile = await exportReport(
  page,
  'https://hootsuite.com/dashboard#/analytics/report?id=18667698',
  'Instagram engagement',
  `instagram_engagement_${today}.xlsx`
);

const ytFile = await exportReport(
  page,
  'https://hootsuite.com/dashboard#/analytics/report?id=18626538',
  'YouTube overview',
  `youtube_overview_${today}.xlsx`
);

await context.close();

console.log('\n--- SUMMARY ---');
console.log('Instagram:', igFile || 'FAILED');
console.log('YouTube:', ytFile || 'FAILED');
