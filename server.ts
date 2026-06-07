import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  collection, 
  query, 
  where, 
  orderBy,
  Firestore
} from 'firebase/firestore';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(express.json());

  // Storage Directories (Local Fallback)
  const DATA_DIR = path.join(process.cwd(), 'data');
  const PENDING_DIR = path.join(DATA_DIR, 'pending');
  const APPROVED_DIR = path.join(DATA_DIR, 'approved');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });
  if (!fs.existsSync(APPROVED_DIR)) fs.mkdirSync(APPROVED_DIR, { recursive: true });

  // Initialize Server-Side Firebase Firestore Proxy
  let db: Firestore | null = null;
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config && config.apiKey && config.apiKey.trim() !== "") {
        const firebaseApp = getApps().length === 0 ? initializeApp(config) : getApp();
        db = config.firestoreDatabaseId 
          ? getFirestore(firebaseApp, config.firestoreDatabaseId) 
          : getFirestore(firebaseApp);
        console.log("Firebase Firestore successfully initialized on Cloud Run Server proxy!");
      }
    }
  } catch (e) {
    console.error("Failed to initialize server-side Firebase Firestore proxy:", e);
  }

  // API: Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', firebaseProxyActive: !!db });
  });

  // Helper to sanitize filename
  const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_\-]/g, '');

  // API 1: Submit a line (Proxy support)
  app.post('/api/submissions/submit', async (req, res) => {
    try {
      const { id, name, creatorNickname, city, district, path: linePath, via_stops, status, timestamp } = req.body;
      if (!id || !name || !creatorNickname || !city) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const fileId = sanitizeId(id);
      const data = {
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

      if (db) {
        await setDoc(doc(db, 'submissions', fileId), data);
        console.log(`[SQL/Firestore Proxy] Saved submission "${fileId}" directly to Cloud Firestore.`);
      } else {
        const filePath = path.join(PENDING_DIR, `${fileId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      }
      res.json({ success: true, message: 'Submitted successfully, awaiting audit.' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // API 2: Get status of multiple submissions (Proxy support)
  app.get('/api/submissions/status', async (req, res) => {
    try {
      const idsStr = req.query.ids as string;
      if (!idsStr) {
        return res.json({});
      }

      const ids = idsStr.split(',').map(sanitizeId);
      const statuses: Record<string, string> = {};

      if (db && ids.length > 0) {
        const batches: string[][] = [];
        for (let i = 0; i < ids.length; i += 10) {
          batches.push(ids.slice(i, i + 10));
        }
        for (const batch of batches) {
          if (batch.length === 0) continue;
          const q = query(collection(db, 'submissions'), where('id', 'in', batch));
          const querySnapshot = await getDocs(q);
          querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data && data.id) {
              statuses[data.id] = data.status;
            }
          });
        }
        ids.forEach(id => {
          if (!statuses[id]) {
            statuses[id] = 'rejected';
          }
        });
        return res.json(statuses);
      }

      // Local fallback
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

  // API 3: Get all approved lines (Proxy support with sort fallback)
  app.get('/api/submissions/approved', async (req, res) => {
    try {
      if (db) {
        let lines: any[] = [];
        try {
          const q = query(
            collection(db, 'submissions'), 
            where('status', '==', 'approved'),
            orderBy('timestamp', 'desc')
          );
          const querySnapshot = await getDocs(q);
          querySnapshot.forEach((docSnap) => {
            lines.push(docSnap.data());
          });
        } catch (error) {
          // Programmatic sorting fallback when indices are building
          const q = query(collection(db, 'submissions'), where('status', '==', 'approved'));
          const querySnapshot = await getDocs(q);
          const approvedLines: any[] = [];
          querySnapshot.forEach((docSnap) => {
            approvedLines.push(docSnap.data());
          });
          lines = approvedLines.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
        return res.json(lines);
      }

      // Local Fallback
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

  // ADMIN: Get all pending submissions (Proxy support with sort fallback)
  app.get('/api/admin/pending', async (req, res) => {
    try {
      if (db) {
        let pendingLines: any[] = [];
        try {
          const q = query(
            collection(db, 'submissions'), 
            where('status', '==', 'pending'),
            orderBy('timestamp', 'desc')
          );
          const querySnapshot = await getDocs(q);
          querySnapshot.forEach((docSnap) => {
            pendingLines.push(docSnap.data());
          });
        } catch (error) {
          const q = query(collection(db, 'submissions'), where('status', '==', 'pending'));
          const querySnapshot = await getDocs(q);
          const rawLines: any[] = [];
          querySnapshot.forEach((docSnap) => {
            rawLines.push(docSnap.data());
          });
          pendingLines = rawLines.sort((a, b) => b.timestamp - a.timestamp);
        }
        return res.json(pendingLines);
      }

      // Local fallback
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

  // ADMIN: Approve a submission (Proxy support)
  app.post('/api/admin/approve', async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);

      if (db) {
        await updateDoc(doc(db, 'submissions', fileId), { status: 'approved' });
        return res.json({ success: true, message: 'Submission approved and published' });
      }

      // Local fallback
      const pendingPath = path.join(PENDING_DIR, `${fileId}.json`);
      const approvedPath = path.join(APPROVED_DIR, `${fileId}.json`);

      if (!fs.existsSync(pendingPath)) {
        return res.status(404).json({ error: 'Pending submission not found' });
      }

      const data = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
      data.status = 'approved';

      fs.writeFileSync(approvedPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.unlinkSync(pendingPath);

      res.json({ success: true, message: 'Submission approved and published' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Reject a submission (Proxy support)
  app.post('/api/admin/reject', async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);

      if (db) {
        await deleteDoc(doc(db, 'submissions', fileId));
        return res.json({ success: true, message: 'Submission rejected and deleted' });
      }

      // Local fallback
      const pendingPath = path.join(PENDING_DIR, `${fileId}.json`);

      if (!fs.existsSync(pendingPath)) {
        return res.status(404).json({ error: 'Pending submission not found' });
      }

      fs.unlinkSync(pendingPath);
      res.json({ success: true, message: 'Submission rejected and deleted' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Edit an approved submission name (Proxy support)
  app.post('/api/admin/edit-approved', async (req, res) => {
    try {
      const { id, name } = req.body;
      if (!id || !name) return res.status(400).json({ error: 'Missing required fields' });

      const fileId = sanitizeId(id);

      if (db) {
        await updateDoc(doc(db, 'submissions', fileId), { name });
        return res.json({ success: true, message: 'Submission name updated successfully' });
      }

      // Local fallback
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

  // ADMIN: Delete an approved submission (Proxy support)
  app.post('/api/admin/delete-approved', async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);

      if (db) {
        await deleteDoc(doc(db, 'submissions', fileId));
        return res.json({ success: true, message: 'Approved submission deleted successfully' });
      }

      // Local fallback
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
