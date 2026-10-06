import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const uploadRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.webp';
    const cleanName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 30);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${cleanName || 'img'}-${uniqueSuffix}${ext}`);
  },
});

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

// Single file upload endpoint
uploadRouter.post('/single', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Upload single error:', err);
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const relativeUrl = `uploads/${req.file.filename}`;
    res.json({
      success: true,
      url: relativeUrl,
      filename: req.file.filename,
      size: req.file.size,
    });
  });
});

// Multiple files upload endpoint
uploadRouter.post('/multiple', (req, res) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      console.error('Upload multiple error:', err);
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }
    const files = req.files.map((f) => ({
      url: `uploads/${f.filename}`,
      filename: f.filename,
      size: f.size,
    }));
    res.json({
      success: true,
      files,
      urls: files.map((f) => f.url),
    });
  });
});
