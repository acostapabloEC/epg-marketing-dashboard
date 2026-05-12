import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '.session.json');

// Dedicated Edge profile just for this scraper — won't conflict with your regular Edge
const SCRAPER_PROFILE = path.join(__dirname, 'edge-profile');

export async function scrapeLinkedIn(email, password) {
  const isCI    = process.env.CI === 'true';
  const headless = isCI || process.env.HEADLESS !== 'false';
  const profile  = isCI ? '/tmp/li-profile' : SCRAPER_PROFILE;

  const context = await chromium.launchPersistentContext(profile, {
    // Use system Chromium on Linux CI, Edge on Windows
    ...(isCI ? {} : { channel: 'msedge' }),
    headless,
    slowMo: isCI ? 80 : 150,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });

  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, email, password);
    const data = await scrapeAnalytics(page);
    return data;
  } finally {
    await context.close();
  }
}

async function ensureLoggedIn(page, email, password) {
  await page.goto('https://www.linkedin.com/feed/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  if (page.url().includes('/feed/')) {
    console.log('  Using saved session.');
    return;
  }

  console.log('  Logging in...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(__dirname, 'debug-login-page.png'), fullPage: true });

  // LinkedIn sometimes shows a "Welcome Back" saved-account picker instead of the login form
  const hasSavedAccount = await page.locator('text=Sign in using another account').isVisible({ timeout: 3000 }).catch(() => false);

  if (hasSavedAccount) {
    console.log('  Saved account picker detected — clicking Frank\'s card...');
    await page.locator('button.member-profile__details').first().click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(__dirname, 'debug-after-card-click.png'), fullPage: true });
    console.log('  Post-card-click screenshot saved.');
  }

  // Now handle the standard login form (email + password) or just password prompt
  const hasUsername = await page.locator('#username').isVisible({ timeout: 5000 }).catch(() => false);

  if (hasUsername) {
    await page.click('#username');
    await page.type('#username', email, { delay: 80 });
    await page.waitForTimeout(500);
  }

  await page.waitForSelector('#password', { timeout: 15000 });
  await page.click('#password');
  await page.type('#password', password, { delay: 70 });
  await page.waitForTimeout(700);
  await page.click('button[type="submit"]');

  await page.waitForTimeout(6000);
  const url = page.url();

  if (url.includes('/checkpoint/') || url.includes('/challenge/') || url.includes('/login')) {
    await page.screenshot({ path: path.join(__dirname, 'debug-verify.png'), fullPage: true });
    throw new Error(
      'LinkedIn requires verification (2FA or suspicious login check).\n' +
      'Screenshot saved: scraper/debug-verify.png\n' +
      'Fix: set HEADLESS=false in .env, run once, complete the verification manually, then run again.'
    );
  }

  if (!url.includes('/feed/')) {
    await page.screenshot({ path: path.join(__dirname, 'debug-login-error.png'), fullPage: true });
    throw new Error(`Login failed. URL: ${url} — see debug-login-error.png`);
  }

  console.log('  Login successful!');
}

async function scrapeAnalytics(page) {
  const now = new Date();
  const weekOf = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // ── Content analytics (impressions + engagements) ──────────────────────────
  console.log('  Loading content analytics...');
  await page.goto('https://www.linkedin.com/analytics/creator/content/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(__dirname, 'debug-content.png'), fullPage: true });

  // Set time range to Last 7 days
  await trySetTimeRange(page, 'Past 7 days');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(__dirname, 'debug-content-7d.png'), fullPage: true });

  const { impressions, membersReached, posts } = await extractContentMetrics(page);

  // ── Engagement metric view ─────────────────────────────────────────────────
  console.log('  Loading engagement analytics...');
  await page.goto('https://www.linkedin.com/analytics/creator/content/?metricType=ENGAGEMENT', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(__dirname, 'debug-engagement.png'), fullPage: true });

  const engagements = await extractEngagementMetrics(page);

  // ── Top posts (from the default impressions view — has "View analytics" anchors) ──
  await page.goto('https://www.linkedin.com/analytics/creator/content/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(3000);
  await trySetTimeRange(page, 'Past 7 days');
  await page.waitForTimeout(2000);
  const topPosts = await extractTopPosts(page);

  // ── Audience / follower analytics ─────────────────────────────────────────
  console.log('  Loading audience analytics...');
  const followers = await extractFollowerMetrics(page);

  // ── Outbound activity (MotionMedia accountability) ─────────────────────────
  console.log('  Loading outbound activity...');
  const outbound = await scrapeOutboundActivity(page);

  return {
    weekOf,
    linkedin: {
      engagements,
      impressions,
      membersReached,
      followers,
      posts,
      weeklyGoal: 187,
      topPosts,
    },
    outbound,
  };
}

