import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(express.json());

  // Storage Directories
  const DATA_DIR = path.join(process.cwd(), 'data');
  const PENDING_DIR = path.join(DATA_DIR, 'pending');
  const APPROVED_DIR = path.join(DATA_DIR, 'approved');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });
  if (!fs.existsSync(APPROVED_DIR)) fs.mkdirSync(APPROVED_DIR, { recursive: true });

  // API: Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Helper to sanitize filename
  const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_\-]/g, '');

  // API 1: Submit a line
  app.post('/api/submissions/submit', (req, res) => {
    try {
      const { id, name, creatorNickname, city, district, path: linePath, via_stops } = req.body;
      if (!id || !name || !creatorNickname || !city) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const fileId = sanitizeId(id);
      const filePath = path.join(PENDING_DIR, `${fileId}.json`);

      const data = {
        id: fileId,
        name,
        creatorNickname,
        city,
        district: district || '',
        path: linePath || [],
        via_stops: via_stops || [],
        status: 'pending',
        timestamp: Date.now()
      };

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      res.json({ success: true, message: 'Submitted successfully, awaiting audit.' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // API 2: Get status of multiple submissions
  app.get('/api/submissions/status', (req, res) => {
    try {
      const idsStr = req.query.ids as string;
      if (!idsStr) {
        return res.json({});
      }

      const ids = idsStr.split(',').map(sanitizeId);
      const statuses: Record<string, string> = {};

      ids.forEach(id => {
        const approvedPath = path.join(APPROVED_DIR, `${id}.json`);
        const pendingPath = path.join(PENDING_DIR, `${id}.json`);

        if (fs.existsSync(approvedPath)) {
          statuses[id] = 'approved';
        } else if (fs.existsSync(pendingPath)) {
          statuses[id] = 'pending';
        } else {
          statuses[id] = 'rejected';
        }
      });

      res.json(statuses);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // API 3: Get all approved lines
  app.get('/api/submissions/approved', (req, res) => {
    try {
      if (!fs.existsSync(APPROVED_DIR)) {
        return res.json([]);
      }
      const files = fs.readdirSync(APPROVED_DIR);
      const lines = files
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(APPROVED_DIR, f), 'utf-8'));
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      res.json(lines);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Get all pending submissions
  app.get('/api/admin/pending', (req, res) => {
    try {
      if (!fs.existsSync(PENDING_DIR)) {
        return res.json([]);
      }
      const files = fs.readdirSync(PENDING_DIR);
      const lines = files
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(PENDING_DIR, f), 'utf-8'));
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      res.json(lines);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Approve a submission
  app.post('/api/admin/approve', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);
      const pendingPath = path.join(PENDING_DIR, `${fileId}.json`);
      const approvedPath = path.join(APPROVED_DIR, `${fileId}.json`);

      if (!fs.existsSync(pendingPath)) {
        return res.status(404).json({ error: 'Pending submission not found' });
      }

      // Read, update status, and write to approved
      const data = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
      data.status = 'approved';

      fs.writeFileSync(approvedPath, JSON.stringify(data, null, 2), 'utf-8');
      
      // Delete from pending
      fs.unlinkSync(pendingPath);

      res.json({ success: true, message: 'Submission approved and published' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Reject a submission
  app.post('/api/admin/reject', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);
      const pendingPath = path.join(PENDING_DIR, `${fileId}.json`);

      if (!fs.existsSync(pendingPath)) {
        return res.status(404).json({ error: 'Pending submission not found' });
      }

      // Just delete from pending (implies rejected status)
      fs.unlinkSync(pendingPath);

      res.json({ success: true, message: 'Submission rejected and deleted' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Edit an approved submission name
  app.post('/api/admin/edit-approved', (req, res) => {
    try {
      const { id, name } = req.body;
      if (!id || !name) return res.status(400).json({ error: 'Missing required fields' });

      const fileId = sanitizeId(id);
      const approvedPath = path.join(APPROVED_DIR, `${fileId}.json`);

      if (!fs.existsSync(approvedPath)) {
        return res.status(404).json({ error: 'Approved submission not found' });
      }

      const data = JSON.parse(fs.readFileSync(approvedPath, 'utf-8'));
      data.name = name;

      fs.writeFileSync(approvedPath, JSON.stringify(data, null, 2), 'utf-8');
      res.json({ success: true, message: 'Submission name updated successfully' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Delete an approved submission
  app.post('/api/admin/delete-approved', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);
      const approvedPath = path.join(APPROVED_DIR, `${fileId}.json`);

      if (!fs.existsSync(approvedPath)) {
        return res.status(404).json({ error: 'Approved submission not found' });
      }

      fs.unlinkSync(approvedPath);
      res.json({ success: true, message: 'Approved submission deleted successfully' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
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
