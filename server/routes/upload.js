import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

export const uploadRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

// Use memoryStorage so file uploads succeed in read-only serverless environments like Vercel
const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  const allowedMime = /^image\/(jpeg|jpg|png|webp|gif|avif|svg\+xml)$/;
  if (allowedMime.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, WebP, GIF, AVIF, SVG) are allowed!'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB max
  },
});

function generateCleanFilename(originalName) {
  const ext = path.extname(originalName).toLowerCase() || '.webp';
  const cleanName = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 30);
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `${cleanName || 'img'}-${uniqueSuffix}${ext}`;
}

async function persistFile(file) {
  const filename = generateCleanFilename(file.originalname);

  // 1. Persist file BLOB into MySQL database (accessible on Vercel Serverless across all instances)
  try {
    await pool.query(
      `INSERT INTO uploaded_files (filename, mime_type, data, size) 
       VALUES (?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE data = VALUES(data), size = VALUES(size)`,
      [filename, file.mimetype, file.buffer, file.size]
    );
  } catch (dbErr) {
    console.error('[Upload] Error storing file in database:', dbErr.message);
  }

  // 2. Best-effort write to local disk if running in writable environment (e.g. local dev)
  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer);
  } catch (_fsErr) {
    // Expected and safely ignored on read-only serverless filesystems (e.g. Vercel)
  }

  return filename;
}

// Single file upload endpoint
uploadRouter.post('/single', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('Upload single error:', err);
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    try {
      const filename = await persistFile(req.file);
      const relativeUrl = `uploads/${filename}`;
      res.json({
        success: true,
        url: relativeUrl,
        filename,
        size: req.file.size,
      });
    } catch (saveErr) {
      console.error('Error persisting file:', saveErr);
      res.status(500).json({ success: false, error: 'Failed to save file: ' + saveErr.message });
    }
  });
});

// Multiple files upload endpoint
uploadRouter.post('/multiple', (req, res) => {
  upload.array('files', 20)(req, res, async (err) => {
    if (err) {
      console.error('Upload multiple error:', err);
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    try {
      const files = [];
      for (const file of req.files) {
        const filename = await persistFile(file);
        files.push({
          url: `uploads/${filename}`,
          filename,
          size: file.size,
        });
      }
      res.json({
        success: true,
        files,
        urls: files.map((f) => f.url),
      });
    } catch (saveErr) {
      console.error('Error persisting files:', saveErr);
      res.status(500).json({ success: false, error: 'Failed to save files: ' + saveErr.message });
    }
  });
});

// Dedicated file retrieval endpoint from MySQL
uploadRouter.get('/file/:filename', async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const [rows] = await pool.query('SELECT mime_type, data FROM uploaded_files WHERE filename = ? LIMIT 1', [filename]);
    if (rows && rows.length > 0) {
      res.setHeader('Content-Type', rows[0].mime_type || 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(rows[0].data);
    }
    return res.status(404).send('File not found');
  } catch (err) {
    console.error('Error fetching file from db:', err.message);
    return res.status(500).send('Database error');
  }
});