// ── Outbound activity scraper ───────────────────────────────────────────────

async function scrapeOutboundActivity(page) {
  const result = { comments: 0, reactions: 0, activity: [] };

  try {
    // ── Comments Frank made on other posts ──────────────────────────────────
    await page.goto('https://www.linkedin.com/in/me/recent-activity/comments/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(__dirname, 'debug-outbound-comments.png'), fullPage: true });

    const commentsText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(__dirname, 'debug-outbound-comments.txt'), commentsText.slice(0, 12000));

    const commentItems = parseActivityItems(commentsText, 7);
    result.comments = commentItems.length;
    result.activity  = commentItems.map(i => ({ ...i, type: 'comment' }));

    console.log(`  Outbound comments this week: ${result.comments}`);

    // ── Reactions Frank gave on other posts ─────────────────────────────────
    await page.goto('https://www.linkedin.com/in/me/recent-activity/reactions/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(3500);

    const reactionsText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(__dirname, 'debug-outbound-reactions.txt'), reactionsText.slice(0, 12000));

    const reactionItems = parseActivityItems(reactionsText, 7);
    result.reactions = reactionItems.length;

    console.log(`  Outbound reactions this week: ${result.reactions}`);

  } catch (e) {
    console.warn('  Outbound activity scrape failed:', e.message);
  }

  return result;
}

// Parse LinkedIn activity page text — counts items within maxDays
// Splits on "Feed post number X" blocks to avoid picking up UI button text
function parseActivityItems(text, maxDays) {
  const items = [];

  // Split into per-post blocks using "Feed post number N" as separator
  const blocks = text.split(/Feed post number \d+/i).slice(1); // slice(1) drops the header

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);

    // Each block must contain "• You" — that's Frank's entry
    const youIdx = lines.findIndex(l => l.includes('• You'));
    if (youIdx === -1) continue;

    // Time marker: first "Xd", "Xh", "Xw" etc. line after "• You"
    let daysAgo = null;
    let timeIdx = -1;
    for (let i = youIdx + 1; i < Math.min(youIdx + 6, lines.length); i++) {
      const m = lines[i].match(/^(\d+)([dwhm])/);
      if (m) {
        const num  = parseInt(m[1]);
        const unit = m[2];
        daysAgo = unit === 'd' ? num
                : unit === 'w' ? num * 7
                : unit === 'h' || unit === 'm' ? 0
                : 99;
        timeIdx = i;
        break;
      }
    }

    if (daysAgo === null || daysAgo > maxDays) continue;

    // Post author: first substantive line in the block, skipping intro phrases
    const skipPatterns = [
      /Frank LaRosa commented on this/i,
      /Frank LaRosa reacted to this/i,
      /Frank LaRosa reposted this/i,
      /^\d+[dwhm]$/,
      /^•/,
      /^(Like|Reply|Comment|Repost|Send)$/i,
    ];
    let postAuthor = '';
    for (const l of lines) {
      if (skipPatterns.some(p => p.test(l))) continue;
      if (l.length < 3) continue;
      postAuthor = l.slice(0, 80);
      break;
    }

    // Frank's comment: lines after the time marker that aren't UI chrome
    const uiWords = /^(Like|Reply|Comment|Repost|Send|Load more|Follow|Connect|Message|View profile|Show more|People you may know)$/i;
    const isMetadata = (l) =>
      uiWords.test(l) ||
      /^\d+$/.test(l) ||
      /^\d+[dwhm]$/.test(l) ||
      /^\d+\s+(reply|replies|impression|repost|comment)/i.test(l) ||
      /impressions$/i.test(l) ||
      /^(Load more|Show more|People you)/i.test(l) ||
      /^Frank LaRosa/i.test(l) ||
      /on Frank LaRosa/i.test(l);

    const commentLines = [];
    for (const l of lines.slice(timeIdx + 1)) {
      if (isMetadata(l)) break; // stop at first metadata line
      if (l.length < 1) continue;
      commentLines.push(l);
      if (commentLines.length >= 2) break; // max 2 lines
    }

    const frankComment = commentLines.join(' ').slice(0, 160);

    items.push({
      daysAgo,
      author:      postAuthor,
      frankComment: frankComment || '(reaction)',
      date: new Date(Date.now() - daysAgo * 864e5).toISOString().split('T')[0],
    });
  }

  return items;
}

