import express from 'express';
import cors from 'cors';
import path from 'path';
import { db, runMigration } from './src/db/index';
import { submissions } from './src/db/schema';
import { eq, inArray, desc } from 'drizzle-orm';

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
  app.use(express.json());

  // API: Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', storage: 'postgresql' });
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
      console.error("Approved list error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Get all pending submissions
  app.get('/api/admin/pending', async (req, res) => {
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
  app.post('/api/admin/approve', async (req, res) => {
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
  app.post('/api/admin/reject', async (req, res) => {
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
  app.post('/api/admin/edit-approved', async (req, res) => {
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
  app.post('/api/admin/delete-approved', async (req, res) => {
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
