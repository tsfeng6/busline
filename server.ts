import { handleCityDataRequest } from './src/server/cityData';
import { runBuslineAI } from './src/server/buslineAI';
import express from 'express';
import cors from 'cors';
import path from 'path';
import axios from 'axios';
import { db, runMigration } from './src/db/index';
import { submissions, appSettings } from './src/db/schema';
import { eq, inArray, desc } from 'drizzle-orm';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

async function startServer() {
  const app = express();
  
  // Self-healing Port Selection:
  // On Zeabur, we must bind to process.env.PORT so the proxy can reach our container.
  // On AI Studio, the internal proxy strictly expects port 3000 even if process.env.PORT is injected as 8080.
  let PORT = Number(process.env.PORT) || 3000;
  if (process.env.APP_URL && (process.env.APP_URL.includes('run.app') || process.env.APP_URL.includes('aistudio'))) {
    PORT = 3000;
  }

  try {
    await runMigration();
  } catch (e) {
    console.error('Migration failed:', e);
  }

  // Middleware
  app.use(cors());
  app.use('/api/city-data', express.json({ limit: '1gb' }), async (req, res) => {
    const result = await handleCityDataRequest(req.method, '/api/city-data' + req.path, req.body, String(req.headers['x-admin-password'] || ''), String(req.headers['x-city-refresh-token'] || ''));
    res.status(result.status).json(result.body);
  });

  app.use(express.json({ limit: '10mb' })); // Increase limit for Base64 image payload

  // The password is deliberately server-only. Configure ADMIN_PASSWORD in the
  // deployment environment; never provide a fallback or put it in frontend code.
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  // A deployment should set this too. A process-local fallback keeps development
  // usable while invalidating admin sessions on a restart.
  const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString('base64url');
  const ADMIN_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
  const adminLoginAttempts = new Map<string, { count: number; resetAt: number }>();

  const createAdminSession = () => {
    const payload = Buffer.from(JSON.stringify({ issuedAt: Date.now() })).toString('base64url');
    const signature = createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  };

  const hasValidAdminSession = (value: unknown) => {
    if (typeof value !== 'string') return false;
    const [payload, signature, ...rest] = value.split('.');
    if (!payload || !signature || rest.length > 0) return false;
    const expected = createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('base64url');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return false;
    try {
      const { issuedAt } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return Number.isFinite(issuedAt) && issuedAt <= Date.now() && Date.now() - issuedAt < ADMIN_SESSION_TTL_MS;
    } catch {
      return false;
    }
  };

  const getLoginAttempt = (req: express.Request) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const existing = adminLoginAttempts.get(ip);
    if (!existing || existing.resetAt <= now) {
      const next = { count: 0, resetAt: now + 15 * 60 * 1000 };
      adminLoginAttempts.set(ip, next);
      return next;
    }
    return existing;
  };

  // Server-side authentication middleware
  const verifyAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const session = req.headers['x-admin-session'];
    if (!hasValidAdminSession(session)) {
      return res.status(401).json({ error: 'Unauthorized: Admin authorization required.' });
    }
    next();
  };

  // API: Validate admin password securely on the server
  app.post('/api/admin/verify', (req, res) => {
    const attempt = getLoginAttempt(req);
    if (attempt.count >= 5) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!ADMIN_PASSWORD) {
      console.error('ADMIN_PASSWORD is not configured; admin login is disabled.');
      return res.status(503).json({ error: 'Admin login is not configured.' });
    }
    if (password !== ADMIN_PASSWORD) {
      attempt.count += 1;
      return res.status(401).json({ error: 'Incorrect admin password.' });
    }
    adminLoginAttempts.delete(req.ip || req.socket.remoteAddress || 'unknown');
    res.json({ success: true, sessionToken: createAdminSession(), expiresIn: ADMIN_SESSION_TTL_MS });
  });

  // API: Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', storage: 'postgresql' });
  });

  // GET a setting
  app.get('/api/settings/wechat_qr', async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) {
        return res.json({ key: 'wechat_qr', value: '', updatedAt: Date.now() });
      }
      const result = await db.select()
        .from(appSettings)
        .where(eq(appSettings.key, 'wechat_qr'))
        .limit(1);

      if (result.length > 0) {
        res.json({
          key: result[0].key,
          value: result[0].value,
          updatedAt: result[0].updatedAt.getTime(),
        });
      } else {
        res.json({ key: 'wechat_qr', value: '', updatedAt: Date.now() });
      }
    } catch (err: any) {
      console.warn('Get setting DB query warning (using fallback):', err.message);
      res.json({ key: 'wechat_qr', value: '', updatedAt: Date.now() });
    }
  });

  // UPDATE a setting (requires admin password verification)
  app.post('/api/settings/wechat_qr', verifyAdmin, async (req, res) => {
    try {
      const { value } = req.body;
      if (!value) {
        return res.status(400).json({ error: 'Value is required' });
      }

      await db.insert(appSettings).values({
        key: 'wechat_qr',
        value,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value,
          updatedAt: new Date(),
        }
      });

      res.json({ success: true, message: 'WeChat QR code updated successfully' });
    } catch (err: any) {
      console.error('Update setting error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Helper to sanitize filename
  const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_\-]/g, '');

  // API 1: Submit a line
  app.post('/api/submissions/submit', async (req, res) => {
    try {
      const { id, name, creatorNickname, city, district, path: linePath, via_stops, status, timestamp, dataSourceText, dataSourceImage } = req.body;
      if (!id || !name || !creatorNickname || !city) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const fileId = sanitizeId(id);
      
      try {
        await db.insert(submissions).values({
          id: fileId,
          name,
          creatorNickname,
          city,
          area: district || '',
          path: linePath || [],
          via_stops: via_stops || [],
          status: status || 'pending',
          dataSourceText: dataSourceText || null,
          dataSourceImage: dataSourceImage || null,
          timestamp: new Date(timestamp || Date.now())
        }).onConflictDoUpdate({
          target: submissions.id,
          set: {
            name,
            creatorNickname,
            city,
            area: district || '',
            path: linePath || [],
            via_stops: via_stops || [],
            status: status || 'pending',
            dataSourceText: dataSourceText || null,
            dataSourceImage: dataSourceImage || null,
            timestamp: new Date(timestamp || Date.now())
          }
        });
      } catch (dbErr: any) {
        if (!process.env.DATABASE_URL) {
           return res.status(500).json({ error: 'Database not configured. Please set DATABASE_URL in environment.' });
        }
        throw dbErr;
      }
      
      res.json({ success: true, message: 'Submitted successfully, awaiting audit.' });
    } catch (err: any) {
      console.error("Submit error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API 2: Get status of multiple submissions
  app.get('/api/submissions/status', async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) return res.json({});
      const idsStr = req.query.ids as string;
      if (!idsStr) {
        return res.json({});
      }

      const ids = idsStr.split(',').map(sanitizeId);
      const statuses: Record<string, string> = {};

      if (ids.length > 0) {
        const results = await db.select({ 
          id: submissions.id, 
          status: submissions.status,
          rejectReason: submissions.rejectReason 
        })
          .from(submissions)
          .where(inArray(submissions.id, ids));
          
        results.forEach(row => {
          statuses[row.id] = row.status;
          if (row.rejectReason) {
            statuses[row.id + '_reason'] = row.rejectReason;
          }
        });
      }

      // Fill in rejected for those not found
      ids.forEach(id => {
        if (!statuses[id]) {
          statuses[id] = 'rejected';
        }
      });

      res.json(statuses);
    } catch (err: any) {
      console.warn("Status DB query warning (using empty fallback):", err.message);
      res.json({});
    }
  });

  // API 3: Get all approved lines
  app.get('/api/submissions/approved', async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) return res.json([]);
      const lines = await db.select()
        .from(submissions)
        .where(eq(submissions.status, 'approved'))
        .orderBy(desc(submissions.timestamp));

      // Map back area to district for frontend compatibility
      const mappedLines = lines.map(line => ({
        ...line,
        district: line.area,
        timestamp: line.timestamp.getTime()
      }));

      res.json(mappedLines);
    } catch (err: any) {
      console.warn("Approved list DB query warning (using empty fallback):", err.message);
      res.json([]);
    }
  });

  // ADMIN: Get all pending submissions
  app.get('/api/admin/pending', verifyAdmin, async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) return res.json([]);
      const lines = await db.select()
        .from(submissions)
        .where(eq(submissions.status, 'pending'))
        .orderBy(desc(submissions.timestamp));

      const mappedLines = lines.map(line => ({
        ...line,
        district: line.area,
        timestamp: line.timestamp.getTime()
      }));

      res.json(mappedLines);
    } catch (err: any) {
      console.error("Pending list error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Approve a submission
  app.post('/api/admin/approve', verifyAdmin, async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'DB not setup' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);
      
      await db.update(submissions)
        .set({ 
          status: 'approved',
          dataSourceText: null,
          dataSourceImage: null
        })
        .where(eq(submissions.id, fileId));

      res.json({ success: true, message: 'Submission approved and published' });
    } catch (err: any) {
      console.error("Approve error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Reject a submission
  app.post('/api/admin/reject', verifyAdmin, async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'DB not setup' });
      const { id, rejectReason } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);
      
      await db.update(submissions)
        .set({ 
          status: 'rejected', 
          rejectReason: rejectReason || null,
          dataSourceText: null,
          dataSourceImage: null
        })
        .where(eq(submissions.id, fileId));

      res.json({ success: true, message: 'Submission rejected' });
    } catch (err: any) {
      console.error("Reject error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Edit an approved submission name
  app.post('/api/admin/edit-approved', verifyAdmin, async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'DB not setup' });
      const { id, name } = req.body;
      if (!id || !name) return res.status(400).json({ error: 'Missing required fields' });

      const fileId = sanitizeId(id);
      
      await db.update(submissions)
        .set({ name })
        .where(eq(submissions.id, fileId));

      res.json({ success: true, message: 'Submission name updated successfully' });
    } catch (err: any) {
      console.error("Edit name error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Delete an approved submission
  app.post('/api/admin/delete-approved', verifyAdmin, async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'DB not setup' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);
      await db.delete(submissions)
        .where(eq(submissions.id, fileId));

      res.json({ success: true, message: 'Approved submission deleted successfully' });
    } catch (err: any) {
      console.error("Delete error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ai/chat', async (req, res) => {
    try { res.json(await runBuslineAI(req.body)); }
    catch (error: any) { res.status(400).json({ error: error.message || 'Busline AI 暂时不可用。' }); }
  });

  // API: AI Summary via DeepSeek
  app.post('/api/ai/summary', async (req, res) => {
    try {
      const { prompt } = req.body;
      const apiKey = process.env.DEEPSEEK_API_KEY;
      
      if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
      if (!apiKey) return res.status(500).json({ error: 'DeepSeek API Key is not configured on the server' });

      const response = await axios.post('https://api.deepseek.com/chat/completions', {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一个专业的公交线网规划专家。请根据提供的站点和线路数据，用一段话（不超过150字）综合总结该站点的通达情况，包括核心覆盖区域、线网密度及换乘潜力，语言要精炼且专业。' },
          { role: 'user', content: prompt }
        ],
        stream: false
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      res.json({ summary: response.data.choices[0].message.content });
    } catch (err: any) {
      console.error('DeepSeek API Error:', err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ 
        error: 'AI 总结失败', 
        details: err.response?.data?.error?.message || err.message 
      });
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
