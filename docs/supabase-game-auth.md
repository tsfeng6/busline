# Supabase 账号与小游戏排行榜配置

1. 在**已创建的** Supabase 项目的 SQL Editor 执行 [`supabase-game-auth.sql`](./supabase-game-auth.sql)。脚本只增加小游戏和微信账号表，不触碰公交城市数据。
2. 在 Authentication 的 URL Configuration 添加正式网站地址（例如 `https://busline.cc`）；本方案不启用手机号或邮箱登录。
3. 在 EdgeOne Pages 的 Production 环境变量中填写（均不使用 `VITE_` 前缀）：
   - `SUPABASE_URL`：项目 URL，例如 `https://xxxx.supabase.co`
   - `SUPABASE_ANON_KEY`：Supabase 的 anon/publishable key。它只保存在 EdgeOne，用于代理认证和受 RLS/RPC 约束的请求；不要填写 service_role key，也不要把它或任何密钥写入前端。
   - `ALLOWED_ORIGINS`：保留现有域名并按需加入预览域名。
4. 前端构建变量填写 `VITE_GAME_GATEWAY_URL` 为同一个 EdgeOne 网关 HTTPS 地址，再重新部署前端；此变量只是网关地址，不含任何密钥。未填写时，小游戏照常离线运行，账号和排行榜显示为未启用。
5. 如需使用隐藏管理员测试入口，在同一 EdgeOne Pages Function 配置服务端变量 `ADMIN_PASSWORD`（按管理员约定的密钥填写）与随机的 `ADMIN_SESSION_SECRET`。两者都不能使用 `VITE_` 前缀，也不能写进前端或仓库。管理员校验会通过游戏网关而非静态网站的 `/api` 路径完成。

网关继续保留原 `/uploads` 与 GitHub Actions 写入流程。账号接口使用 `/game-auth/*`、`/ranked-game-runs*` 和 `/contest-leaderboards`，与城市上传的 GitHub Token、Blob 存储和回调密钥完全分离。

巴士竞猜的入口为 `/game`。模拟与竞赛使用相同的标签和计分规则。模拟在浏览器内处理题面、判题与结算，竞赛需登录并使用独立积分榜。线路与站名各有北京、上海榜，城市为全国榜，县城按省份分榜。每位玩家仅保留个人最高分。同分时，较早达成者排在前面。

网关从已发布的线网生成题目并按组校验标签。浏览器在结算前取得题面、选项和按需揭示的提示。数据库记录题序、计时、倍率积分和答题结果。历史天梯数据保留在原表。竞赛停赛名单由数据库管理员维护在 `game_contest_suspensions`，加入名单后，账号无法继续竞赛且其排名暂时隐藏。

## 微信公众号账号

在同一个 EdgeOne Pages Function 的 Production 环境变量中追加（全部为服务端变量）：

- `SUPABASE_SECRET_KEY`：供微信账号和竞赛服务端计分使用的 Supabase `sb_secret_...` key。绝不能使用 `VITE_` 前缀或提交到仓库。旧的 `SUPABASE_SERVICE_ROLE_KEY` 仍可作为兼容回退，但优先使用新版 Secret key。
- `WECHAT_CALLBACK_TOKEN`：自行生成至少 16 个随机字符；在微信公众平台“基本配置”的 Token 填入完全相同的值。
- `WECHAT_APP_ID`、`WECHAT_APP_SECRET`：公众号开发者凭据，仅用于首次注册时读取已关注用户的微信昵称和头像；AppSecret 不得进入浏览器、仓库或聊天记录。
- `PUBLIC_APP_URL`：正式前端 HTTPS 地址，例如 `https://busline.cc`。
- `PUBLIC_GATEWAY_URL`：本 EdgeOne Function 的正式 HTTPS 地址，例如 `https://gateway.busline.cc`。

在 Supabase Authentication 的 URL Configuration / Redirect URLs 中加入 `PUBLIC_APP_URL/?wechat=logged-in`。部署前端时仍只需要公开 `VITE_GAME_GATEWAY_URL=PUBLIC_GATEWAY_URL`，不要公开任何上述密钥。

然后在微信公众号后台将“服务器地址(URL)”配置为 `PUBLIC_GATEWAY_URL/wechat/callback`，Token 使用 `WECHAT_CALLBACK_TOKEN`，消息加解密方式选“明文模式”。当前实现不处理安全模式的 `Encrypt` 载荷；如后台强制安全模式，需要再提供 EncodingAESKey 和 AppID 后才能启用。公众号还必须具备接收普通消息并被动回复的权限。

网页右上角头像是唯一的账户入口。登录框显示固定的公众号二维码：用户扫描并关注公众号后发送“账户登录”。已注册用户会在公众号收到 5 分钟有效的 8 位网页登录码，将它填回网页即可登录；首次用户则会收到 15 分钟有效的一次性注册链接。用户也可直接发送“账户注册”取得注册链接。注册页要求登录账号、昵称和两次相同的密码；头像为可选项，未上传时网站使用昵称首汉字或前两个英文字母作为默认头像。密码只提交给 Supabase Auth，网关不会记录明文密码，之后也可使用“登录账号 + 密码”登录。

页面只用短期回调凭据建立 `busline_game_session` 的 `Secure`、`HttpOnly`、`SameSite=Lax` Cookie，随即清除地址栏片段；后续请求不在 URL、localStorage 或 sessionStorage 保存登录令牌。Cookie 默认一小时有效，刷新页面可恢复登录，退出登录会清除 Cookie。手机号和邮箱不会出现在用户界面；系统仅为 Supabase 身份内部使用不可投递的地址，用户无法通过它登录。游客可直接开始小游戏，个人最佳成绩保存在本机。只有开局时已建立排行榜会话的对局才会提交成绩。

此模式不依赖“带参数二维码”，个人订阅号可用；它只要求公众号能将普通文字消息推送到已配置的服务器地址，并在微信后台使用**明文模式**。`WECHAT_APP_ID` 与 `WECHAT_APP_SECRET` 仅用于尝试预填写微信昵称，缺失或没有用户资料权限时会自动使用默认昵称，不会阻止注册或登录。

## 服务端计分上线

1. 在已有游戏账号数据库执行 [supabase-ranked-game.sql](supabase-ranked-game.sql)。新项目先执行 [supabase-game-auth.sql](supabase-game-auth.sql)。
2. 部署 EdgeOne 网关与前端。网关沿用现有的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`，并需要服务端专用的 `SUPABASE_SECRET_KEY`（或旧版 `SUPABASE_SERVICE_ROLE_KEY`）及 `PUBLIC_APP_URL`。`PUBLIC_APP_URL` 应指向已发布城市快照的 Busline 网站。
3. 以已登录账号开始计分对局，核对答错和超时后可复盘，以及榜单分数由已判定答题结果决定。之后也可进入「模拟」验证本地模式。

迁移会关闭旧的客户端总分接口。迁移和部署之间，旧版页面可能暂时无法写入排行榜。历史成绩保留。临时题目及结算结果供本局复盘和重试，过期后由后续开局清理。
