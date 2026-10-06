import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb, pool } from './db.js';
import { sessionMiddleware } from './session.js';
import { productsRouter } from './routes/products.js';
import { cartRouter } from './routes/cart.js';
import { addressRouter } from './routes/address.js';
import { ordersRouter } from './routes/orders.js';
import { wishlistRouter } from './routes/wishlist.js';
import { payuRouter } from './routes/payu.js';
import { adminRouter } from './routes/admin.js';
import { settingsRouter, bannersRouter } from './routes/settings.js';
import { uploadRouter } from './routes/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(sessionMiddleware);

app.use('/api/settings', settingsRouter);
app.use('/api/banners', bannersRouter);
app.use('/api/products', productsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/cart', cartRouter);
app.use('/api/address', addressRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/payu', payuRouter);
app.use('/api/admin', adminRouter);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Dynamic uploads handler: serve from public/uploads disk if exists, otherwise fallback to MySQL uploaded_files
app.get('/uploads/:filename', async (req, res, next) => {
  try {
    const filename = path.basename(req.params.filename);
    const diskPath = path.join(__dirname, '..', 'public', 'uploads', filename);
    if (fs.existsSync(diskPath)) {
      return res.sendFile(diskPath);
    }
    const [rows] = await pool.query(
      'SELECT mime_type, data FROM uploaded_files WHERE filename = ? LIMIT 1',
      [filename]
    );
    if (rows && rows.length > 0) {
      res.setHeader('Content-Type', rows[0].mime_type || 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(rows[0].data);
    }
  } catch (err) {
    console.error('Error serving upload from MySQL:', err.message);
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Initialize MySQL database and schema, then start listening if not running in serverless Vercel
try {
  await initDb();
  if (!process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log(`meesho clone webapp running on MySQL at http://localhost:${PORT}`);
    });
  }
} catch (err) {
  console.error('Fatal error starting server:', err);
  if (!process.env.VERCEL) {
    process.exit(1);
  }
}

export default app;

