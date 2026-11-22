# 当前使用流程：本地检索，确认后提交

1. 网站优先读取同域城市 JSON。没有数据或超过两个月时提示用户检索。
2. 用户点击后在浏览器执行原有全市检索并绘图，不需要先取得远端凭据，也不自动启动 Actions 采集。
3. 本地检索完成后询问“是否将此结果提交到远端？”。暂不提交不会产生上传请求。开启线路过滤的结果不能作为全市共享数据上传。
4. 用户明确提交后，Worker 将无损压缩的逐条记录以256KiB片段暂存在现有 D1。凭据仅限本次上传，2小时内有效；完整上传后等待任务有效期2小时。最多8个临时上传任务，单份最大1GiB（界面标注1GB），所有临时任务合计最多1.5GiB。
5. Actions 通过签名请求下载、核对 SHA-256、城市、结构、时间和覆盖规模，并写入 GitHub。此路径不会再次调用高德。完成或过期的片段会清理。
6. 保存后自动发布网站同域 JSON。上传或保存失败不清除本地地图，可从设置中的上传图标再次提交。

上传不需要新增 Cloudflare 服务。Worker 首次接收上传时会自动建立两张临时表。现有 GitHub 令牌和回调密钥继续使用。原 Actions 直接采集模式保留为手动维护/诊断用途，不再由网站检索按钮自动触发。

上传入口目前仍为现有 Worker；网络无法访问入口时，本地检索照常进行，提交会单独提示失败。用户可以导出 JSON 保留结果。

---

# 城市共享线路：Worker + GitHub Actions 部署

网站只提交城市名称。Worker 合并任务、限流并触发 Actions；Actions 查询高德、校验数据，将最新快照和历史 JSON 写到 `busline-data` 分支。其他访客直接读取有效快照，无需 GitHub 账号，也无需提交 Issue。

Worker 已在 Cloudflare 创建并部署实际代码：`https://busline-city-gateway.hextyrz.workers.dev`。D1 数据库 `busline-city-jobs`、两张任务表、`JOBS` 绑定和五项公开运行参数均已配置。只读线上测试返回“没有找到此更新任务”，已验证 Worker 到任务表连通。GitHub 令牌、回调密钥、限流盐及 GitHub Actions 配置仍未完成；尚未进行真实采集和端到端联调。需要 Cloudflare 账号、Worker、一个 D1 小表，以及 GitHub 的配置。D1 仅存任务状态和限流记录，不存公交线路；不需要购买常驻服务器。实际费用和可用性取决于服务商套餐及访问量，国内访问应上线实测。

## 1. 先将代码推送到 main

仓库必须包含 `.github/workflows/update-city-data.yml`，并启用 GitHub Actions。任务使用临时 `GITHUB_TOKEN` 写数据分支，不需要长期的仓库 Contents 写入令牌。数据分支首次发布时自动创建。

## 2. 创建任务表

在项目根目录执行：

```sh
npx wrangler login
npx wrangler d1 create busline-city-jobs
```

将返回的数据库 ID 填入 `cloudflare/city-gateway/wrangler.jsonc` 的 `database_id`。然后执行：

```sh
npx wrangler d1 execute busline-city-jobs --remote --file cloudflare/city-gateway/schema.sql --config cloudflare/city-gateway/wrangler.jsonc
```

配置中的 `ALLOWED_ORIGINS` 默认只允许 `https://busline.cc`。需要 www 域名或本地联调时，按逗号分隔添加精确来源，例如 `http://localhost:3000`。

## 3. 设置 Worker 密钥并部署

在 GitHub 创建仅授权 `tsfeng6/busline`、具有 **Actions: write** 权限的 fine-grained token。此令牌只用于触发固定工作流，不需要 Contents 写权限。

准备两个独立随机字符串：回调密钥至少32个字符、限流盐至少16个字符。通过交互输入保存，不要写进源码：

```sh
npx wrangler secret put GITHUB_DISPATCH_TOKEN --config cloudflare/city-gateway/wrangler.jsonc
npx wrangler secret put CALLBACK_SECRET --config cloudflare/city-gateway/wrangler.jsonc
npx wrangler secret put RATE_LIMIT_SALT --config cloudflare/city-gateway/wrangler.jsonc
npx wrangler deploy --config cloudflare/city-gateway/wrangler.jsonc
```

