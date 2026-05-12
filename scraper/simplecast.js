const PODCAST_ID = '2636c469-8b34-4ec7-8457-71f1b27ee304';
const API = 'https://api.simplecast.com';

export async function scrapeSimplecast(apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const get = (url) => fetch(url, { headers }).then(r => r.json());

  const today = new Date();
  const thisStart = fmtDate(new Date(today - 7 * 864e5));
  const thisEnd   = fmtDate(today);
  const lastStart = fmtDate(new Date(today - 14 * 864e5));
  const lastEnd   = fmtDate(new Date(today - 7 * 864e5));

  const [thisWeek, lastWeek, episodeList] = await Promise.all([
    get(`${API}/analytics/downloads?podcast=${PODCAST_ID}&start_date=${thisStart}&end_date=${thisEnd}`),
    get(`${API}/analytics/downloads?podcast=${PODCAST_ID}&start_date=${lastStart}&end_date=${lastEnd}`),
    get(`${API}/podcasts/${PODCAST_ID}/episodes?limit=5&offset=0`),
  ]);

  const current  = thisWeek.total || 0;
  const previous = lastWeek.total || 0;
  const pct      = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;

  // Latest 2 published episodes + their downloads this week
  const published = (episodeList.collection || [])
    .filter(e => e.status === 'published')
    .slice(0, 2);

  const episodes = await Promise.all(
    published.map(async ep => {
      const dl = await get(`${API}/analytics/downloads?episode=${ep.id}&start_date=${thisStart}&end_date=${thisEnd}`);
      return {
        number: ep.number,
        title: ep.title,
        publishedAt: ep.published_at,
        weekDownloads: dl.total || 0,
      };
    })
  );

  return {
    show: 'Advisor Talk with Frank LaRosa',
    downloads: { current, previous, pct },
    episodes,
  };
}

function fmtDate(d) {
  return d.toISOString().split('T')[0];
}
