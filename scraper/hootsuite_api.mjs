/**
 * hootsuite_api.mjs — thin client for the Hootsuite REST + Analytics API.
 * Requires HOOTSUITE_CLIENT_ID / _CLIENT_SECRET / _ACCESS_TOKEN / _REFRESH_TOKEN
 * / _TOKEN_EXPIRES_AT in .env (run hootsuite_oauth.mjs once first to populate these).
 *
 * Auto-refreshes the access token when it's within 5 minutes of expiry and
 * rewrites .env with the new access/refresh token pair (refresh tokens are
 * single-use — the old one stops working the moment a new one is issued).
 *
 * Exports: listSocialProfiles(), listProfileMetrics(profileId, since, until, networkId),
 * listPosts(profileId, since, until, networkId).
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');
const TOKEN_URL = 'https://platform.hootsuite.com/oauth2/token';
const API_BASE = 'https://platform.hootsuite.com/v1';

function upsertEnvVar(key, value) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, line) : text.replace(/\n?$/, '\n') + line + '\n';
  writeFileSync(ENV_PATH, text);
}

async function refreshAccessToken() {
  const { HOOTSUITE_CLIENT_ID, HOOTSUITE_CLIENT_SECRET, HOOTSUITE_REFRESH_TOKEN } = process.env;
  if (!HOOTSUITE_REFRESH_TOKEN) {
    throw new Error('No HOOTSUITE_REFRESH_TOKEN in .env — run `node hootsuite_oauth.mjs` first.');
  }
  const basic = Buffer.from(`${HOOTSUITE_CLIENT_ID}:${HOOTSUITE_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: HOOTSUITE_REFRESH_TOKEN });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Token refresh failed (${resp.status}): ${JSON.stringify(data)} — the refresh token may be dead; run hootsuite_oauth.mjs again.`);
  }
  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  process.env.HOOTSUITE_ACCESS_TOKEN = data.access_token;
  process.env.HOOTSUITE_REFRESH_TOKEN = data.refresh_token;
  process.env.HOOTSUITE_TOKEN_EXPIRES_AT = String(expiresAt);
  upsertEnvVar('HOOTSUITE_ACCESS_TOKEN', data.access_token);
  upsertEnvVar('HOOTSUITE_REFRESH_TOKEN', data.refresh_token);
  upsertEnvVar('HOOTSUITE_TOKEN_EXPIRES_AT', String(expiresAt));
  return data.access_token;
}

async function getAccessToken() {
  const expiresAt = Number(process.env.HOOTSUITE_TOKEN_EXPIRES_AT || 0);
  const fiveMinutes = 5 * 60 * 1000;
  if (process.env.HOOTSUITE_ACCESS_TOKEN && Date.now() < expiresAt - fiveMinutes) {
    return process.env.HOOTSUITE_ACCESS_TOKEN;
  }
  return refreshAccessToken();
}

async function apiCall(pathAndQuery, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const doFetch = tok => fetch(`${API_BASE}${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let resp = await doFetch(token);
  if (resp.status === 401) {
    const fresh = await refreshAccessToken();
    resp = await doFetch(fresh);
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(`Hootsuite API ${method} ${pathAndQuery} failed (${resp.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

export async function listSocialProfiles() {
  const data = await apiCall('/socialProfiles');
  return data.data ?? data;
}

export async function listProfileMetrics(profileId, since, until, networkId = 'INSTAGRAMBUSINESS') {
  const results = [];
  let cursor = null;
  do {
    const qs = new URLSearchParams({ datatype: 'ORGANIC', networkId, limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const resp = await apiCall(`/analytics/profiles?${qs}`, {
      method: 'POST',
      body: { filters: { profileId: { eq: profileId }, reportingPeriod: { timespan: { since, until } } } },
    });
    results.push(...(resp.data ?? []));
    cursor = resp.metadata?.collectionInfo?.next?.cursor ?? null;
  } while (cursor);
  return results;
}

export async function listPosts(profileId, since, until, networkId = 'INSTAGRAMBUSINESS') {
  const results = [];
  let cursor = null;
  do {
    const qs = new URLSearchParams({ datatype: 'ORGANIC', networkId, limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const resp = await apiCall(`/analytics/posts?${qs}`, {
      method: 'POST',
      body: { filters: { profileId: { eq: profileId }, reportingPeriod: { timespan: { since, until } } } },
    });
    results.push(...(resp.data ?? []));
    cursor = resp.metadata?.collectionInfo?.next?.cursor ?? null;
  } while (cursor);
  return results;
}
