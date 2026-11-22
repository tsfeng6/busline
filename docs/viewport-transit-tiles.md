# 共享公交线网按视野加载

## 分阶段实施计划

1. 发布层。固定数据分支提交，复用三种快照的读取器。按实际线路和站点位置建立全国 XYZ 瓦片索引，用跨界相交的线段裁剪而不是城市中心筛选。发布简化和精细两级瓦片，与原始快照和现有总览一起构建。
2. 加载层。视野稳定后从中心向外调度，优先加载可见瓦片，空闲后预取相邻瓦片。取消离开视野的任务，设定重试冷却、并发和解码缓存预算。将网络流的解压和记录解析放入 Worker。
3. 渲染层。保留 SDK 总览图层，精细资源到达前继续显示总览或已缓存的父瓦片。批量绘制普通线网与站点。选中线路、框选、站点通达度继续走完整线路和高层级 SDK 叠加物。
4. 业务接入。取消自动整城加载，保留显式全市检索、时间轴、离线功能与上传流程。地图交互使用瓦片中的数据来源城市。
5. 验证与交付。测试跨市合并、边界裁切、层级回退、取消和预算，使用固定数据提交复验发布，运行类型检查和构建。推送独立分支，由用户在预览中进行地图验收。

## 数据与地图

- 发布器从固定的 `busline-data` 提交读取每个城市的当前快照。它复用原版 JSON、`city-parts-v1` 和 BVPK1 解码器，生成同源 `city-data/v1/transit.json` 和 `tiles/transit-v1/`。发布仍包含原快照、历史索引、缩略图和全国总览。
- 空间索引按 GCJ-02 坐标投影到地图的 XYZ 网格。每个线段都按网格相交点切分，穿过一个瓦片的线路会入索引，即使原始采样点和首末站都在瓦片外。同一瓦片合并所有快照来源，站点和线路保留城市、方向 ID 和名称。来源城市表示线路归属的快照，线路几何可以穿过其他市。按已发布快照覆盖范围显示，快照可能仍是部分采集结果。
- 全国总览使用现有 2–13 级栅格。街区级从 13 级开始用瓦片内简化几何，15 级开始使用保留原始采样点的精细几何。两级都在瓦片边缘保留交点，显示坐标量化到 1/16 像素，原始快照和选中线路继续保留原始坐标。缩放过程由地图 SDK 保留底层总览。精细瓦片到达前可使用缓存的父瓦片，当前可见的精确级别都就绪时再淡出总览。某块暂时失败时继续显示总览并重试。栅格过级显示用高德 TileLayer 的 `dataZooms`。 [高德地图瓦片图层参数](https://lbs.amap.com/api/maps-javascript-api/reference/layer/tilelayer)
- 每个网络包覆盖一组相邻瓦片，13 级是 4×4，15 级是 8×8。索引记录占用位图和内容摘要，最大的网络包限制为 2 MiB。包头定位单块 gzip 流，Worker 只流式解压和解析当前请求的瓦片，将坐标数组转移给地图。包请求合并且支持取消，压缩包缓存 4 MiB。解码缓存按设备预算 12 或 28 MiB，分别并发 3 或 5 项。移动时暂停安排新任务，视野稳定后优先处理中心的可见瓦片，随后预取一圈相邻瓦片。站点和同色线路在 Canvas 内批量绘制。
- 单线、框选及站点通达度使用高层级地图叠加物，路径来自完整线路。在已有快照可用时按来源城市读取，缺少对应线路则走原有高德查询。缩放只影响背景瓦片和普通站点。时间轴、显式全市检索、历史和小游戏保留原来的快照能力。日常定位的附近线路首次读取 15 级瓦片，用户可在旧发布上主动重试以继续使用旧数据接口。

## 构建与自动化验证

使用 Node 22。静态发布器保留现有 900 MiB 总量预算。GitHub Pages 从主线部署到 `gh-pages`，Vercel 的分支预览和生产构建均通过同一个发布器生成数据。 [GitHub Pages 容量限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

```bash
npm ci
node --import tsx --test tests/*.test.ts
npm run lint
npm run lint:gateway
npm run lint:edgeone
npm run build
```

要用正式数据本地预览，在项目目录运行下列命令。发布脚本获取最新的 `busline-data` 数据，输出到被 Git 忽略的 `public/city-data`。高德本地域名授权、前端 Key 和 Security Code 按仓库的 `.env.example` 配置。

```bash
node --import tsx scripts/publish-city-static.ts
VITE_CITY_DATA_ENABLED=true npm run build:vite
npm run preview
```

也可只生成指定数据提交的静态文件，此方式适合对照本次交界样本。

```bash
git fetch origin busline-data
node --import tsx --input-type=module <<'JS'
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mirrorCitySnapshots } from './scripts/publish-city-static.ts';
const output = await mkdtemp(join(tmpdir(), 'busline-review-'));
console.log(output, await mirrorCitySnapshots('3c1408868f07054edecfdff7223561a189772913', output));
JS
```

## 用户验收

1. 在分支预览打开北京，先在市域尺度看总览，再放大到市中心。若使用浏览器的网络面板，应看到总览和少量随视野变化的 `.pack` 请求。普通浏览和自动定位应只请求空间瓦片及目录，显式查看完整线路、时间轴或全市检索才需要相应快照。
2. 把地图移动到约东经 116.164、北纬 39.491，沿京冀交界平移并放大。固定数据提交中，15 级的 `15/26957/12465` 同时收到北京、保定和廊坊的线路。可再对照 `116.175, 39.559`。若需要精确设置本地视图，可在预览页控制台运行下面的代码后刷新。
3. 连续跨过 13 级和 15 级来回缩放。用慢速网络、触屏和低性能手机复测。检查总览到街区详图的衔接、加载中移动到另一处时的取消行为，以及回到加载过的区域时的缓存复用。
4. 在地图点选站点和一条线路，缩至全国尺度查看选中线路。再分别查询站点和框选区域的通达度，缩放并平移，确认分析线路在返回其地理范围时依然显示。检查只显示终点站、线路关键词过滤和站点卡片。
5. 按日常流程打开附近线路、时间轴和城市历史，另测一次显式检索。共享快照、已设置的城市数据和新提交仍走已有发布流程。

```js
localStorage.setItem('map_center', JSON.stringify([116.16394, 39.491324]));
localStorage.setItem('map_zoom', '15');
location.reload();
```

自动化测试和数据发布验证覆盖数据、调度和构建。实际地图观感、低端手机顺畅度及线上交互由用户验收。

## 验证记录（2026-11-22）

- 主线合并：PR #6（`01f9375`）的测试、类型检查、生产构建和 GitHub Pages 部署均通过。
- 发布数据：`gh-pages` 的 `city-data/v1/transit.json` 为 schema 1、revision `3c1408868f07054edecfdff7223561a189772913`、9028 个网络包；生产 `https://busline.cc/city-data/v1/transit.json` 返回同一 revision。
- 交界样本：`15/26957/12465`（包 `15/3369/1558` 的 slot 13）解出 4 条线路、3 个站点，来源城市包含北京市、保定市、廊坊市。
- 自动化：本机 Node v24.22.1 执行 `node --import tsx --test tests/*.test.ts` 为 136 项、通过 129、跳过 7、失败 0；`npm run lint`、`npm run lint:gateway`、`npm run lint:edgeone`、`npm run build` 均通过。CI 固定 Node 22，PR #6 的同一测试命令已通过。
- 浏览器实测（生产与本地构建）：15 级视野下 CustomLayer Canvas 有绘制像素，Worker 会请求对应 `.pack`（DevTools 不会列出 Worker 内部的 fetch）。
- 检索实测（2026-11-22）：生产公共 AMap Key 返回 `USER_DAILY_QUERY_OVER_LIMIT`；换用独立测试 Key 构建本地版本后，线路“1路”与地名“天安门”的建议、结果均正常。代码已补充 AutoComplete / PlaceSearch 的配额错误提示。
- 未验证：真实低端手机与触屏体验、受登录保护的 Vercel 分支预览、长时间缓存与弱网抖动下的恢复表现。
