import { Router } from 'express';
import { pool, rowToProduct } from '../db.js';
import { getMaxOrderValue } from './cart.js';

export const ordersRouter = Router();

function generateOrderId() {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  const r = Math.floor(100000 + Math.random() * 900000);
  return `Meesho_${y}${m}${d}${r}`;
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    items: typeof row.items_json === 'string' ? JSON.parse(row.items_json) : row.items_json,
    address: row.address_json ? (typeof row.address_json === 'string' ? JSON.parse(row.address_json) : row.address_json) : null,
    totalPrice: row.total_price,
    totalMrp: row.total_mrp,
    savedAmount: Math.max(0, row.total_mrp - row.total_price),
    paidAmount: row.cod_amount,
    deliveryFee: 0,
    status: row.status,
    createdAt: row.created_at,
  };
}

ordersRouter.post('/', async (req, res) => {
  try {
    const [cartRows] = await pool.query(`
      SELECT c.size, c.quantity, p.* FROM cart_items c
      JOIN products p ON p.id = c.product_id
      WHERE c.session_id = ?
    `, [req.sessionId]);

    if (cartRows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const [addresses] = await pool.query('SELECT * FROM addresses WHERE session_id = ?', [req.sessionId]);
    if (addresses.length === 0) {
      return res.status(400).json({ error: 'No delivery address on file' });
    }
    const address = addresses[0];

    const items = cartRows.map((r) => ({
      ...rowToProduct(r),
      size: r.size,
      quantity: r.quantity,
    }));

    const totalPrice = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const totalMrp = items.reduce((s, i) => s + i.mrp * i.quantity, 0);

    const maxOrderValue = await getMaxOrderValue();
    if (totalPrice > maxOrderValue) {
      return res.status(400).json({ error: `Order amount cannot exceed ₹${maxOrderValue}` });
    }

    const paidAmount = totalPrice;

    const orderId = generateOrderId();
    const addressJson = JSON.stringify({
      name: address.name,
      contactNumber: address.contact_number,
      pincode: address.pincode,
      houseNo: address.house_no,
      roadArea: address.road_area,
      city: address.city,
      state: address.state,
      landmark: address.landmark,
    });

    await pool.query(`
      INSERT INTO orders (order_id, session_id, items_json, address_json, total_price, total_mrp, cod_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')
    `, [orderId, req.sessionId, JSON.stringify(items), addressJson, totalPrice, totalMrp, paidAmount]);

    await pool.query('DELETE FROM cart_items WHERE session_id = ?', [req.sessionId]);

    const [orderRows] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    res.status(201).json(rowToOrder(orderRows[0]));
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: err.message });
  }
});

ordersRouter.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM orders WHERE session_id = ? ORDER BY created_at DESC',
      [req.sessionId]
    );
    res.json(rows.map(rowToOrder));
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: err.message });
  }
});

ordersRouter.get('/:orderId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM orders WHERE order_id = ? AND session_id = ?',
      [req.params.orderId, req.sessionId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(rowToOrder(rows[0]));
  } catch (err) {
    console.error('Get order detail error:', err);
    res.status(500).json({ error: err.message });
  }
});
