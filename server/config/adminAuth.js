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

// 24 hours session timeout in milliseconds
export const INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'meesho_admin_hmac_secret_token_1997_production';

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

  const initial = {
    email: DEFAULT_ADMIN_AUTH.email.toLowerCase(),
    password: DEFAULT_ADMIN_AUTH.password,
    recoveryPhone: cleanPhone(DEFAULT_ADMIN_AUTH.recoveryPhone),
    updatedAt: new Date().toISOString(),
  };

  try {
    const authDir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(initial, null, 2), 'utf8');
  } catch (e) {
    // Read-only filesystem in cloud serverless
  }
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

  try {
    const authDir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(updated, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Admin Auth] Notice: Could not write file (read-only environment):', err.message);
  }
  return updated;
}

/**
 * Creates a stateless cryptographic HMAC token that persists across
 * Vercel serverless function invocations without depending on in-memory storage.
 */
export function createAdminSession(email) {
  const payload = {
    email: (email || DEFAULT_ADMIN_AUTH.email).toLowerCase().trim(),
    createdAt: Date.now(),
    expiresAt: Date.now() + INACTIVITY_TIMEOUT_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Validates the stateless HMAC token
 */
export function validateAdminSession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  try {
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    if (sig !== expectedSig) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.email || !payload.expiresAt) return null;
    if (Date.now() > payload.expiresAt) {
      console.log(`[Admin Auth] Session for ${payload.email} expired.`);
      return null;
    }
    return {
      token,
      email: payload.email,
      createdAt: payload.createdAt,
      lastActiveAt: Date.now(),
    };
  } catch (err) {
    return null;
  }
}

export function destroyAdminSession(token) {
  // Stateless token invalidated via client clearing cookie/localStorage
}

export function destroyAllAdminSessions() {
  // Stateless
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
