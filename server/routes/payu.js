import { Router } from 'express';
import { pool, rowToProduct } from '../db.js';
import { PAYU_CONFIG, generatePayuHash, verifyPayuResponseHash } from '../config/payu.js';
import { getMaxOrderValue } from './cart.js';

export const payuRouter = Router();

function generateTxnId() {
  const timestamp = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `M_${timestamp}_${rand}`;
}

export async function getEffectivePayuCredentials() {
  let key = PAYU_CONFIG.key;
  let salt = PAYU_CONFIG.salt;
  let baseUrl = PAYU_CONFIG.baseUrl;
  let mode = PAYU_CONFIG.mode;

  try {
    const [settings] = await pool.query(
      "SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('payu_key', 'payu_salt', 'payu_base_url', 'payu_mode')"
    );
    for (const s of settings) {
      if (s.setting_key === 'payu_key' && s.setting_value) key = s.setting_value.trim();
      if (s.setting_key === 'payu_salt' && s.setting_value) salt = s.setting_value.trim();
      if (s.setting_key === 'payu_base_url' && s.setting_value) baseUrl = s.setting_value.trim();
      if (s.setting_key === 'payu_mode' && s.setting_value) mode = s.setting_value.trim();
    }
  } catch (e) {
    // fallback to PAYU_CONFIG
  }
  return { key, salt, baseUrl, mode };
}

/**
 * POST /api/payu/initiate
 * Prepares the PayU transaction, writes the order as 'pending' in MySQL,
 * generates the secure SHA-512 payment hash, and returns payment parameters.
 */
payuRouter.post('/initiate', async (req, res) => {
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
      return res.status(400).json({ error: 'Please enter a delivery address first' });
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

    const amountStr = Number(totalPrice).toFixed(2);

    const txnid = generateTxnId();

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

    // Record initial order as 'pending'
    await pool.query(`
      INSERT INTO orders (order_id, session_id, items_json, address_json, total_price, total_mrp, cod_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [txnid, req.sessionId, JSON.stringify(items), addressJson, totalPrice, totalMrp, totalPrice]);

    // Sanitize user details for PayU Hosted Checkout
    const cleanFirstName = (address.name || 'Customer').trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '') || 'Customer';
    const cleanPhone = (address.contact_number || '9999999999').replace(/[^0-9]/g, '').slice(-10) || '9999999999';
    const cleanEmail = (address.email || `customer_${cleanPhone}@gmail.com`).trim();
    const productinfo = 'Meesho Order';

    // Callback URLs
    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const callbackUrl = process.env.APP_URL
      ? `${process.env.APP_URL}/api/payu/response`
      : `${protocol}://${host}/api/payu/response`;

    // Retrieve active credentials (from MySQL site_settings or fallback to PAYU_CONFIG)
    const payuCreds = await getEffectivePayuCredentials();

    // Calculate SHA-512 Request Hash
    const hash = generatePayuHash({
      key: payuCreds.key,
      txnid,
      amount: amountStr,
      productinfo,
      firstname: cleanFirstName,
      email: cleanEmail,
      salt: payuCreds.salt,
    });

    const payuAction = `${payuCreds.baseUrl}/_payment`;

    res.json({
      success: true,
      action: payuAction,
      params: {
        key: payuCreds.key,
        txnid,
        amount: amountStr,
        productinfo,
        firstname: cleanFirstName,
        email: cleanEmail,
        phone: cleanPhone,
        surl: callbackUrl,
        furl: callbackUrl,
        hash,
      },
    });
  } catch (err) {
    console.error('PayU Initiate Error:', err);
    res.status(500).json({ error: err.message || 'Failed to initiate PayU payment' });
  }
});

/**
 * Ensures cart and address are restored if an order payment fails/is cancelled
 */
