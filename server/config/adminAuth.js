import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '..', '..', 'data', 'admin-auth.json');

export const DEFAULT_ADMIN_AUTH = {
  email: 'iamshivajibuddy@admin.com',
  password: '@Mahakali1997',
  recoveryPhone: '9537175050',
};

// 10 minutes inactivity timeout in milliseconds
export const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

export function cleanPhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  return digits.slice(-10);
}

export function loadAdminAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      return {
        email: (data.email || DEFAULT_ADMIN_AUTH.email).trim().toLowerCase(),
        password: data.password || DEFAULT_ADMIN_AUTH.password,
        recoveryPhone: cleanPhone(data.recoveryPhone || DEFAULT_ADMIN_AUTH.recoveryPhone),
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    }
  } catch (err) {
    console.error('[Admin Auth] Error reading admin-auth.json, using defaults:', err.message);
  }

  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const initial = {
    email: DEFAULT_ADMIN_AUTH.email.toLowerCase(),
    password: DEFAULT_ADMIN_AUTH.password,
    recoveryPhone: cleanPhone(DEFAULT_ADMIN_AUTH.recoveryPhone),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(initial, null, 2), 'utf8');
  return initial;
}

export function saveAdminAuth({ email, password, recoveryPhone }) {
  const current = loadAdminAuth();
  const updated = {
    email: (email ? email.trim().toLowerCase() : current.email),
    password: (password ? String(password) : current.password),
    recoveryPhone: (recoveryPhone ? cleanPhone(recoveryPhone) : current.recoveryPhone),
    updatedAt: new Date().toISOString(),
  };

  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  fs.writeFileSync(AUTH_FILE, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

// In-memory active sessions: token -> { email, createdAt, lastActiveAt }
const activeSessions = new Map();

export function createAdminSession(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    email,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  activeSessions.set(token, session);
  return token;
}

export function validateAdminSession(token) {
  if (!token || !activeSessions.has(token)) return null;

  const session = activeSessions.get(token);
  const now = Date.now();

  // Inactivity check: 10 minutes
  if (now - session.lastActiveAt > INACTIVITY_TIMEOUT_MS) {
    console.log(`[Admin Auth] Session ${token.substring(0, 8)}... expired due to 10 minutes of inactivity.`);
    activeSessions.delete(token);
    return null;
  }

  // Update last activity timestamp
  session.lastActiveAt = now;
  return session;
}

export function destroyAdminSession(token) {
  if (token && activeSessions.has(token)) {
    activeSessions.delete(token);
  }
}

export function destroyAllAdminSessions() {
  activeSessions.clear();
}

/**
 * Express middleware to ensure the request is from an authenticated, active admin
 */
export function requireAdminAuth(req, res, next) {
  const token = req.cookies?.admin_token || req.headers['x-admin-token'] || (
    req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null
  );

  const session = validateAdminSession(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Admin session expired or unauthenticated. Please log in.',
      code: 'AUTH_REQUIRED',
    });
  }

  req.adminSession = session;
  next();
}
