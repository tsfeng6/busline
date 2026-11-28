# EdgeOne 上传网关迁移

网站和共享线路读取继续使用 GitHub Pages。此网关只接收用户已确认提交的本地检索结果，通过 Actions 校验后写入 `busline-data`。不重复调用高德，不移动或删除已有城市数据。

## 项目部署

- Git 仓库 `tsfeng6/busline`，分支 `main`，Node 22。
- 框架 Vite，根目录 `./`，输出 `dist`。
- 推荐安装命令 `npm ci`、构建命令 `npm run build:vite`。现有 Bun 配置如能构建也可使用。
- `cloud-functions/[[gateway]].ts` 是 Node 云函数入口；`edgeone/city-gateway/handler.ts` 为后端逻辑。
- 仅使用 Blob SDK `@edgeone/pages-blob`，无需手动创建 KV 或 Blob 绑定。首次写入创建 `busline-city-uploads`。
- 所有控制数据、分片和清单使用强一致读取。浏览器只拿到单次上传的随机凭据，永远不拿到 GitHub Token 或回调密钥。

Production 环境变量（不得使用 `VITE_` 前缀）：

| 名称 | 值 |
|---|---|
| `GITHUB_DISPATCH_TOKEN` | 仅目标仓库的 Actions 读写 Token |
| `CALLBACK_SECRET` | 与 GitHub Actions Secret `CITY_UPDATE_CALLBACK_SECRET` 一致 |
| `RATE_LIMIT_SALT` | 独立随机盐 |
| `GITHUB_REPO` | 可选，默认 `tsfeng6/busline` |
| `GITHUB_WORKFLOW_REF` | 可选，默认 `main` |
| `ALLOWED_ORIGINS` | 可选，默认 `https://busline.cc,https://www.busline.cc` |

保存变量后重新部署。新增函数必须在构建部署中显示，只有前端部署成功不代表后端可用。

## 北京实时公交试点

试点的网页入口已移除。以下是 F28 和 F86 主线四个行驶方向的网关接口记录。

网关通过 EdgeOne 服务端变量 `BEIJING_REALTIME_FEED_URL` 读取获网站展示授权的 HTTPS JSON 数据源。数据源需要 Bearer 认证时，网关使用 `BEIJING_REALTIME_FEED_TOKEN`。数据源未配置时，接口返回 `unconfigured`。

对接层把数据方的线路方向 ID 映射到巴士线路图的 ID，并把坐标转换到高德底图使用的 GCJ‑02。以下字段为网关所需的数据格式：

| 字段 | 含义 |
|---|---|
| `source` | 页面显示的数据来源名称 |
| `positions[].routeId` | F28 `110100015388`（社科大良乡 → 周庄村南）、`110100016246`（反向），F86 `900000220963`（官道西 → 悦都新苑）、`900000220962`（反向） |
| `positions[].id` | 数据方的车辆标识，用于合并同一车辆的多条记录 |
| `positions[].lng`、`positions[].lat` | GCJ‑02 经度、纬度，均为数字 |
| `positions[].observedAt` | 数据方实际测得车辆位置的 Unix 时间戳，单位毫秒 |

网关只返回当前线路方向的有效位置、定位时间、临时标识和来源名称。对接前可向[车来了交通数据合作](https://www.chelaile.net.cn/web/aboutus)确认线路覆盖、刷新频率、署名和网页展示条件。

调研参考了 [chelaile-api-collect](https://github.com/afterglowsdev/chelaile-api-collect) 的公开说明。该仓库采用 [MIT 许可](https://github.com/afterglowsdev/chelaile-api-collect/blob/main/LICENSE)。此实现独立编写，未引入该仓库的代码、资源或非官方 H5 签名和解密逻辑。运营数据的授权与署名依数据提供方协议执行。

## 切换步骤

1. 保持网站 DNS、GitHub Pages 和旧 Worker 不变，先部署新函数。
2. 通过项目域名的 `/health` 检查返回 `platform: "edgeone"`、`configured: true`；此接口不返回密钥。
3. 为上传服务配置单独域名，例如 `upload.busline.cc`。使用平台要求的 CNAME，域名在 Spaceship 设置；该记录不经过 Cloudflare 代理。未备案时选择全球（不含中国大陆）区域，是否满足大陆访问需求仍须实测，不能仅凭区域名称判断。
4. 确认上传域名可访问，再在 GitHub 仓库 Variables 修改：
   - `CITY_UPDATE_GATEWAY_URL` = 新上传域名的 HTTPS 根地址（Actions 回调与下载）
   - `VITE_CITY_UPDATE_GATEWAY_URL` = 相同地址（网站提交与轮询）
5. 重新运行 Deploy to GitHub Pages，以便前端构建使用新变量。EdgeOne 项目因导入主仓库会跟随 main 自动部署，但正式网站仍由 GitHub Pages 提供。
6. 浏览器本地检索 -> 确认上传 -> Actions 成功 -> 数据分支出现新版本 -> Pages 更新。确认精度、历史保留5份和大陆直连均正常后，才关闭旧 Worker。

切换前先等待旧网关的进行中任务结束，因为 Actions 使用仓库的当前回调变量。不要在活动任务中途修改回调地址或密钥。

## 接口与边界

兼容现有 `/uploads`、`/uploads/:id/chunks/:n`、`/uploads/:id/complete`、`/uploads/:id`、`/jobs/:id`、`/jobs/callback`。不提供 `/jobs` 后台高德采集接口或共享数据代理。

- 分片256KiB，协议上限1GiB；实际能否提交受平台剩余存储、操作次数、函数执行时间和网络限制。免费版总存储并非每个上传各有1GiB，不保证免费额度能容纳任意1GiB文件。
- 会话2小时过期；完成/取消时清理最多64个分片，其余由后续创建上传时的过期/终态扫描逐步清理。无后续流量时不会自动唤醒清理。任务状态和限流元数据也会占少量持久存储，需定期关注控制台用量。
- 不读取整市文件到云函数内存；Actions 流式校验文件长度和哈希后再发布。
- Blob SDK 不提供可靠 compare-and-swap，不能充当分布式事务锁。实例内串行化、每IP每分钟一次、8任务/1.5GiB预留检查均为尽力限制；跨实例并发可能超出。不能据此声称严格的全局限流或恰好一次 dispatch。重复任务仍受 GitHub 原子提交与内容去重保护，不重复查高德。
- 正式对大量匿名访问开放前，在 EdgeOne 安全防护中配置 `/uploads` 的请求频率保护，控制台核实实际可用能力后设置。
- 保留管理员审核/源数据核验的原有边界：客户端上传的数据并非独立核实的全市全集。

## 验证与回滚

`npm run test:edgeone` 覆盖浏览器上传、HMAC下载、坐标精度、缺片、长度、哈希篡改、跨域、鉴权、状态回调、重试、过期与失败；不使用真实密钥，也不调用高德或真实 Actions。

`npm run lint:edgeone` 检查实际函数入口和 SDK 类型。`npm run test:city-data`、`npm run lint`、`npm run build:vite` 检查原功能。

需线上验证：平台 SDK 凭据注入、云函数运行、Blob首次写入、GitHub真实dispatch/下载/回调、上传域名大陆直连。上线切换前不能将这些标记为完成。

回滚只需将两个 GitHub Variables 恢复旧 Worker 地址并重新部署 Pages。`busline-data` 和共享静态文件无需回退；旧 Worker 在迁移验收前保留。
