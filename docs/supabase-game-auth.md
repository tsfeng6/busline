# Supabase 账号与小游戏排行榜配置

1. 新建 Supabase 项目，在 SQL Editor 执行 [`supabase-game-auth.sql`](./supabase-game-auth.sql)。
2. 在 Authentication 的 URL Configuration 添加正式网站地址（例如 `https://busline.cc`）；按需要开启邮箱确认。
3. 在 EdgeOne Pages 的 Production 环境变量中填写（均不使用 `VITE_` 前缀）：
   - `SUPABASE_URL`：项目 URL，例如 `https://xxxx.supabase.co`
   - `SUPABASE_ANON_KEY`：Supabase 的 anon/publishable key。它只保存在 EdgeOne，用于代理认证和受 RLS/RPC 约束的请求；不要填写 service_role key，也不要把它或任何密钥写入前端。
   - `ALLOWED_ORIGINS`：保留现有域名并按需加入预览域名。
4. 前端构建变量填写 `VITE_GAME_GATEWAY_URL` 为同一个 EdgeOne 网关 HTTPS 地址，再重新部署前端；此变量只是网关地址，不含任何密钥。未填写时，小游戏照常离线运行，账号和排行榜显示为未启用。

网关继续保留原 `/uploads` 与 GitHub Actions 写入流程。账号接口使用 `/game-auth/*`、`/game-runs*` 和 `/leaderboards`，与城市上传的 GitHub Token、Blob 存储和回调密钥完全分离。

排行榜只接受六个真实规则组合：线路/站名各有标准和地狱两榜，城市和县城各有固定规则榜。服务端要求已登录、单次 run、未结算、未过期，并以服务器起始时间限制可提交的得分；这能阻止直接向任意榜单写任意高分。题库仍在浏览器本地生成，因此它不是赛事级反作弊；如需更强保证，下一阶段应把出题种子和逐题判定迁到服务端。