// ── Metric extraction helpers ───────────────────────────────────────────────

async function extractContentMetrics(page) {
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('  Parsing content metrics from page text...');
  fs.writeFileSync(path.join(__dirname, 'debug-content-text.txt'), pageText.slice(0, 8000));

  // LinkedIn format: "4,070\n\nImpressions\n\n38.7% vs. prior 7 days"
  const impressions = extractLinkedInMetric(pageText, 'Impressions');
  // LinkedIn shows "Members reached" not "Engagements"
  const membersReached = extractLinkedInMetric(pageText, 'Members reached');
  const posts = extractPostCount(pageText);

  return { impressions, membersReached, posts };
}

async function extractEngagementMetrics(page) {
  const pageText = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(__dirname, 'debug-engagement-text.txt'), pageText.slice(0, 5000));

  // Try known LinkedIn engagement labels
  let eng = extractLinkedInMetric(pageText, 'Engagements');
  if (!eng.current) eng = extractLinkedInMetric(pageText, 'Reactions');
  if (!eng.current) eng = extractLinkedInMetric(pageText, 'Engagement');

  // Fallback: sum reactions from top posts (visible in the page text)
  if (!eng.current) {
    const lines = pageText.split('\n').map(l => l.trim());
    let total = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i + 1] === 'Impressions' && lines[i + 2] === 'View analytics') {
        // Line before impressions count is comments, line before that is reactions
        const reactionsLine = lines[i - 2] || lines[i - 1] || '';
        const n = parseInt(reactionsLine.replace(/,/g, ''));
        if (!isNaN(n) && n > 0) total += n;
      }
    }
    if (total > 0) eng = { current: total, previous: 0, pct: 0 };
  }

  console.log(`  Engagements found: ${eng.current} (${eng.pct > 0 ? '+' : ''}${eng.pct}%)`);
  return eng;
}

async function extractTopPosts(page) {
  // LinkedIn analytics page text pattern per post:
  //   [post text]
  //   [reactions count]       ← bare number
  //   [X comment(s)]          ← optional
  //   [impressions count]     ← bare number
  //   Impressions
  //   View analytics          ← reliable anchor
  try {
    const pageText = await page.evaluate(() => document.body.innerText);
    const posts = [];
    const chunks = pageText.split('View analytics');

    for (let i = 0; i < Math.min(chunks.length - 1, 5); i++) {
      const lines = chunks[i].split('\n').map(l => l.trim()).filter(Boolean);
      let idx = lines.length - 1;

      // Strip trailing "Impressions" label
      if (lines[idx] === 'Impressions') idx--;

      // Impressions count
      let impressionsCount = 0;
      const imprMatch = lines[idx]?.match(/^([\d,]+)$/);
      if (imprMatch) { impressionsCount = parseInt(imprMatch[1].replace(/,/g, '')); idx--; }

      // Optional "X comment(s)"
      if (/^\d+\s+comment/i.test(lines[idx] || '')) idx--;

      // Reactions count
      let reactions = 0;
      const reactMatch = lines[idx]?.match(/^(\d+)$/);
      if (reactMatch) { reactions = parseInt(reactMatch[1]); idx--; }

      // Find first meaningful post text line (skip header + short lines)
      const postLines = lines.slice(0, idx + 1);
      const textIdx = postLines.findIndex(
        l => !/^Frank LaRosa (reposted|posted) this/.test(l) && !/^\d+d$/.test(l) && l.length > 20
      );
      const preview = textIdx >= 0 ? postLines[textIdx] : (postLines[postLines.length - 1] || '');

      if (impressionsCount > 0 || reactions > 0) {
        posts.push({
          preview: preview.replace(/\s+/g, ' ').slice(0, 120),
          reactions,
          impressions: impressionsCount,
          format: 'Post',
        });
      }
    }

    return posts;
  } catch (e) {
    console.warn('  Could not parse top posts:', e.message);
    return [];
  }
}

