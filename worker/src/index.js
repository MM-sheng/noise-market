const KEY = 'noise:players:v1';
const LIMIT = 50;

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function cleanText(value, max) {
  return String(value || '').replace(/[<>&]/g, '').trim().slice(0, max);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => row && Number.isFinite(Number(row.ret)))
    .map((row) => ({
      name: cleanText(row.name || 'anon', 16) || 'anon',
      ret: Number(row.ret),
      seed: cleanText(row.seed || '', 32),
      rank: Number.parseInt(row.rank, 10) || 1,
      ts: Number.parseInt(row.ts, 10) || Date.now(),
    }))
    .sort((a, b) => b.ret - a.ret)
    .slice(0, LIMIT);
}

async function readPlayers(env) {
  const raw = await env.LEADERBOARD.get(KEY);
  try {
    return cleanList(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function cleanEntry(value) {
  const entry = cleanList([value])[0];
  if (!entry) return null;
  if (entry.rank !== 1 || entry.ret <= 0 || entry.ret > 200) return null;
  return { ...entry, ts: Date.now() };
}

function scoreKey(row) {
  return [
    row.name.toLowerCase(),
    row.seed,
    row.rank,
    Math.round(row.ret * 10000),
  ].join(':');
}

function mergePlayers(entry, players) {
  const byKey = new Map();
  for (const row of cleanList([entry, ...players])) {
    const key = scoreKey(row);
    const prev = byKey.get(key);
    if (!prev || row.ts < prev.ts) byKey.set(key, row);
  }
  return cleanList([...byKey.values()]);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === '/') return json({ ok: true, service: 'noise-market-leaderboard' });
    if (url.pathname !== '/leaderboard') return json({ error: 'not found' }, 404);
    if (!env.LEADERBOARD) return json({ error: 'missing LEADERBOARD KV binding' }, 500);

    if (request.method === 'GET') {
      return json({ players: await readPlayers(env) });
    }

    if (request.method === 'POST') {
      const size = Number(request.headers.get('content-length') || 0);
      if (size > 2048) return json({ error: 'payload too large' }, 413);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid json' }, 400);
      }

      const entry = cleanEntry(body);
      if (!entry) return json({ error: 'invalid leaderboard entry' }, 400);

      const players = mergePlayers(entry, await readPlayers(env));
      await env.LEADERBOARD.put(KEY, JSON.stringify(players));
      return json({ players }, 201);
    }

    return json({ error: 'method not allowed' }, 405);
  },
};
