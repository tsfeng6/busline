import express from 'express';
import cors from 'cors';
import path from 'path';
import { db, runMigration } from './src/db/index';
import { submissions, appSettings } from './src/db/schema';
import { eq, inArray, desc } from 'drizzle-orm';

async function startServer() {
  const app = express();
  
  // Self-healing Port Selection:
  // On AI Studio, the dev server proxy strictly expects port 3000.
  // In production outside AI Studio, bind to process.env.PORT if specified.
  let PORT = 3000;
  if (process.env.NODE_ENV === 'production' && process.env.PORT && !process.env.APP_URL?.includes('run.app') && !process.env.APP_URL?.includes('aistudio')) {
    PORT = Number(process.env.PORT);
  }

  // Run migration in background without blocking server startup / port binding
  runMigration().catch((e) => {
    console.warn('Database migration skipped or connection timed out:', e?.message || e);
  });

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' })); // Increase limit for Base64 image payload

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'buslineadmin';

  // Server-side authentication middleware
  const verifyAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const headerPass = req.headers['x-admin-password'] || req.headers['authorization'];
    let passed = '';
    if (typeof headerPass === 'string') {
      passed = headerPass.replace('Bearer ', '').trim();
    }
    
    if (passed !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized: Admin authorization required.' });
    }
    next();
  };

  // API: Validate admin password securely on the server
  app.post('/api/admin/verify', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Incorrect admin password.' });
    }
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
      console.warn('Get setting error (fallback to default):', err?.message || err);
      res.json({ key: 'wechat_qr', value: '', updatedAt: Date.now() });
    }
  });

  // UPDATE a setting (requires admin password verification)
  app.post('/api/settings/wechat_qr', async (req, res) => {
    try {
      const { value, password } = req.body;
      if (!value) {
        return res.status(400).json({ error: 'Value is required' });
      }

      // Verify admin password
      if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: 'Unauthorized: Admin password is incorrect.' });
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
      console.error("Status error:", err);
      res.status(500).json({ error: err.message });
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
      console.warn("Approved list error (fallback to empty list):", err?.message || err);
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
