# Supabase 账号与小游戏排行榜配置

1. 在**已创建的** Supabase 项目的 SQL Editor 执行 [`supabase-game-auth.sql`](./supabase-game-auth.sql)。脚本只增加小游戏和微信账号表，不触碰公交城市数据。
2. 在 Authentication 的 URL Configuration 添加正式网站地址（例如 `https://busline.cc`）；本方案不启用手机号或邮箱登录。
3. 在 EdgeOne Pages 的 Production 环境变量中填写（均不使用 `VITE_` 前缀）：
   - `SUPABASE_URL`：项目 URL，例如 `https://xxxx.supabase.co`
   - `SUPABASE_ANON_KEY`：Supabase 的 anon/publishable key。它只保存在 EdgeOne，用于代理认证和受 RLS/RPC 约束的请求；不要填写 service_role key，也不要把它或任何密钥写入前端。
   - `ALLOWED_ORIGINS`：保留现有域名并按需加入预览域名。
4. 前端构建变量填写 `VITE_GAME_GATEWAY_URL` 为同一个 EdgeOne 网关 HTTPS 地址，再重新部署前端；此变量只是网关地址，不含任何密钥。未填写时，小游戏照常离线运行，账号和排行榜显示为未启用。

网关继续保留原 `/uploads` 与 GitHub Actions 写入流程。账号接口使用 `/game-auth/*`、`/game-runs*` 和 `/leaderboards`，与城市上传的 GitHub Token、Blob 存储和回调密钥完全分离。

排行榜只接受六个真实规则组合：线路/站名各有标准和地狱两榜，城市和县城各有固定规则榜。用户通过公众号登录，可修改昵称并上传客户端压缩为 256px WebP（最大 180KiB）的头像。服务端要求已登录、单次 run、未结算、未过期，并以服务器起始时间限制可提交的得分；这能阻止直接向任意榜单写任意高分。题库仍在浏览器本地生成，因此它不是赛事级反作弊；如需更强保证，下一阶段应把出题种子和逐题判定迁到服务端。

## 微信公众号账号

在同一个 EdgeOne Pages Function 的 Production 环境变量中追加（全部为服务端变量）：

- `SUPABASE_SECRET_KEY`：仅供 `/wechat/*` 使用的 Supabase `sb_secret_...` key。绝不能使用 `VITE_` 前缀或提交到仓库。旧的 `SUPABASE_SERVICE_ROLE_KEY` 仍可作为兼容回退，但优先使用新版 Secret key。
- `WECHAT_CALLBACK_TOKEN`：自行生成至少 16 个随机字符；在微信公众平台“基本配置”的 Token 填入完全相同的值。
- `WECHAT_APP_ID`、`WECHAT_APP_SECRET`：公众号开发者凭据，仅用于首次注册时读取已关注用户的微信昵称和头像；AppSecret 不得进入浏览器、仓库或聊天记录。
- `PUBLIC_APP_URL`：正式前端 HTTPS 地址，例如 `https://busline.cc`。
- `PUBLIC_GATEWAY_URL`：本 EdgeOne Function 的正式 HTTPS 地址，例如 `https://gateway.busline.cc`。

在 Supabase Authentication 的 URL Configuration / Redirect URLs 中加入 `PUBLIC_APP_URL/?wechat=logged-in`。部署前端时仍只需要公开 `VITE_GAME_GATEWAY_URL=PUBLIC_GATEWAY_URL`，不要公开任何上述密钥。

然后在微信公众号后台将“服务器地址(URL)”配置为 `PUBLIC_GATEWAY_URL/wechat/callback`，Token 使用 `WECHAT_CALLBACK_TOKEN`，消息加解密方式选“明文模式”。当前实现不处理安全模式的 `Encrypt` 载荷；如后台强制安全模式，需要再提供 EncodingAESKey 和 AppID 后才能启用。公众号还必须具备接收普通消息并被动回复的权限。

网页右上角头像是唯一的账户入口。每次打开登录框，网关生成一个 5 分钟有效、带随机场景参数的公众号二维码；已注册用户扫码后，公众号的 `SCAN` 事件只确认该网页窗口并自动登录。首次扫码关注时，公众号发送 15 分钟有效的一次性注册链接；链接在微信内打开注册页，预填写微信昵称和头像，用户设置登录账号和两次相同的密码。密码只提交给 Supabase Auth，网关不会记录明文密码。注册完成后，原网页自动登录；之后也可使用“登录账号 + 密码”登录。

页面只用短期回调凭据建立 `busline_game_session` 的 `Secure`、`HttpOnly`、`SameSite=Lax` Cookie，随即清除地址栏片段；后续请求不在 URL、localStorage 或 sessionStorage 保存登录令牌。Cookie 默认一小时有效，刷新页面可恢复登录，退出登录会清除 Cookie。手机号和邮箱不会出现在用户界面；系统仅为 Supabase 身份内部使用不可投递的地址，用户无法通过它登录。小游戏必须已登录才能开始。

此模式需要公众号已启用“带参数二维码”和事件推送，并在微信后台使用**明文模式**；`WECHAT_APP_ID` 与 `WECHAT_APP_SECRET` 必须已配置在 EdgeOne。固定的公众号二维码无法安全地自动关联到某一个网页登录窗口，因此不能代替此临时二维码。
