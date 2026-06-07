# 腾讯云云函数 (Tencent Cloud SCF) 部署与免 VPN 本地访问指南

您好！关于您提到的 **“在内地只有挂 VPN 才能看到其他用户数据/页面”** 的问题，其根本原因在于：
1. **Google Cloud Run 默认域名被屏蔽**：AI Studio 部署的预览和发布地址使用的都是高等级安全域名 `https://*.run.app`，而所有 `run.app` 级别的域名在内地大都已被防火墙屏蔽，因此不挂 VPN 的设备无法成功访问。
2. **高德地图 (AMap) 本身是不受限的**：在内地完全可以秒开，唯独后端接口 `/api/*` 因为部署在 Google 环境中而受到屏蔽。

使用 **腾讯云云函数 (SCF) Web 函数** 或 **腾讯云轻量应用服务器 (Lighthouse)** 离线/在线托管此应用，即可完美解决内地免 VPN 的访问问题，在全国各地实现秒级触达！

---

## 方案一：使用腾讯云函数 (SCF) 自定义 Web 函数部署（最经济、免运维）

腾讯云 SCF 的 **Web 函数 (Web Function)** 完美支持标准 Node.js (+ Express) 全栈应用，您甚至**几乎不用修改任何一行代码**即可完成迁移。

### 1. 准备云端函数代码包
您只需打包以下文件：
- `package.json`
- `vite-api-plugin.ts`
- `vite.config.ts`
- `server.ts`
- `src/` (前端源码)
- `firebase-applet-config.json` (您已经成功在后台持有的 Firebase 代理配置，在内地云函数服务器上，直接走海外新加坡或香港节点的云函数，能够自由请求 Firebase Firestore，免去 VPN 解析阻断)