记录部署后的 HTTPS Worker 地址，不带末尾斜杠。默认 workers.dev 域名在目标网络中的可达性需要验证，必要时绑定自己的域名。

## 4. 设置 GitHub Secrets 和 Variables

进入仓库 Settings → Secrets and variables → Actions。

Repository secrets：

| 名称 | 内容 |
| --- | --- |
| `AMAP_WEB_SERVICE_KEY` | 高德“Web服务”类型 Key，具备所用 POI 和公交查询权限 |
| `CITY_UPDATE_CALLBACK_SECRET` | 与 Worker 的 `CALLBACK_SECRET` 完全相同 |

网页现有的 JS API Key 不能直接假定适用于 REST 查询。请确认 Key 类型、权限、配额及安全设置适用于 Actions 运行环境。不要把密钥放到任何 `VITE_` 变量中。

Repository variables：

| 名称 | 值 |
| --- | --- |
| `CITY_UPDATE_GATEWAY_URL` | Worker 的 HTTPS 地址 |
| `VITE_CITY_DATA_ENABLED` | `true` |
| `VITE_CITY_UPDATE_MODE` | `actions` |
| `VITE_CITY_UPDATE_GATEWAY_URL` | 同一个 Worker 地址 |
| `VITE_CITY_DATA_READ_BASE_URL` | 已停用；网页只读网站同源静态 JSON |

修改前端 Variables 后重新运行网站部署工作流。这个模式不依赖旧 Express、Zeabur 或 `VITE_API_BASE_URL` 来保存城市数据。旧配置可用于其他已有功能。

## 5. 联调

1. 打开网站并放大到城市：已有两个月内有效快照时直接显示。
2. 对缺失或过期的城市点击检索：先在浏览器全市检索并显示地图；确认提交后才上传结果，Actions 校验保存，不重复查询高德。
3. 在 GitHub Actions 查看任务；完成后检查 `busline-data` 分支中的城市目录、`latest.json`、`meta.json` 与历史快照。
4. 返回该城市，确认网站从共享 JSON 绘图；用另一浏览器访问确认无需重新全市查询。

Actions 需要排队和执行时间，不能保证立即完成。关闭进度卡片不会取消后台任务。若浏览器离开或轮询中断，稍后重新访问该城市即可读取成功发布的数据。

## 额度和数据保护

当前按要求临时关闭共享城市更新的全站每日预算及单一来源每日提交限制：`DAILY_UPDATE_LIMITS_ENABLED=false`（未设置也默认关闭）。恢复时设为 `true`；`MAX_UPDATES_PER_DAY` 数值保留备用。同城任务合并、冷却、来源校验、回调签名和单任务查询上限继续有效。此开关不影响游戏每日三局限制，也不能解除高德自身配额。


- 启用每日限制时，全站每天最多发起 **1次更新任务**，同一来源每天最多3次提交尝试。同城任务合并；正常任务有效期45分钟，终态冷却10分钟。可在 Worker 配置中修改 `MAX_UPDATES_PER_DAY`，应结合实际高德账单调整。
- Actions 全局串行，单次最长30分钟；POI最多100页，线路查询最多1500次，约400毫秒间隔。单个大城市仍可能消耗较多额度；默认预算不等于保证不会超额。
- 配额或鉴权错误会停止继续批量查线；不完整结果只保留历史，不作为有效共享数据。明显缩水的数据不会覆盖已有完整快照。
- “完整”表示采集流程完整，数据仍为 `coverage: observed`，无法保证高德收录了该市所有线路。高德 REST 与网页接口的数据覆盖可能不同。
- 最新数据按北京时间两个自然月过期。单份快照上限1GiB。大快照会自动分片并无损压缩保存；静态发布总预算900MiB，接近预算时需要另设静态存储。
- Worker 通过分片接收用户明确提交的压缩线路数据；回调使用 HMAC 签名；GitHub 令牌不会进入网页。匿名入口仍需要监控滥用，预算与来源限制不等同于实名防刷。

## 失败排查

