/**
 * hootsuite_api.mjs (cloud copy) — Hootsuite REST + Analytics client for GitHub Actions.
 *
 * Differs from scraper/hootsuite_api.mjs only in where tokens live: instead of rewriting a
 * local .env, rotated tokens are saved to the JSON file named by HOOTSUITE_STATE_FILE.
 * The workflow then copies the new refresh token back into the repo secret.
 * Refresh tokens are SINGLE-USE: the old one dies the moment a new one is issued, so the
 * state file is written synchronously right after each refresh, before anything else.
 *
 * Inputs (env): HOOTSUITE_CLIENT_ID, HOOTSUITE_CLIENT_SECRET, HOOTSUITE_REFRESH_TOKEN,
 *               HOOTSUITE_STATE_FILE (path). Subsequent processes in the same job reuse
 *               the state file (valid access token or newer refresh token).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const STATE_FILE = process.env.HOOTSUITE_STATE_FILE;
const TOKEN_URL = 'https://platform.hootsuite.com/oauth2/token';
const API_BASE = 'https://platform.hootsuite.com/v1';

function loadState() {
  if (STATE_FILE && existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { /* fall through */ }
  }
  return { accessToken: '', refreshToken: process.env.HOOTSUITE_REFRESH_TOKEN || '', expiresAt: 0 };
}
let state = loadState();

function saveState() {
  if (STATE_FILE) writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
}

async function refreshAccessToken() {
  const { HOOTSUITE_CLIENT_ID, HOOTSUITE_CLIENT_SECRET } = process.env;
  if (!state.refreshToken) throw new Error('No Hootsuite refresh token available (secret HOOTSUITE_REFRESH_TOKEN is empty).');
  const basic = Buffer.from(`${HOOTSUITE_CLIENT_ID}:${HOOTSUITE_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: state.refreshToken });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Token refresh failed (${resp.status}): ${JSON.stringify({ error: data.error, error_description: data.error_description })} — the refresh token may be dead; re-run hootsuite_oauth.mjs on the laptop and update the HOOTSUITE_REFRESH_TOKEN secret.`);
  }
  state = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  saveState(); // immediately — the old refresh token is already dead
  return state.accessToken;
}

async function getAccessToken() {
  const fiveMinutes = 5 * 60 * 1000;
  if (state.accessToken && Date.now() < state.expiresAt - fiveMinutes) return state.accessToken;
  return refreshAccessToken();
}

async function apiCall(pathAndQuery, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const doFetch = tok => fetch(`${API_BASE}${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
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
