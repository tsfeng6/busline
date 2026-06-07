import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

// Conversions for Firestore REST API JSON structure
function fromFirestore(doc: any): any {
  if (!doc) return null;
  const result: any = {};
  const fields = doc.fields || {};
  for (const [key, valObj] of Object.entries(fields)) {
    result[key] = readValue(valObj);
  }
  return result;
}

function readValue(valObj: any): any {
  if (!valObj) return null;
  if ('stringValue' in valObj) return valObj.stringValue;
  if ('integerValue' in valObj) return parseInt(valObj.integerValue, 10);
  if ('doubleValue' in valObj) return parseFloat(valObj.doubleValue);
  if ('booleanValue' in valObj) return valObj.booleanValue;
  if ('arrayValue' in valObj) {
    const values = valObj.arrayValue.values || [];
    return values.map((v: any) => readValue(v));
  }
  if ('mapValue' in valObj) {
    const fields = valObj.mapValue.fields || {};
    const res: any = {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = readValue(v);
    }
    return res;
  }
  return null;
}

function toFirestore(obj: any): any {
  const fields: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const fVal = toValue(value);
    if (fVal !== undefined) {
      fields[key] = fVal;
    }
  }
  return { fields };
}

function toValue(value: any): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toValue).filter((v: any) => v !== undefined)
      }
    };
  }
  if (typeof value === 'object') {
    const fields: any = {};
    for (const [k, v] of Object.entries(value)) {
      const fv = toValue(v);
      if (fv !== undefined) fields[k] = fv;
    }
    return {
      mapValue: { fields }
    };
  }
  return undefined;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Storage Directories (Local Fallback)
  // Use /tmp for serverless environments (Tencent SCF / AWS Lambda) which only allow writing there.
  const DATA_DIR = path.join('/tmp', 'data');
  const PENDING_DIR = path.join(DATA_DIR, 'pending');
  const APPROVED_DIR = path.join(DATA_DIR, 'approved');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });
  if (!fs.existsSync(APPROVED_DIR)) fs.mkdirSync(APPROVED_DIR, { recursive: true });

  // Initialize Server-Side Firebase Firestore Proxy via Native REST API
  let firebaseEnabled = false;
  let firebaseBaseUrl = '';
  let firebaseApiKey = '';

  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config && config.apiKey && config.apiKey.trim() !== "") {
        const isCustomDb = config.firestoreDatabaseId && config.firestoreDatabaseId.trim() !== '';
        const databaseId = isCustomDb ? config.firestoreDatabaseId : '(default)';
        firebaseBaseUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${databaseId}/documents`;
        firebaseApiKey = config.apiKey;
        firebaseEnabled = true;
        console.log(`[SQL/Firestore Proxy] Configured direct HTTP REST proxy: ${config.projectId}/${databaseId}`);
      }
    }
  } catch (e) {
    console.error("Failed to parse firebase-applet-config.json:", e);
  }

  // API: Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', firebaseProxyActive: firebaseEnabled });
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

      if (firebaseEnabled) {
        const firestoreDoc = toFirestore(data);
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
        const fRes = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(firestoreDoc)
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          let parsedErr: any = {};
          try { parsedErr = JSON.parse(rawErr); } catch(ex){}
          const innerMessage = parsedErr?.error?.message || rawErr;
          throw new Error(`Firebase 存储失败 (${fRes.status}): ${innerMessage}`);
        }
        console.log(`[SQL/Firestore Proxy] Saved submission "${fileId}" directly to Cloud Firestore.`);
      } else {
        const filePath = path.join(PENDING_DIR, `${fileId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      }
      res.json({ success: true, message: 'Submitted successfully, awaiting audit.' });
    } catch (err: any) {
      console.error("Submit proxy error:", err);
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

      if (firebaseEnabled && ids.length > 0) {
        await Promise.all(
          ids.map(async (fileId) => {
            try {
              const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
              const fRes = await fetch(url);
              if (fRes.ok) {
                const docSnap = await fRes.json();
                const simpleObj = fromFirestore(docSnap);
                statuses[fileId] = simpleObj.status || 'pending';
              } else if (fRes.status === 404) {
                statuses[fileId] = 'rejected';
              } else {
                statuses[fileId] = 'pending';
              }
            } catch (err) {
              statuses[fileId] = 'pending';
            }
          })
        );
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
      console.error("Status proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API 3: Get all approved lines (Proxy support with programmatic sort)
  app.get('/api/submissions/approved', async (req, res) => {
    try {
      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions?pageSize=1000&key=${firebaseApiKey}`;
        const fRes = await fetch(url);
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase 同步失败 (${fRes.status}): ${rawErr}`);
        }
        const result = await fRes.json();
        const docs = result.documents || [];
        const lines = docs
          .map(fromFirestore)
          .filter((line: any) => line && line.status === 'approved')
          .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
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
      console.error("Approved proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Get all pending submissions (Proxy support)
  app.get('/api/admin/pending', async (req, res) => {
    try {
      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions?pageSize=1000&key=${firebaseApiKey}`;
        const fRes = await fetch(url);
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase 同步失败 (${fRes.status}): ${rawErr}`);
        }
        const result = await fRes.json();
        const docs = result.documents || [];
        const lines = docs
          .map(fromFirestore)
          .filter((line: any) => line && line.status === 'pending')
          .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
        return res.json(lines);
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
      console.error("Pending proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Approve a submission (Proxy support)
  app.post('/api/admin/approve', async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);

      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}&updateMask.fieldPaths=status`;
        const payload = {
          fields: {
            status: { stringValue: 'approved' }
          }
        };
        const fRes = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase 审批失败 (${fRes.status}): ${rawErr}`);
        }
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
      console.error("Approve proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Reject a submission (Proxy support)
  app.post('/api/admin/reject', async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);

      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
        const fRes = await fetch(url, {
          method: 'DELETE'
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase 驳回失败 (${fRes.status}): ${rawErr}`);
        }
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
      console.error("Reject proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Edit an approved submission name (Proxy support)
  app.post('/api/admin/edit-approved', async (req, res) => {
    try {
      const { id, name } = req.body;
      if (!id || !name) return res.status(400).json({ error: 'Missing required fields' });

      const fileId = sanitizeId(id);

      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}&updateMask.fieldPaths=name`;
        const payload = {
          fields: {
            name: { stringValue: name }
          }
        };
        const fRes = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase 修改失败 (${fRes.status}): ${rawErr}`);
        }
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
      console.error("Edit name proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ADMIN: Delete an approved submission (Proxy support)
  app.post('/api/admin/delete-approved', async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing Id' });

      const fileId = sanitizeId(id);

      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
        const fRes = await fetch(url, {
          method: 'DELETE'
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase 删除失败 (${fRes.status}): ${rawErr}`);
        }
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
      console.error("Delete proxy error:", err);
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
