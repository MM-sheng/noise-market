# NOISE // 纯随机市场

A zero-drift random-market trading game. The price is a seeded, driftless
geometric-Brownian martingale — there is provably no signal to read. Trade it,
then race 4 bots (Momentum, Contrarian, Buy&Hold, and a coin-flipping Monkey)
on the *same* price path. The leaderboard makes the lesson visceral: on pure
noise, your rank is a coin toss.

Single static file. No build for the game. The optional global leaderboard is
a tiny Cloudflare Worker backed by KV.

## Deploy (pick one, ~60s)

### GitHub Pages
```bash
git init && git add index.html README.md && git commit -m "NOISE market"
git branch -M main
gh repo create noise-market --public --source=. --push
gh api -X POST repos/MM-sheng/noise-market/pages -f "source[branch]=main" -f "source[path]=/"
# live at: https://MM-sheng.github.io/noise-market/
```

### Vercel (one command)
```bash
npx vercel --prod
```

### Surge (one command)
```bash
npx surge . noise-market.surge.sh
```

## Global players board

The frontend now supports a real shared leaderboard through `worker/src/index.js`.
Deploy the Worker, then paste the Worker URL into `LEADERBOARD_API` near the top
of the script in `index.html`.

```bash
npx wrangler login
npx wrangler kv namespace create LEADERBOARD
# Put the returned id into wrangler.toml under [[kv_namespaces]]
npx wrangler deploy
```

After deploy, set:

```js
const LEADERBOARD_API = 'https://noise-market-leaderboard.mm-sheng.workers.dev';
```

If `LEADERBOARD_API` is empty or unreachable, the game automatically falls back
to Claude canvas shared storage when available, then localStorage on the visitor
device.
