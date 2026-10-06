import { Router } from 'express';
import { pool, rowToProduct } from '../db.js';

export const wishlistRouter = Router();

async function getWishlist(sessionId) {
  const [rows] = await pool.query(`
    SELECT p.* FROM wishlist_items w
    JOIN products p ON p.id = w.product_id
    WHERE w.session_id = ?
    ORDER BY w.added_at DESC
  `, [sessionId]);
  return { items: rows.map(rowToProduct) };
}

wishlistRouter.get('/', async (req, res) => {
  try {
    const list = await getWishlist(req.sessionId);
    res.json(list);
  } catch (err) {
    console.error('Get wishlist error:', err);
    res.status(500).json({ error: err.message });
  }
});

wishlistRouter.post('/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (!productId || Number.isNaN(productId)) return res.status(400).json({ error: 'Invalid productId' });
    const [products] = await pool.query('SELECT id FROM products WHERE id = ?', [productId]);
    if (products.length === 0) return res.status(404).json({ error: 'Product not found' });

    await pool.query(
      'INSERT IGNORE INTO wishlist_items (session_id, product_id) VALUES (?, ?)',
      [req.sessionId, productId]
    );

    const list = await getWishlist(req.sessionId);
    res.status(201).json(list);
  } catch (err) {
    console.error('Add to wishlist error:', err);
    res.status(500).json({ error: err.message });
  }
});

wishlistRouter.delete('/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (!productId || Number.isNaN(productId)) return res.status(400).json({ error: 'Invalid productId' });
    await pool.query(
      'DELETE FROM wishlist_items WHERE session_id = ? AND product_id = ?',
      [req.sessionId, productId]
    );
    const list = await getWishlist(req.sessionId);
    res.json(list);
  } catch (err) {
    console.error('Delete from wishlist error:', err);
    res.status(500).json({ error: err.message });
  }
});
