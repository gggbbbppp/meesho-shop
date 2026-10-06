import { Router } from 'express';
import { pool, rowToProduct } from '../db.js';

export const cartRouter = Router();

const DEFAULT_MAX_ORDER_VALUE = 299;
const MAX_ITEM_QUANTITY = 1;

export async function getMaxOrderValue() {
  try {
    const [rows] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key = 'max_order_amount'");
    if (rows.length > 0 && rows[0].setting_value) {
      const parsed = parseFloat(rows[0].setting_value);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch (err) {
    console.warn('Error reading max_order_amount setting:', err.message);
  }
  return DEFAULT_MAX_ORDER_VALUE;
}

async function getCart(sessionId) {
  const [rows] = await pool.query(`
    SELECT c.product_id, c.size, c.quantity, p.*
    FROM cart_items c JOIN products p ON p.id = c.product_id
    WHERE c.session_id = ?
    ORDER BY p.id
  `, [sessionId]);

  const items = rows.map((r) => ({
    ...rowToProduct(r),
    size: r.size,
    quantity: r.quantity,
    seller: 'Meesho Seller',
    easyReturns: r.price >= 119,
  }));

  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalMrp = items.reduce((s, i) => s + i.mrp * i.quantity, 0);

  return { items, totals: { totalItems, totalPrice, totalMrp } };
}

cartRouter.get('/', async (req, res) => {
  try {
    const cart = await getCart(req.sessionId);
    res.json(cart);
  } catch (err) {
    console.error('Get cart error:', err);
    res.status(500).json({ error: err.message });
  }
});

cartRouter.post('/', async (req, res) => {
  try {
    const { productId, size } = req.body || {};
    const id = parseInt(productId, 10);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid productId' });
    }
    const [products] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (products.length === 0) return res.status(404).json({ error: 'Product not found' });
    const product = products[0];

    const maxOrderValue = await getMaxOrderValue();
    if (product.price > maxOrderValue) {
      return res.status(400).json({
        error: 'order_value_exceeded',
        message: `This item is priced above the ₹${maxOrderValue} order limit and can't be added.`,
      });
    }

    const [existing] = await pool.query(
      'SELECT quantity FROM cart_items WHERE session_id = ? AND product_id = ? AND size = ?',
      [req.sessionId, product.id, size]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        error: 'quantity_limit_exceeded',
        message: `Maximum quantity per order is ${MAX_ITEM_QUANTITY}.`,
      });
    }

    const [otherItem] = await pool.query(
      'SELECT 1 FROM cart_items WHERE session_id = ? AND NOT (product_id = ? AND size = ?) LIMIT 1',
      [req.sessionId, product.id, size]
    );

    if (otherItem.length > 0) {
      return res.status(400).json({
        error: 'cart_item_limit_exceeded',
        message: 'Only one item is allowed in your cart at a time. Remove the current item to add a different one.',
      });
    }

    await pool.query(
      'INSERT INTO cart_items (session_id, product_id, size, quantity) VALUES (?, ?, ?, 1)',
      [req.sessionId, product.id, size]
    );

    const cart = await getCart(req.sessionId);
    res.status(201).json(cart);
  } catch (err) {
    console.error('Add to cart error:', err);
    res.status(500).json({ error: err.message });
  }
});

cartRouter.patch('/:productId/:size', async (req, res) => {
  try {
    const { productId, size } = req.params;
    const qty = Number(req.body?.quantity);

    if (!Number.isFinite(qty) || qty <= 0) {
      await pool.query(
        'DELETE FROM cart_items WHERE session_id = ? AND product_id = ? AND size = ?',
        [req.sessionId, Number(productId), size]
      );
      const cart = await getCart(req.sessionId);
      return res.json(cart);
    }

    const [current] = await pool.query(
      'SELECT quantity FROM cart_items WHERE session_id = ? AND product_id = ? AND size = ?',
      [req.sessionId, Number(productId), size]
    );

    if (current.length === 0) return res.status(404).json({ error: 'Cart item not found' });

    if (qty > MAX_ITEM_QUANTITY) {
      return res.status(400).json({
        error: 'quantity_limit_exceeded',
        message: `Maximum quantity per order is ${MAX_ITEM_QUANTITY}.`,
      });
    }

    await pool.query(
      'UPDATE cart_items SET quantity = ? WHERE session_id = ? AND product_id = ? AND size = ?',
      [qty, req.sessionId, Number(productId), size]
    );

    const cart = await getCart(req.sessionId);
    res.json(cart);
  } catch (err) {
    console.error('Update cart item error:', err);
    res.status(500).json({ error: err.message });
  }
});

cartRouter.delete('/:productId/:size', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM cart_items WHERE session_id = ? AND product_id = ? AND size = ?',
      [req.sessionId, Number(req.params.productId), req.params.size]
    );
    const cart = await getCart(req.sessionId);
    res.json(cart);
  } catch (err) {
    console.error('Delete cart item error:', err);
    res.status(500).json({ error: err.message });
  }
});

cartRouter.delete('/', async (req, res) => {
  try {
    await pool.query('DELETE FROM cart_items WHERE session_id = ?', [req.sessionId]);
    const cart = await getCart(req.sessionId);
    res.json(cart);
  } catch (err) {
    console.error('Clear cart error:', err);
    res.status(500).json({ error: err.message });
  }
});
