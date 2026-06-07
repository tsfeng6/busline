var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_vite = require("vite");
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
  if ("stringValue" in valObj) return valObj.stringValue;
  if ("integerValue" in valObj) return parseInt(valObj.integerValue, 10);
  if ("doubleValue" in valObj) return parseFloat(valObj.doubleValue);
  if ("booleanValue" in valObj) return valObj.booleanValue;
  if ("arrayValue" in valObj) {
    const values = valObj.arrayValue.values || [];
    return values.map((v) => readValue(v));
  }
  if ("mapValue" in valObj) {
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
    if (fVal !== void 0) {
      fields[key] = fVal;
    }
  }
  return { fields };
}
function toValue(value) {
  if (value === null || value === void 0) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toValue).filter((v) => v !== void 0)
      }
    };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      const fv = toValue(v);
      if (fv !== void 0) fields[k] = fv;
    }
    return {
      mapValue: { fields }
    };
  }
  return void 0;
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = Number(process.env.PORT) || 3e3;
  app.use(import_express.default.json());
  const DATA_DIR = import_path.default.join(process.cwd(), "data");
  const PENDING_DIR = import_path.default.join(DATA_DIR, "pending");
  const APPROVED_DIR = import_path.default.join(DATA_DIR, "approved");
  if (!import_fs.default.existsSync(DATA_DIR)) import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
  if (!import_fs.default.existsSync(PENDING_DIR)) import_fs.default.mkdirSync(PENDING_DIR, { recursive: true });
  if (!import_fs.default.existsSync(APPROVED_DIR)) import_fs.default.mkdirSync(APPROVED_DIR, { recursive: true });
  let firebaseEnabled = false;
  let firebaseBaseUrl = "";
  let firebaseApiKey = "";
  try {
    const configPath = import_path.default.join(process.cwd(), "firebase-applet-config.json");
    if (import_fs.default.existsSync(configPath)) {
      const config = JSON.parse(import_fs.default.readFileSync(configPath, "utf-8"));
      if (config && config.apiKey && config.apiKey.trim() !== "") {
        const isCustomDb = config.firestoreDatabaseId && config.firestoreDatabaseId.trim() !== "";
        const databaseId = isCustomDb ? config.firestoreDatabaseId : "(default)";
        firebaseBaseUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${databaseId}/documents`;
        firebaseApiKey = config.apiKey;
        firebaseEnabled = true;
        console.log(`[SQL/Firestore Proxy] Configured direct HTTP REST proxy: ${config.projectId}/${databaseId}`);
      }
    }
  } catch (e) {
    console.error("Failed to parse firebase-applet-config.json:", e);
  }
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", firebaseProxyActive: firebaseEnabled });
  });
  const sanitizeId = (id) => id.replace(/[^a-zA-Z0-9_\-]/g, "");
  app.post("/api/submissions/submit", async (req, res) => {
    try {
      const { id, name, creatorNickname, city, district, path: linePath, via_stops, status, timestamp } = req.body;
      if (!id || !name || !creatorNickname || !city) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const fileId = sanitizeId(id);
      const data = {
        id: fileId,
        name,
        creatorNickname,
        city,
        district: district || "",
        path: linePath || [],
        via_stops: via_stops || [],
        status: status || "pending",
        timestamp: timestamp || Date.now()
      };
      if (firebaseEnabled) {
        const firestoreDoc = toFirestore(data);
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
        const fRes = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(firestoreDoc)
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          let parsedErr = {};
          try {
            parsedErr = JSON.parse(rawErr);
          } catch (ex) {
          }
          const innerMessage = parsedErr?.error?.message || rawErr;
          throw new Error(`Firebase \u5B58\u50A8\u5931\u8D25 (${fRes.status}): ${innerMessage}`);
        }
        console.log(`[SQL/Firestore Proxy] Saved submission "${fileId}" directly to Cloud Firestore.`);
      } else {
        const filePath = import_path.default.join(PENDING_DIR, `${fileId}.json`);
        import_fs.default.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      }
      res.json({ success: true, message: "Submitted successfully, awaiting audit." });
    } catch (err) {
      console.error("Submit proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/submissions/status", async (req, res) => {
    try {
      const idsStr = req.query.ids;
      if (!idsStr) {
        return res.json({});
      }
      const ids = idsStr.split(",").map(sanitizeId);
      const statuses = {};
      if (firebaseEnabled && ids.length > 0) {
        await Promise.all(
          ids.map(async (fileId) => {
            try {
              const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
              const fRes = await fetch(url);
              if (fRes.ok) {
                const docSnap = await fRes.json();
                const simpleObj = fromFirestore(docSnap);
                statuses[fileId] = simpleObj.status || "pending";
              } else if (fRes.status === 404) {
                statuses[fileId] = "rejected";
              } else {
                statuses[fileId] = "pending";
              }
            } catch (err) {
              statuses[fileId] = "pending";
            }
          })
        );
        return res.json(statuses);
      }
      ids.forEach((id) => {
        const approvedPath = import_path.default.join(APPROVED_DIR, `${id}.json`);
        const pendingPath = import_path.default.join(PENDING_DIR, `${id}.json`);
        if (import_fs.default.existsSync(approvedPath)) {
          statuses[id] = "approved";
        } else if (import_fs.default.existsSync(pendingPath)) {
          statuses[id] = "pending";
        } else {
          statuses[id] = "rejected";
        }
      });
      res.json(statuses);
    } catch (err) {
      console.error("Status proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/submissions/approved", async (req, res) => {
    try {
      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions?pageSize=1000&key=${firebaseApiKey}`;
        const fRes = await fetch(url);
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase \u540C\u6B65\u5931\u8D25 (${fRes.status}): ${rawErr}`);
        }
        const result = await fRes.json();
        const docs = result.documents || [];
        const lines2 = docs.map(fromFirestore).filter((line) => line && line.status === "approved").sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return res.json(lines2);
      }
      if (!import_fs.default.existsSync(APPROVED_DIR)) {
        return res.json([]);
      }
      const files = import_fs.default.readdirSync(APPROVED_DIR);
      const lines = files.filter((f) => f.endsWith(".json")).map((f) => {
        try {
          return JSON.parse(import_fs.default.readFileSync(import_path.default.join(APPROVED_DIR, f), "utf-8"));
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
      res.json(lines);
    } catch (err) {
      console.error("Approved proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/admin/pending", async (req, res) => {
    try {
      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions?pageSize=1000&key=${firebaseApiKey}`;
        const fRes = await fetch(url);
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase \u540C\u6B65\u5931\u8D25 (${fRes.status}): ${rawErr}`);
        }
        const result = await fRes.json();
        const docs = result.documents || [];
        const lines2 = docs.map(fromFirestore).filter((line) => line && line.status === "pending").sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return res.json(lines2);
      }
      if (!import_fs.default.existsSync(PENDING_DIR)) {
        return res.json([]);
      }
      const files = import_fs.default.readdirSync(PENDING_DIR);
      const lines = files.filter((f) => f.endsWith(".json")).map((f) => {
        try {
          return JSON.parse(import_fs.default.readFileSync(import_path.default.join(PENDING_DIR, f), "utf-8"));
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
      res.json(lines);
    } catch (err) {
      console.error("Pending proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/approve", async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing Id" });
      const fileId = sanitizeId(id);
      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}&updateMask.fieldPaths=status`;
        const payload = {
          fields: {
            status: { stringValue: "approved" }
          }
        };
        const fRes = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase \u5BA1\u6279\u5931\u8D25 (${fRes.status}): ${rawErr}`);
        }
        return res.json({ success: true, message: "Submission approved and published" });
      }
      const pendingPath = import_path.default.join(PENDING_DIR, `${fileId}.json`);
      const approvedPath = import_path.default.join(APPROVED_DIR, `${fileId}.json`);
      if (!import_fs.default.existsSync(pendingPath)) {
        return res.status(404).json({ error: "Pending submission not found" });
      }
      const data = JSON.parse(import_fs.default.readFileSync(pendingPath, "utf-8"));
      data.status = "approved";
      import_fs.default.writeFileSync(approvedPath, JSON.stringify(data, null, 2), "utf-8");
      import_fs.default.unlinkSync(pendingPath);
      res.json({ success: true, message: "Submission approved and published" });
    } catch (err) {
      console.error("Approve proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/reject", async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing Id" });
      const fileId = sanitizeId(id);
      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
        const fRes = await fetch(url, {
          method: "DELETE"
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase \u9A73\u56DE\u5931\u8D25 (${fRes.status}): ${rawErr}`);
        }
        return res.json({ success: true, message: "Submission rejected and deleted" });
      }
      const pendingPath = import_path.default.join(PENDING_DIR, `${fileId}.json`);
      if (!import_fs.default.existsSync(pendingPath)) {
        return res.status(404).json({ error: "Pending submission not found" });
      }
      import_fs.default.unlinkSync(pendingPath);
      res.json({ success: true, message: "Submission rejected and deleted" });
    } catch (err) {
      console.error("Reject proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/edit-approved", async (req, res) => {
    try {
      const { id, name } = req.body;
      if (!id || !name) return res.status(400).json({ error: "Missing required fields" });
      const fileId = sanitizeId(id);
      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}&updateMask.fieldPaths=name`;
        const payload = {
          fields: {
            name: { stringValue: name }
          }
        };
        const fRes = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase \u4FEE\u6539\u5931\u8D25 (${fRes.status}): ${rawErr}`);
        }
        return res.json({ success: true, message: "Submission name updated successfully" });
      }
      const approvedPath = import_path.default.join(APPROVED_DIR, `${fileId}.json`);
      if (!import_fs.default.existsSync(approvedPath)) {
        return res.status(404).json({ error: "Approved submission not found" });
      }
      const data = JSON.parse(import_fs.default.readFileSync(approvedPath, "utf-8"));
      data.name = name;
      import_fs.default.writeFileSync(approvedPath, JSON.stringify(data, null, 2), "utf-8");
      res.json({ success: true, message: "Submission name updated successfully" });
    } catch (err) {
      console.error("Edit name proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/delete-approved", async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing Id" });
      const fileId = sanitizeId(id);
      if (firebaseEnabled) {
        const url = `${firebaseBaseUrl}/submissions/${fileId}?key=${firebaseApiKey}`;
        const fRes = await fetch(url, {
          method: "DELETE"
        });
        if (!fRes.ok) {
          const rawErr = await fRes.text();
          throw new Error(`Firebase \u5220\u9664\u5931\u8D25 (${fRes.status}): ${rawErr}`);
        }
        return res.json({ success: true, message: "Approved submission deleted successfully" });
      }
      const approvedPath = import_path.default.join(APPROVED_DIR, `${fileId}.json`);
      if (!import_fs.default.existsSync(approvedPath)) {
        return res.status(404).json({ error: "Approved submission not found" });
      }
      import_fs.default.unlinkSync(approvedPath);
      res.json({ success: true, message: "Approved submission deleted successfully" });
    } catch (err) {
      console.error("Delete proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
