import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, 'reports');
const HOOTSUITE_SENDER = 'no-reply.analytics.reports@hootsuite.com';

export async function fetchHootsuiteAttachments() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const client = new ImapFlow({
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    logger: false,
  });

  // Prevent unhandled 'error' event from crashing Node when IMAP is disabled
  client.on('error', () => {});

  await client.connect();
  const saved = [];

  try {
    await client.mailboxOpen('INBOX');

    // Look back 3 days to catch any delivery delays
    const since = new Date();
    since.setDate(since.getDate() - 3);

    const uids = await client.search({ from: HOOTSUITE_SENDER, since });

    if (!uids.length) {
      console.log('  No Hootsuite export email found — will use existing files if present');
      return saved;
    }

    // Take only the most recent message
    const latest = uids.slice(-1);

    for await (const msg of client.fetch(latest, { source: true })) {
      const parsed = await simpleParser(msg.source);

      for (const att of (parsed.attachments || [])) {
        if (!att.filename?.match(/\.(csv|xlsx?)$/i)) continue;

        const dest = path.join(REPORTS_DIR, att.filename);
        fs.writeFileSync(dest, att.content);
        saved.push(att.filename);
        console.log(`  Saved: ${att.filename}`);
      }
    }

    if (!saved.length) {
      console.log('  Hootsuite email found but no CSV/Excel attachments');
    }
  } finally {
    await client.logout();
  }

  return saved;
}
