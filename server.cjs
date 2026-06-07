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
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });
  const sanitizeId = (id) => id.replace(/[^a-zA-Z0-9_\-]/g, "");
  app.post("/api/submissions/submit", (req, res) => {
    try {
      const { id, name, creatorNickname, city, district, path: linePath, via_stops } = req.body;
      if (!id || !name || !creatorNickname || !city) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const fileId = sanitizeId(id);
      const filePath = import_path.default.join(PENDING_DIR, `${fileId}.json`);
      const data = {
        id: fileId,
        name,
        creatorNickname,
        city,
        district: district || "",
        path: linePath || [],
        via_stops: via_stops || [],
        status: "pending",
        timestamp: Date.now()
      };
      import_fs.default.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      res.json({ success: true, message: "Submitted successfully, awaiting audit." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/submissions/status", (req, res) => {
    try {
      const idsStr = req.query.ids;
      if (!idsStr) {
        return res.json({});
      }
      const ids = idsStr.split(",").map(sanitizeId);
      const statuses = {};
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
  app.get("/api/submissions/approved", (req, res) => {
    try {
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
  app.get("/api/admin/pending", (req, res) => {
    try {
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
  app.post("/api/admin/approve", (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing Id" });
      const fileId = sanitizeId(id);
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
  app.post("/api/admin/reject", (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing Id" });
      const fileId = sanitizeId(id);
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
  app.post("/api/admin/edit-approved", (req, res) => {
    try {
      const { id, name } = req.body;
      if (!id || !name) return res.status(400).json({ error: "Missing required fields" });
      const fileId = sanitizeId(id);
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
  app.post("/api/admin/delete-approved", (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing Id" });
      const fileId = sanitizeId(id);
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