async function ensureCartAndAddress(order) {
  if (!order || !order.session_id) return;

  if (order.items_json) {
    try {
      const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM cart_items WHERE session_id = ?', [order.session_id]);
      if (count === 0) {
        const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : order.items_json;
        for (const it of items) {
          await pool.query(
            'REPLACE INTO cart_items (session_id, product_id, size, quantity) VALUES (?, ?, ?, ?)',
            [order.session_id, it.id, it.size, it.quantity || 1]
          );
        }
      }
    } catch (e) {
      console.error('[PayU] Error restoring cart items:', e);
    }
  }

  if (order.address_json) {
    try {
      const [existingAddr] = await pool.query('SELECT * FROM addresses WHERE session_id = ?', [order.session_id]);
      if (existingAddr.length === 0) {
        const addr = typeof order.address_json === 'string' ? JSON.parse(order.address_json) : order.address_json;
        await pool.query(`
          REPLACE INTO addresses (session_id, name, contact_number, pincode, house_no, road_area, city, state, landmark)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [order.session_id, addr.name, addr.contactNumber, addr.pincode, addr.houseNo, addr.roadArea || '', addr.city, addr.state, addr.landmark || '']);
      }
    } catch (e) {
      console.error('[PayU] Error restoring address:', e);
    }
  }
}

/**
 * POST /api/payu/response
 * Handles the PayU callback (surl and furl), verifies reverse hash,
 * updates order status, and redirects the user.
 */
payuRouter.post('/response', async (req, res) => {
  try {
    const {
      status,
      txnid,
      amount,
      mihpayid,
      error_Message,
      unmappedstatus,
      hash,
    } = req.body;

    console.log(`[PayU Response] txnid=${txnid}, status=${status}, mihpayid=${mihpayid}`);

    let order = null;
    if (txnid) {
      const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [txnid]);
      if (orders.length > 0) order = orders[0];
    }

    if (order && order.session_id) {
      res.cookie('sid', order.session_id, {
        maxAge: 1000 * 60 * 60 * 24 * 90,
        httpOnly: true,
        sameSite: 'lax',
      });
    }

    const payuCreds = await getEffectivePayuCredentials();
    const isHashValid = verifyPayuResponseHash(req.body, payuCreds.salt);

    if (!isHashValid) {
      console.error(`[PayU] Hash mismatch for txnid=${txnid}. Received: ${hash}`);
      await pool.query(`
        UPDATE orders SET status = 'failed', payu_status = 'tampered'
        WHERE order_id = ?
      `, [txnid]);

      await ensureCartAndAddress(order);
      return res.redirect(`/address.html?payment=failed&orderId=${encodeURIComponent(txnid)}&error=Security+verification+failed`);
    }

    if (status === 'success') {
      await pool.query(`
        UPDATE orders
        SET status = 'confirmed', payment_id = ?, payu_status = ?
        WHERE order_id = ?
      `, [mihpayid || null, status, txnid]);

      if (order && order.session_id) {
        await pool.query('DELETE FROM cart_items WHERE session_id = ?', [order.session_id]);
      }

      return res.redirect(`/order-confirmation.html?orderId=${encodeURIComponent(txnid)}&payment=success`);
    } else {
      const reason = error_Message || unmappedstatus || 'Payment was unsuccessful or cancelled';
      await pool.query(`
        UPDATE orders
        SET status = 'failed', payment_id = ?, payu_status = ?
        WHERE order_id = ?
      `, [mihpayid || null, status || 'failed', txnid]);

      await ensureCartAndAddress(order);

      return res.redirect(`/address.html?payment=failed&orderId=${encodeURIComponent(txnid)}&error=${encodeURIComponent(reason)}`);
    }
  } catch (err) {
    console.error('PayU Callback Error:', err);
    res.redirect(`/address.html?payment=failed&error=${encodeURIComponent(err.message || 'Payment processing error')}`);
  }
});

/**
 * POST /api/payu/restore-session
 */
payuRouter.post('/restore-session', async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    if (orders.length === 0) return res.status(404).json({ error: 'Order not found' });
    const order = orders[0];

    res.cookie('sid', order.session_id, {
      maxAge: 1000 * 60 * 60 * 24 * 90,
      httpOnly: true,
      sameSite: 'lax',
    });

    await ensureCartAndAddress(order);

    res.json({ success: true, sessionId: order.session_id });
  } catch (err) {
    console.error('PayU Restore Session Error:', err);
    res.status(500).json({ error: err.message || 'Failed to restore session' });
  }
});
