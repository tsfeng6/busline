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
var import_app = require("firebase/app");
var import_firestore = require("firebase/firestore");
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json());
  const DATA_DIR = import_path.default.join(process.cwd(), "data");
  const PENDING_DIR = import_path.default.join(DATA_DIR, "pending");
  const APPROVED_DIR = import_path.default.join(DATA_DIR, "approved");
  if (!import_fs.default.existsSync(DATA_DIR)) import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
  if (!import_fs.default.existsSync(PENDING_DIR)) import_fs.default.mkdirSync(PENDING_DIR, { recursive: true });
  if (!import_fs.default.existsSync(APPROVED_DIR)) import_fs.default.mkdirSync(APPROVED_DIR, { recursive: true });
  let db = null;
  try {
    const configPath = import_path.default.join(process.cwd(), "firebase-applet-config.json");
    if (import_fs.default.existsSync(configPath)) {
      const config = JSON.parse(import_fs.default.readFileSync(configPath, "utf-8"));
      if (config && config.apiKey && config.apiKey.trim() !== "") {
        const firebaseApp = (0, import_app.getApps)().length === 0 ? (0, import_app.initializeApp)(config) : (0, import_app.getApp)();
        db = config.firestoreDatabaseId ? (0, import_firestore.getFirestore)(firebaseApp, config.firestoreDatabaseId) : (0, import_firestore.getFirestore)(firebaseApp);
        console.log("Firebase Firestore successfully initialized on Cloud Run Server proxy!");
      }
    }
  } catch (e) {
    console.error("Failed to initialize server-side Firebase Firestore proxy:", e);
  }
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", firebaseProxyActive: !!db });
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
      if (db) {
        await (0, import_firestore.setDoc)((0, import_firestore.doc)(db, "submissions", fileId), data);
        console.log(`[SQL/Firestore Proxy] Saved submission "${fileId}" directly to Cloud Firestore.`);
      } else {
        const filePath = import_path.default.join(PENDING_DIR, `${fileId}.json`);
        import_fs.default.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      }
      res.json({ success: true, message: "Submitted successfully, awaiting audit." });
    } catch (err) {
      console.error(err);
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
      if (db && ids.length > 0) {
        const batches = [];
        for (let i = 0; i < ids.length; i += 10) {
          batches.push(ids.slice(i, i + 10));
        }
        for (const batch of batches) {
          if (batch.length === 0) continue;
          const q = (0, import_firestore.query)((0, import_firestore.collection)(db, "submissions"), (0, import_firestore.where)("id", "in", batch));
          const querySnapshot = await (0, import_firestore.getDocs)(q);
          querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data && data.id) {
              statuses[data.id] = data.status;
            }
          });
        }
        ids.forEach((id) => {
          if (!statuses[id]) {
            statuses[id] = "rejected";
          }
        });
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
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/submissions/approved", async (req, res) => {
    try {
      if (db) {
        let lines2 = [];
        try {
          const q = (0, import_firestore.query)(
            (0, import_firestore.collection)(db, "submissions"),
            (0, import_firestore.where)("status", "==", "approved"),
            (0, import_firestore.orderBy)("timestamp", "desc")
          );
          const querySnapshot = await (0, import_firestore.getDocs)(q);
          querySnapshot.forEach((docSnap) => {
            lines2.push(docSnap.data());
          });
        } catch (error) {
          const q = (0, import_firestore.query)((0, import_firestore.collection)(db, "submissions"), (0, import_firestore.where)("status", "==", "approved"));
          const querySnapshot = await (0, import_firestore.getDocs)(q);
          const approvedLines = [];
          querySnapshot.forEach((docSnap) => {
            approvedLines.push(docSnap.data());
          });
          lines2 = approvedLines.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
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
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/admin/pending", async (req, res) => {
    try {
      if (db) {
        let pendingLines = [];
        try {
          const q = (0, import_firestore.query)(
            (0, import_firestore.collection)(db, "submissions"),
            (0, import_firestore.where)("status", "==", "pending"),
            (0, import_firestore.orderBy)("timestamp", "desc")
          );
          const querySnapshot = await (0, import_firestore.getDocs)(q);
          querySnapshot.forEach((docSnap) => {
            pendingLines.push(docSnap.data());
          });
        } catch (error) {
          const q = (0, import_firestore.query)((0, import_firestore.collection)(db, "submissions"), (0, import_firestore.where)("status", "==", "pending"));
          const querySnapshot = await (0, import_firestore.getDocs)(q);
          const rawLines = [];
          querySnapshot.forEach((docSnap) => {
            rawLines.push(docSnap.data());
          });
          pendingLines = rawLines.sort((a, b) => b.timestamp - a.timestamp);
        }
        return res.json(pendingLines);
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
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/approve", async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing Id" });
      const fileId = sanitizeId(id);
      if (db) {
        await (0, import_firestore.updateDoc)((0, import_firestore.doc)(db, "submissions", fileId), { status: "approved" });
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
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/reject", async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing Id" });
      const fileId = sanitizeId(id);
      if (db) {
        await (0, import_firestore.deleteDoc)((0, import_firestore.doc)(db, "submissions", fileId));
        return res.json({ success: true, message: "Submission rejected and deleted" });
      }
      const pendingPath = import_path.default.join(PENDING_DIR, `${fileId}.json`);
      if (!import_fs.default.existsSync(pendingPath)) {
        return res.status(404).json({ error: "Pending submission not found" });
      }
      import_fs.default.unlinkSync(pendingPath);
      res.json({ success: true, message: "Submission rejected and deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/edit-approved", async (req, res) => {
    try {
      const { id, name } = req.body;
      if (!id || !name) return res.status(400).json({ error: "Missing required fields" });
      const fileId = sanitizeId(id);
      if (db) {
        await (0, import_firestore.updateDoc)((0, import_firestore.doc)(db, "submissions", fileId), { name });
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
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/admin/delete-approved", async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing Id" });
      const fileId = sanitizeId(id);
      if (db) {
        await (0, import_firestore.deleteDoc)((0, import_firestore.doc)(db, "submissions", fileId));
        return res.json({ success: true, message: "Approved submission deleted successfully" });
      }
      const approvedPath = import_path.default.join(APPROVED_DIR, `${fileId}.json`);
      if (!import_fs.default.existsSync(approvedPath)) {
        return res.status(404).json({ error: "Approved submission not found" });
      }
      import_fs.default.unlinkSync(approvedPath);
      res.json({ success: true, message: "Approved submission deleted successfully" });
    } catch (err) {
      console.error(err);
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