- 触发失败：确认 main 已有工作流、令牌 Actions 权限及仓库授权正确。
- 回调失败：检查两个回调密钥相同、Worker 地址正确、任务未过期。
- 无线路/权限错误：检查 Web服务 Key、服务权限和高德配额；查看任务附件 `city-update-report`，不要公开密钥或完整带 Key 的请求 URL。
- 前端仍本地检索：确认构建时传入 `VITE_CITY_UPDATE_MODE=actions` 且共享数据开关为 true。
- 发布完成但暂时读不到：可能是 GitHub/CDN 传播延迟；稍后重试。旧快照不会因此被清空。

## 2026-11-16 采集诊断与覆盖改进

两次小请求的线上诊断确认：站点搜索返回10000（正常），线路搜索返回10044（高德账号对应服务日配额超限）。此前“未取得有效线路路径”隐藏了源错误，现已保留具体错误码，零线路失败也会保存诊断报告。网站的每日名额开关不改变高德自身配额。

全市单组 POI 查询不能枚举全市：高德文档注明同参数翻页最多200条。采集器改为行政边界范围内的自适应矩形分区；密集区域继续拆分，按行政编码排除邻市站点，达到请求预算仍标注未完成。近期不完整结果中的既有线路路径可复用，减少重复逐线查询。进度分别显示候选名称数和已取得方向数，报告另列去重线路名称数。

这提高了覆盖能力，但不是全量保证；实际补全仍需高德额度恢复后验证。

参考：
- https://developer.amap.com/api/webservice/guide/api-advanced/search
- https://developer.amap.com/api/webservice/guide/tools/info

## 已有线路采用网站同域读取

网站部署时从 `busline-data` 的固定提交复制每个城市的 `latest.json`、`meta.json` 和历史索引到静态目录 `city-data/v1/`。浏览器从网站自身域名读取 `latest.json`，按清单加载 BVPK1 或原有 JSON。静态站点同步当前版本和公开历史索引引用的文件。

更新任务成功结束后调用同一份网站部署工作流，使新快照也可从网站同域读取。诊断任务不触发发布。发布脚本只复制指定 JSON 文件，不包含源码或密钥；本次静态数据发布总量设置500MiB上限，超出时停止部署而非悄悄丢弃城市。

这消除了“查看已有数据必须先连上 Worker”的依赖，但网站自身的访问质量仍取决于用户网络。发起新采集任务仍需访问 Worker，自定义域名或其他入口可后续单独配置。

### 大文件与内存
浏览器使用逐条NDJSON记录、Blob分块及有序分片摘要上传，避免一次产生全市JSON字符串及整文件字节数组。Actions 逐条解析，兼容旧 JSON 上传。新快照写为 `city-bvpk1` 清单及独立 Brotli 容器，逐分片解码校验通过后提交。当前入口与该次历史记录引用同一组不可变分片。旧单文件和旧 gzip 分片仍可读取。迁移及人工回滚见 [BVPK1 迁移与验证报告](./city-bvpk-migration.md)。上限是协议预算，并非承诺任意设备都能处理1GiB内的所有数据。

路网保留全部坐标，128段一组构建点击索引；地图SDK只接收视野内的路径块。站点只在可见区域实例化，低缩放级别按屏幕密度减少重叠符号；平移时释放视野外标记，放大后恢复，不删底层站点。

## 读取与上传分离切换

网站已经停用 Worker 的线路读取回退和 `VITE_CITY_DATA_READ_BASE_URL`。所有最新数据、历史索引、索引中记录的历史快照及引用分片，均从网站自身的 `/city-data/v1/` 读取。发布脚本固定数据分支提交进行构建，原始数据不修改、不删除。旧大文件只在静态构建中无损分片压缩。

上传和任务轮询仍使用现有网关，待 EdgeOne 的分片存储、任务状态及签名回调联调通过后再切换 `CITY_UPDATE_GATEWAY_URL` 和 `VITE_CITY_UPDATE_GATEWAY_URL`。不要提前关闭旧网关或删除临时上传任务。

验证时阻断上传域名，检查最新线路、历史列表、历史下载均只访问 `busline.cc`；不存在城市应显示未发布提示，不应发出 Worker GET 请求。`publication.json` 中的 `cities`、`historySnapshots`、`commit` 可用于核对此次静态发布。回退只需恢复前一个网站部署；GitHub 数据分支保持不变。
