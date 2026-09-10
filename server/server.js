import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const clientOrigin = process.env.CLIENT_ORIGIN || `http://localhost:${PORT}`;

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
  }
  console.log("Firebase Admin initialized.");
} catch (error) {
  console.warn("Firebase Admin is not initialized yet.");
  console.warn("Set GOOGLE_APPLICATION_CREDENTIALS in .env for protected API routes.");
}

const db = () => admin.firestore();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: clientOrigin,
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json({ limit: "100kb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Terlalu banyak request. Coba lagi beberapa menit." }
});

app.use("/api", apiLimiter);

async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token autentikasi diperlukan." });
  }

  if (!admin.apps.length) {
    return res.status(503).json({
      error: "Firebase Admin belum dikonfigurasi di server."
    });
  }

  try {
    const idToken = authHeader.slice(7);
    req.user = await admin.auth().verifyIdToken(idToken);
    next();
  } catch {
    return res.status(401).json({ error: "Token tidak valid atau sudah kedaluwarsa." });
  }
}

async function requireRole(req, res, next) {
  try {
    const snap = await db().collection("users").doc(req.user.uid).get();
    if (!snap.exists) {
      return res.status(403).json({ error: "Profil pengguna belum dibuat." });
    }

    const role = snap.data().role;
    req.userRole = role;

    if (!["admin", "cashier"].includes(role)) {
      return res.status(403).json({ error: "Role tidak memiliki akses." });
    }

    next();
  } catch {
    res.status(500).json({ error: "Gagal memeriksa role." });
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "kasir-modern",
    time: new Date().toISOString()
  });
});

app.get("/api/me", verifyFirebaseToken, requireRole, async (req, res) => {
  res.json({
    uid: req.user.uid,
    email: req.user.email,
    role: req.userRole
  });
});

app.post("/api/audit", verifyFirebaseToken, requireRole, async (req, res) => {
  const { action, metadata = {} } = req.body || {};

  if (typeof action !== "string" || action.length < 2 || action.length > 100) {
    return res.status(400).json({ error: "Action tidak valid." });
  }

  await db().collection("auditLogs").add({
    uid: req.user.uid,
    email: req.user.email || null,
    action,
    metadata,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  res.status(201).json({ ok: true });
});

app.use(express.static(path.join(__dirname, "../public")));

app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log(`Kasir Modern berjalan di http://localhost:${PORT}`);
});