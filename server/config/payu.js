import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'payu-config.json');

export const DEFAULT_PAYU_CONFIG = {
  key: 'ltA5VE',
  salt: '0FohIsLGiu4G5RKD8lUU0OO9aDPwwRkX',
  baseUrl: 'https://secure.payu.in',
  mode: 'production',
};

function loadStoredConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return {
        key: (data.key || process.env.PAYU_MERCHANT_KEY || DEFAULT_PAYU_CONFIG.key).trim(),
        salt: (data.salt || process.env.PAYU_MERCHANT_SALT || DEFAULT_PAYU_CONFIG.salt).trim(),
        baseUrl: (data.baseUrl || process.env.PAYU_BASE_URL || DEFAULT_PAYU_CONFIG.baseUrl).trim(),
        mode: data.mode || (data.baseUrl && data.baseUrl.includes('test') ? 'test' : 'production'),
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    }
  } catch (err) {
    console.error('[PayU Config] Error reading config file, falling back to defaults:', err.message);
  }

  return {
    key: (process.env.PAYU_MERCHANT_KEY || DEFAULT_PAYU_CONFIG.key).trim(),
    salt: (process.env.PAYU_MERCHANT_SALT || DEFAULT_PAYU_CONFIG.salt).trim(),
    baseUrl: (process.env.PAYU_BASE_URL || DEFAULT_PAYU_CONFIG.baseUrl).trim(),
    mode: DEFAULT_PAYU_CONFIG.mode,
    updatedAt: new Date().toISOString(),
  };
}

const initialConfig = loadStoredConfig();

export const PAYU_CONFIG = {
  key: initialConfig.key,
  salt: initialConfig.salt,
  baseUrl: initialConfig.baseUrl,
  mode: initialConfig.mode,
  updatedAt: initialConfig.updatedAt,
};

/**
 * Mask salt for safe UI display (e.g., "0Foh...RkX")
 */
export function maskSecret(secret = '') {
  if (!secret || secret.length < 8) return '********';
  return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`;
}

/**
 * Get the current active PayU configuration
 */
export function getPayuConfig() {
  return {
    key: PAYU_CONFIG.key,
    salt: PAYU_CONFIG.salt,
    maskedSalt: maskSecret(PAYU_CONFIG.salt),
    baseUrl: PAYU_CONFIG.baseUrl,
    mode: PAYU_CONFIG.mode || (PAYU_CONFIG.baseUrl.includes('test') ? 'test' : 'production'),
    updatedAt: PAYU_CONFIG.updatedAt,
  };
}

/**
 * Persistently save updated PayU credentials without touching the database
 */
export function savePayuConfig({ key, salt, baseUrl, mode }) {
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error('Merchant Key is required');
  }
  if (!salt || typeof salt !== 'string' || !salt.trim()) {
    throw new Error('Merchant Salt is required');
  }

  const newKey = key.trim();
  const newSalt = salt.trim();
  const newMode = mode === 'test' ? 'test' : 'production';
  const newBaseUrl = (baseUrl && baseUrl.trim())
    ? baseUrl.trim()
    : (newMode === 'test' ? 'https://test.payu.in' : 'https://secure.payu.in');

  PAYU_CONFIG.key = newKey;
  PAYU_CONFIG.salt = newSalt;
  PAYU_CONFIG.baseUrl = newBaseUrl;
  PAYU_CONFIG.mode = newMode;
  PAYU_CONFIG.updatedAt = new Date().toISOString();

  const dataToSave = {
    key: PAYU_CONFIG.key,
    salt: PAYU_CONFIG.salt,
    baseUrl: PAYU_CONFIG.baseUrl,
    mode: PAYU_CONFIG.mode,
    updatedAt: PAYU_CONFIG.updatedAt,
  };

  const dataDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
  return getPayuConfig();
}

/**
 * Reset PayU configuration to the default keys
 */
export function resetPayuConfig() {
  return savePayuConfig({
    key: DEFAULT_PAYU_CONFIG.key,
    salt: DEFAULT_PAYU_CONFIG.salt,
    baseUrl: DEFAULT_PAYU_CONFIG.baseUrl,
    mode: DEFAULT_PAYU_CONFIG.mode,
  });
}

/**
 * Generate SHA-512 request hash for PayU Hosted Checkout.
 * Formula: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
 */
export function generatePayuHash({
  key = PAYU_CONFIG.key,
  txnid,
  amount,
  productinfo,
  firstname,
  email,
  udf1 = '',
  udf2 = '',
  udf3 = '',
  udf4 = '',
  udf5 = '',
  salt = PAYU_CONFIG.salt,
}) {
  const hashString = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
  return crypto.createHash('sha512').update(hashString).digest('hex');
}

/**
 * Verify PayU response hash (Reverse Hashing).
 * Formula: sha512([additionalCharges|]SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 */
export function verifyPayuResponseHash(params, salt = PAYU_CONFIG.salt) {
  const {
    status = '',
    firstname = '',
    amount = '',
    txnid = '',
    productinfo = '',
    email = '',
    udf1 = '',
    udf2 = '',
    udf3 = '',
    udf4 = '',
    udf5 = '',
    key = PAYU_CONFIG.key,
    additionalCharges,
    hash: receivedHash = '',
  } = params;

  let hashSequence;
  if (additionalCharges) {
    hashSequence = `${additionalCharges}|${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  } else {
    hashSequence = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  }

  const calculatedHash = crypto.createHash('sha512').update(hashSequence).digest('hex');
  return calculatedHash.toLowerCase() === receivedHash.toLowerCase();
}

