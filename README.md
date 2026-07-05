# 纯随机市场 · Pure Random Market

一个证明“零漂移市场里没有信号”的交互实验。玩家在同一条随机游走行情上做多做空，和动量、反转、买入持有、随机对手同场竞技。

Live:

- Frontend: https://mm-sheng.github.io/noise-market/
- Leaderboard Worker: https://noise-market-leaderboard.mm-sheng.workers.dev

## 部署

前端是单文件静态站点，入口是 `index.html`，GitHub Pages 从 `main` 分支根目录发布。

```bash
git add index.html README.md worker/src/index.js wrangler.toml
git commit -m "Deploy optimized noise market"
git push origin main
```

全网排行榜使用 Cloudflare Worker + KV。Worker 会用种子和玩家操作轨迹重放整局，只接受服务器确认的标准局第一名。

```bash
npx wrangler deploy
```

当前 KV namespace 已绑定在 `wrangler.toml`:

```toml
binding = "LB"
id = "4f0ef4d171334058b34443f3fb21a8d9"
```

## 公平口径

全球榜只收标准局：波动 `1%`，成本 `2‱`，局长 `120` tick。改参数仍可玩、可分享、本机留痕，但不进全球榜。