async function extractFollowerMetrics(page) {
  // Click the "Audience" tab from the analytics page
  try {
    const audienceTab = page.locator('a:has-text("Audience"), button:has-text("Audience")').first();
    if (await audienceTab.isVisible({ timeout: 3000 })) {
      await audienceTab.click();
      await page.waitForTimeout(3000);
    }
  } catch { /* tab not found, parse whatever is on screen */ }

  const pageText = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(__dirname, 'debug-followers-text.txt'), pageText.slice(0, 5000));

  // Look for "New followers" and total follower count
  const newFollowers = extractLinkedInMetric(pageText, 'New followers');
  const totalFollowers = extractLinkedInMetric(pageText, 'Total followers');

  return {
    gained: newFollowers.current,
    total: totalFollowers.current || 12789,
    pct: newFollowers.pct,
  };
}

// ── Time range selector ─────────────────────────────────────────────────────

async function trySetTimeRange(page, label) {
  const triggers = [
    '[data-test-analytics-date-range-dropdown]',
    'button[aria-label*="time"]',
    'button[aria-label*="date"]',
    'button[aria-label*="range"]',
    '[class*="date-range"] button',
    '[class*="time-range"] button',
  ];

  for (const sel of triggers) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        await page.waitForTimeout(800);

        const option = page.locator(`[role="option"]:has-text("${label}"), li:has-text("${label}")`).first();
        if (await option.isVisible({ timeout: 1500 })) {
          await option.click();
          return;
        }
        // Close dropdown if option not found
        await page.keyboard.press('Escape');
      }
    } catch {
      // Try next selector
    }
  }
}

// ── Text parsing utilities ──────────────────────────────────────────────────

// Parses LinkedIn analytics format: "4,070\n\nImpressions\n\n38.7% vs. prior 7 days"
function extractLinkedInMetric(text, label) {
  // Escape special chars in label for regex
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Number appears just before the label
  const pattern = new RegExp(`([\\d,]+)\\s*\\n+\\s*${escapedLabel}`, 'i');
  const match = text.match(pattern);
  if (!match) return { current: 0, previous: 0, pct: 0 };

  const current = parseInt(match[1].replace(/,/g, '')) || 0;
  const matchIdx = text.indexOf(match[0]);

  // Look for "X% vs. prior 7 days" or "X% vs prior" in the next ~60 chars
  // LinkedIn uses decimals like "38.7%" and no +/- prefix
  const after = text.slice(matchIdx, matchIdx + 150);
  const pctMatch = after.match(/([\d.]+)%\s*vs\.?\s*prior/i);
  const pct = pctMatch ? Math.round(parseFloat(pctMatch[1])) : 0;
  const previous = pct !== 0 ? Math.round(current / (1 + pct / 100)) : 0;

  return { current, previous, pct };
}

function extractPostCount(text) {
  const match = text.match(/(\d+)\s*posts?\s*published/i) || text.match(/published\s*(\d+)\s*posts?/i);
  return match ? parseInt(match[1]) : 0;
}
