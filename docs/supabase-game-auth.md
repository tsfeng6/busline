# Supabase 账号与小游戏排行榜配置

1. 在**已创建的** Supabase 项目的 SQL Editor 执行 [`supabase-game-auth.sql`](./supabase-game-auth.sql)。脚本只增加小游戏和微信账号表，不触碰公交城市数据。
2. 在 Authentication 启用 Phone 登录，配置短信服务商、发送者与短信模板；在 URL Configuration 添加正式网站地址（例如 `https://busline.cc`）。
3. 在 EdgeOne Pages 的 Production 环境变量中填写（均不使用 `VITE_` 前缀）：
   - `SUPABASE_URL`：项目 URL，例如 `https://xxxx.supabase.co`
   - `SUPABASE_ANON_KEY`：Supabase 的 anon/publishable key。它只保存在 EdgeOne，用于代理认证和受 RLS/RPC 约束的请求；不要填写 service_role key，也不要把它或任何密钥写入前端。
   - `ALLOWED_ORIGINS`：保留现有域名并按需加入预览域名。
4. 前端构建变量填写 `VITE_GAME_GATEWAY_URL` 为同一个 EdgeOne 网关 HTTPS 地址，再重新部署前端；此变量只是网关地址，不含任何密钥。未填写时，小游戏照常离线运行，账号和排行榜显示为未启用。

网关继续保留原 `/uploads` 与 GitHub Actions 写入流程。账号接口使用 `/game-auth/*`、`/game-runs*` 和 `/leaderboards`，与城市上传的 GitHub Token、Blob 存储和回调密钥完全分离。

排行榜只接受六个真实规则组合：线路/站名各有标准和地狱两榜，城市和县城各有固定规则榜。用户以手机号验证码登录，可修改昵称并上传客户端压缩为 256px WebP（最大 180KiB）的头像。服务端要求已登录、单次 run、未结算、未过期，并以服务器起始时间限制可提交的得分；这能阻止直接向任意榜单写任意高分。题库仍在浏览器本地生成，因此它不是赛事级反作弊；如需更强保证，下一阶段应把出题种子和逐题判定迁到服务端。

## 微信公众号账号

在同一个 EdgeOne Pages Function 的 Production 环境变量中追加（全部为服务端变量）：

- `SUPABASE_SECRET_KEY`：仅供 `/wechat/*` 使用的 Supabase `sb_secret_...` key。绝不能使用 `VITE_` 前缀或提交到仓库。旧的 `SUPABASE_SERVICE_ROLE_KEY` 仍可作为兼容回退，但优先使用新版 Secret key。
- `WECHAT_CALLBACK_TOKEN`：自行生成至少 16 个随机字符；在微信公众平台“基本配置”的 Token 填入完全相同的值。
- `PUBLIC_APP_URL`：正式前端 HTTPS 地址，例如 `https://busline.cc`。
- `PUBLIC_GATEWAY_URL`：本 EdgeOne Function 的正式 HTTPS 地址，例如 `https://gateway.busline.cc`。

在 Supabase Authentication 的 URL Configuration / Redirect URLs 中加入 `PUBLIC_APP_URL/?wechat=logged-in`。部署前端时仍只需要公开 `VITE_GAME_GATEWAY_URL=PUBLIC_GATEWAY_URL`，不要公开任何上述密钥。

然后在微信公众号后台将“服务器地址(URL)”配置为 `PUBLIC_GATEWAY_URL/wechat/callback`，Token 使用 `WECHAT_CALLBACK_TOKEN`，消息加解密方式选“明文模式”。当前实现不处理安全模式的 `Encrypt` 载荷；如后台强制安全模式，需要再提供 EncodingAESKey 和 AppID 后才能启用。公众号还必须具备接收普通消息并被动回复的权限。

用户发送“注册账号”“绑定账号”“免密登录”或“账号状态”即可使用。注册链接为 15 分钟、一次性令牌，数据库只保留 SHA-256 哈希；完成绑定时由已验证的 Supabase 登录态决定绑定对象，不能靠前端传入用户 ID。免密登录链接同样一次性消费，并由 EdgeOne 以 service_role 向 Supabase 生成短期 magic link；不会在公众号消息、浏览器 JavaScript 或日志中发送 service_role key。微信回调验证 SHA-1 签名、五分钟时间窗和消息去重键，以阻止伪造、重放和重复建链。