### 2. 创建腾讯云函数流程
1. 登录 [腾讯云云函数控制台](https://console.cloud.tencent.com/scf)。
2. 新建云函数：选择 **“自定义创建”**。
3. **函数类型**：选择 **Web 函数**。
4. **运行环境**：选择 **Nodejs 18.15** 或更高级版本。
5. **地域**：建议选择 **中国香港 (Hong Kong)** 或 **新加坡 (Singapore)** 节点。
   - *（核心优势）*：选择香港或新加坡节点，云函数既可以**无障碍秒级读写您的 Firestore 数据库**，又可以**在祖国内地完全免 VPN 直接连接访问**（延时极低）！
6. **执行方法**：默认使用本地端口监听。
7. **启动参数 & 端口**：
   - 腾讯云 SCF 默认将 HTTP 流量转发至本地的 **`9000`** 端口。
   - 我们的 `server.ts` 监听的是 `3000`。您既可以在创建界面的【高级设置】中把端口改成 **`3000`**，也可以使用下方的适配脚本自动转发。

### 3. SCF 专用启动入口脚本 (`app.js` 或自定义)
您可以在代码根目录下创建一个简单的 `scf-index.js` 作为腾讯云函数启动入口：

```javascript
// scf-index.js 
// 腾讯云函数 Web 函数执行入口，自动继承或代理我们的全栈服务
const { exec } = require('child_process');
console.log('正在启动全栈公交线路系统...');

// 运行我们的打包发布服务或直接转译启动
const proc = exec('npm run start', (err, stdout, stderr) => {
  if (err) {
    console.error('运行异常:', err);
  }
});

proc.stdout.on('data', (data) => console.log(data));
proc.stderr.on('data', (data) => console.error(data));
```

同时，我们通过下面这个轻量、易维护的全新独立高并发 SCF 脚本模板也可以直接单独接收前端高频提交和拉取：

---

## 方案二：编写一个完全独立的腾讯云 API 网关 + SCF 存储代码

如果您只想把**路线提交与查看业务**彻底放到腾讯云函数（而前端托管在腾讯云静态托管 (TCB)、或者是国内免备案服务器上），可以新建一个标准的事件函数，并复制以下独立代码。

它同样通过 `https://firestore.googleapis.com` 代理向 Firebase 写入和同步：

```javascript
/* 
 * 腾讯云函数精简版 - Firebase 代理函数代码 (index.js)
 * 支持免 VPN，专门在国内接收前端的线路上传和状态拉取。
 */
const https = require('https');

// 从腾讯云函数环境变量 (Environment Variables) 或下方硬编码中读取配置
const PROJECT_ID = process.env.PROJECT_ID || "vocal-module-6rtgb";
const DATABASE_ID = process.env.DATABASE_ID || "ai-studio-357e0eaa-6a2d-42a4-9d4b-f24ccc603c3f";
const API_KEY = process.env.API_KEY || "AIzaSyAvxQWz08SxPaow_ARUfHhKO-SHCP9OvAw";

const FIREBASE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

exports.main_handler = async (event, context) => {
  const path = event.path || '';
  const method = event.httpMethod || 'GET';
  
  // 跨域头设置 (CORS)
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With'
  };

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    // 1. 获取所有已批准的线路列表
    if (path.includes('/submissions/approved')) {
      const url = `${FIREBASE_BASE_URL}/submissions?pageSize=1000&key=${API_KEY}`;
      const firestoreData = await httpRequest(url, 'GET');
      const docs = firestoreData.documents || [];
      
      const lines = docs
        .map(fromFirestore)
        .filter(line => line && line.status === 'approved')
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(lines)
      };
    }

    // 2. 提交新线路
    if (path.includes('/submissions/submit') && method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { id, name, creatorNickname, city, district, path: linePath, via_stops, status, timestamp } = body;
      
      if (!id || !name || !creatorNickname || !city) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing parameters' })
        };
      }

      const fileId = id.replace(/[^a-zA-Z0-9_\-]/g, '');
      const rawData = {
        id: fileId,
        name,
        creatorNickname,
        city,
        district: district || '',
        path: linePath || [],
        via_stops: via_stops || [],
        status: status || 'pending',
        timestamp: timestamp || Date.now()
      };

      const firestoreDoc = toFirestore(rawData);
      const url = `${FIREBASE_BASE_URL}/submissions/${fileId}?key=${API_KEY}`;
      await httpRequest(url, 'PATCH', firestoreDoc);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Submitted successfully' })
      };
    }

    // 3. 拉取路线审核状态
    if (path.includes('/submissions/status')) {
      const selectIdsStr = event.queryString && event.queryString.ids ? event.queryString.ids : '';
      if (!selectIdsStr) {
        return { statusCode: 200, headers, body: '{}' };
      }

      const ids = selectIdsStr.split(',').map(s => s.replace(/[^a-zA-Z0-9_\-]/g, ''));
      const statuses = {};

      await Promise.all(ids.map(async (fileId) => {
        try {
          const url = `${FIREBASE_BASE_URL}/submissions/${fileId}?key=${API_KEY}`;
          const doc = await httpRequest(url, 'GET');
          const simple = fromFirestore(doc);
          statuses[fileId] = simple.status || 'pending';
        } catch (ex) {
          statuses[fileId] = 'rejected';
        }
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(statuses)
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Endpoint Not Found' })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// 网络请求基础工具
function httpRequest(url, method, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve({});
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

// 转换函数
function fromFirestore(doc) {
  if (!doc) return null;
  const result = {};
  const fields = doc.fields || {};
  for (const [key, valObj] of Object.entries(fields)) {
    result[key] = readValue(valObj);
  }
  return result;
}

function readValue(valObj) {
  if (!valObj) return null;
  if ('stringValue' in valObj) return valObj.stringValue;
  if ('integerValue' in valObj) return parseInt(valObj.integerValue, 10);
  if ('doubleValue' in valObj) return parseFloat(valObj.doubleValue);
  if ('booleanValue' in valObj) return valObj.booleanValue;
  if ('arrayValue' in valObj) {
    const values = valObj.arrayValue.values || [];
    return values.map(readValue);
  }
  if ('mapValue' in valObj) {
    const fields = valObj.mapValue.fields || {};
    const res = {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = readValue(v);
    }
    return res;
  }
  return null;
}

function toFirestore(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    const fVal = toValue(value);
    if (fVal !== undefined) fields[key] = fVal;
  }
  return { fields };
}

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toValue).filter(v => v !== undefined) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      const fv = toValue(v);
      if (fv !== undefined) fields[k] = fv;
    }
    return { mapValue: { fields } };
  }
  return undefined;
}
```

---

## 方案三：直接在一台最简易的腾讯应用服务器 (Lighthouse) 运行全栈包
您只需在一台轻量服务器上，通过：
1. `git clone` 或是上传打包解压。
2. 安装环境：`npm install`
3. 打包前端代码：`npm run build`
4. 启动服务：`npm run start` 

最后搭配自有的非屏蔽域名做一次 Nginx 转发，即可在内地无感知、无阻碍地秒开使用！
