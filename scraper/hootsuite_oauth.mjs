/**
 * hootsuite_oauth.mjs — one-time interactive setup for the Hootsuite Analytics API.
 * Usage: node hootsuite_oauth.mjs
 *
 * Requires HOOTSUITE_CLIENT_ID and HOOTSUITE_CLIENT_SECRET already in .env
 * (from the app's "Security" tab at hootsuite.com/developers -> My Apps).
 * The app's redirect URIs must include http://localhost:8787/callback.
 *
 * Runs the OAuth2 Authorization Code flow: opens the Hootsuite login/consent
 * page, catches the redirect on a local server, exchanges the code for an
 * access_token + refresh_token, and writes them into .env. Run again any time
 * to re-authorize (e.g. if the refresh token is ever revoked).
 */
import 'dotenv/config';
import http from 'http';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');
const REDIRECT_URI = 'http://localhost:8787/callback';
const AUTHORIZE_URL = 'https://platform.hootsuite.com/oauth2/auth';
const TOKEN_URL = 'https://platform.hootsuite.com/oauth2/token';
const SCOPE = 'offline analytics:read';

const { HOOTSUITE_CLIENT_ID, HOOTSUITE_CLIENT_SECRET } = process.env;

if (!HOOTSUITE_CLIENT_ID || !HOOTSUITE_CLIENT_SECRET) {
  console.error('Missing HOOTSUITE_CLIENT_ID / HOOTSUITE_CLIENT_SECRET in .env.');
  console.error('Get these from hootsuite.com/developers -> My Apps -> your app -> Security tab, then add:');
  console.error('  HOOTSUITE_CLIENT_ID=...');
  console.error('  HOOTSUITE_CLIENT_SECRET=...');
  console.error('to scraper/.env, then run this script again.');
  process.exit(1);
}

function upsertEnvVar(key, value) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, line);
  } else {
    text = text.replace(/\n?$/, '\n') + line + '\n';
  }
  writeFileSync(ENV_PATH, text);
}

function tryOpenBrowser(url) {
  try {
    execSync(`powershell.exe -NoProfile -Command "Start-Process '${url}'"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function exchangeCodeForTokens(code) {
  const basic = Buffer.from(`${HOOTSUITE_CLIENT_ID}:${HOOTSUITE_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Token exchange failed (${resp.status}): ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', HOOTSUITE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPE);

  console.log('\nOpening Hootsuite login/consent page in your browser...');
  console.log('If it doesn\'t open automatically, copy/paste this URL:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for you to log in and authorize...\n');

  const codePromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h2>Authorization failed: ${error}</h2>You can close this tab.`);
        server.close();
        reject(new Error(`Hootsuite returned error: ${error}`));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2>Authorized ✓</h2>You can close this tab and return to the terminal.');
      server.close();
      resolve(code);
    });
    server.listen(8787);
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for authorization (5 min).'));
    }, 5 * 60 * 1000);
  });

  tryOpenBrowser(authUrl.toString());

  const code = await codePromise;
  console.log('Got authorization code, exchanging for tokens...');

  const tokens = await exchangeCodeForTokens(code);
  const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;

  upsertEnvVar('HOOTSUITE_ACCESS_TOKEN', tokens.access_token);
  upsertEnvVar('HOOTSUITE_REFRESH_TOKEN', tokens.refresh_token);
  upsertEnvVar('HOOTSUITE_TOKEN_EXPIRES_AT', String(expiresAt));

  console.log('\n✓ Saved HOOTSUITE_ACCESS_TOKEN / HOOTSUITE_REFRESH_TOKEN / HOOTSUITE_TOKEN_EXPIRES_AT to .env');
  console.log(`  Access token expires: ${new Date(expiresAt).toLocaleString()}`);
  console.log('  Refresh tokens don\'t expire but are single-use — hootsuite_api.mjs auto-refreshes and rewrites .env.');
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
