import { Router } from 'express';
import { pool, initDb } from '../db.js';
import {
  PAYU_CONFIG,
  getPayuConfig,
  savePayuConfig,
  resetPayuConfig,
  generatePayuHash,
  verifyPayuResponseHash,
  maskSecret,
} from '../config/payu.js';
import {
  loadAdminAuth,
  saveAdminAuth,
  cleanPhone,
  createAdminSession,
  validateAdminSession,
  destroyAdminSession,
  destroyAllAdminSessions,
  requireAdminAuth,
  INACTIVITY_TIMEOUT_MS,
} from '../config/adminAuth.js';

export const adminRouter = Router();

/**
 * POST /api/admin/login
 * Verify admin ID and password, create session with 10-minute inactivity timeout
 */
adminRouter.post('/login', (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Admin ID and password are required' });
    }

    const auth = loadAdminAuth();
    const isEmailValid = email.trim().toLowerCase() === auth.email;
    const isPasswordValid = String(password) === auth.password;

    if (!isEmailValid || !isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Admin ID or password. Please check your credentials.',
      });
    }

    const token = createAdminSession(auth.email);

    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    res.cookie('admin_token', token, {
      httpOnly: true,
      maxAge: INACTIVITY_TIMEOUT_MS,
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
    });

    console.log(`[Admin Auth] Successful login for ${auth.email}`);

    res.json({
      success: true,
      message: 'Admin login successful',
      token,
      email: auth.email,
      inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
    });
  } catch (err) {
    console.error('[Admin] Login error:', err);
    res.status(500).json({ success: false, error: err.message || 'Login failed' });
  }
});

/**
 * POST /api/admin/logout
 * Invalidate admin session and clear cookie (supports beacon & unload)
 */
adminRouter.post('/logout', (req, res) => {
  try {
    let token = req.cookies?.admin_token || req.headers['x-admin-token'];
    if (!token && typeof req.body === 'string' && req.body.trim()) {
      try {
        const parsed = JSON.parse(req.body);
        token = parsed.token;
      } catch (e) {
        token = req.body.trim();
      }
    }
    if (token) {
      destroyAdminSession(token);
    }
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    res.clearCookie('admin_token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
    });
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('[Admin] Logout error:', err);
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

/**
 * GET /api/admin/profile
 * Get current admin ID, recovery phone, and password info (Protected)
 */
adminRouter.get('/profile', requireAdminAuth, (req, res) => {
  try {
    const auth = loadAdminAuth();
    res.json({
      success: true,
      profile: {
        email: auth.email,
        recoveryPhone: auth.recoveryPhone,
        password: auth.password,
        updatedAt: auth.updatedAt,
      },
    });
  } catch (err) {
    console.error('[Admin] Get profile error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch admin profile' });
  }
});

/**
 * POST /api/admin/profile
 * Set and manage admin ID, password, and recovery mobile number (Protected)
 */
adminRouter.post('/profile', requireAdminAuth, (req, res) => {
  try {
    const { email, password, recoveryPhone } = req.body || {};

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Admin ID (email) is required' });
    }

    if (!recoveryPhone || !String(recoveryPhone).trim()) {
      return res.status(400).json({ success: false, error: 'Recovery mobile number is required' });
    }

    const cleanNum = cleanPhone(recoveryPhone);
    if (cleanNum.length !== 10) {
      return res.status(400).json({ success: false, error: 'Recovery mobile number must be exactly 10 digits' });
    }

    if (password && String(password).trim().length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long' });
    }

    const updated = saveAdminAuth({
      email: email.trim().toLowerCase(),
      password: password && String(password).trim() ? String(password) : undefined,
      recoveryPhone: cleanNum,
    });

    if (req.adminSession) {
      req.adminSession.email = updated.email;
    }

    console.log(`[Admin Auth] Profile updated: Email=${updated.email}, Phone=${updated.recoveryPhone}`);

    res.json({
      success: true,
      message: 'Admin ID, password, and mobile number updated successfully',
      profile: {
        email: updated.email,
        recoveryPhone: updated.recoveryPhone,
        password: updated.password,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    console.error('[Admin] Update profile error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update admin profile' });
  }
});


/**
 * GET /api/admin/session
 * Check current authentication state and refresh sliding activity timestamp
 */
adminRouter.get('/session', (req, res) => {
  const token = req.cookies?.admin_token || req.headers['x-admin-token'] || (
    req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null
  );

  const session = validateAdminSession(token);
  if (!session) {
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    res.clearCookie('admin_token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
    });
    return res.json({ success: true, authenticated: false });
  }

  res.json({
    success: true,
    authenticated: true,
    email: session.email,
    inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
  });
});

/**
 * POST /api/admin/verify-reset-number
 * Checks if the entered phone number matches registered admin phone (9537175050)
 */
adminRouter.post('/verify-reset-number', (req, res) => {
  try {
    const { phone } = req.body || {};

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Please enter your registered mobile number' });
    }

    const auth = loadAdminAuth();
    const enteredClean = cleanPhone(phone);

    if (enteredClean !== auth.recoveryPhone) {
      return res.status(400).json({
        success: false,
        error: 'Verification failed: The entered mobile number does not match the registered admin contact (9537175050). Password cannot be reset.',
      });
    }

    res.json({
      success: true,
      verified: true,
      message: 'Mobile number verified successfully. You may now enter your new password.',
    });
  } catch (err) {
    console.error('[Admin] Phone verification error:', err);
    res.status(500).json({ success: false, error: 'Phone verification error' });
  }
});

/**
 * POST /api/admin/reset-password
 * Set new password if recovery phone matches registered contact (9537175050)
 */
adminRouter.post('/reset-password', (req, res) => {
  try {
    const { phone, newPassword } = req.body || {};

    if (!phone || !newPassword) {
      return res.status(400).json({ success: false, error: 'Mobile number and new password are required' });
    }

    const auth = loadAdminAuth();
    const enteredClean = cleanPhone(phone);

    if (enteredClean !== auth.recoveryPhone) {
      return res.status(400).json({
        success: false,
        error: 'Verification failed: Mobile number does not match registered admin contact. Password cannot be reset.',
      });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long' });
    }

    saveAdminAuth({ password: String(newPassword) });
    destroyAllAdminSessions();
    res.clearCookie('admin_token');

    console.log('[Admin Auth] Password successfully updated via phone verification');

    res.json({
      success: true,
      message: 'Password reset successfully! Please log in with your new password.',
    });
  } catch (err) {
    console.error('[Admin] Reset password error:', err);
    res.status(500).json({ success: false, error: 'Password reset failed' });
  }
});

/**
 * PROTECTED ROUTES BELOW
 */

/**
 * GET /api/admin/payu-config
 */
adminRouter.get('/payu-config', requireAdminAuth, (req, res) => {
  try {
    const config = getPayuConfig();
    res.json({
      success: true,
      config,
    });
  } catch (err) {
    console.error('[Admin] Get PayU config error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch PayU config' });
  }
});

/**
 * POST /api/admin/payu-config
 */
adminRouter.post('/payu-config', requireAdminAuth, (req, res) => {
  try {
    const { key, salt, baseUrl, mode } = req.body || {};

    if (!key || typeof key !== 'string' || !key.trim()) {
      return res.status(400).json({ success: false, error: 'Merchant Key is required' });
    }
    if (!salt || typeof salt !== 'string' || !salt.trim()) {
      return res.status(400).json({ success: false, error: 'Merchant Salt is required' });
    }

    const updatedConfig = savePayuConfig({ key, salt, baseUrl, mode });

    console.log(`[Admin] PayU credentials updated: Key=${updatedConfig.key}, Salt=${updatedConfig.maskedSalt}, Mode=${updatedConfig.mode}`);

    res.json({
      success: true,
      message: 'PayU credentials updated and activated successfully',
      config: updatedConfig,
    });
  } catch (err) {
    console.error('[Admin] Update PayU config error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update PayU credentials' });
  }
});

/**
 * POST /api/admin/payu-config/reset
 */
adminRouter.post('/payu-config/reset', requireAdminAuth, (req, res) => {
  try {
    const resetConfig = resetPayuConfig();
    console.log(`[Admin] PayU credentials reset to defaults: Key=${resetConfig.key}`);
    res.json({
      success: true,
      message: 'PayU credentials reset to default keys',
      config: resetConfig,
    });
  } catch (err) {
    console.error('[Admin] Reset PayU config error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to reset PayU credentials' });
  }
});

/**
 * POST /api/admin/payu-config/test-hash
 */
adminRouter.post('/payu-config/test-hash', requireAdminAuth, (req, res) => {
  try {
    const {
      txnid = `TEST_${Date.now()}`,
      amount = '299.00',
      productinfo = 'Test Product',
      firstname = 'Customer',
      email = 'customer@example.com',
      udf1 = '',
      udf2 = '',
      udf3 = '',
      udf4 = '',
      udf5 = '',
    } = req.body || {};

    const hash = generatePayuHash({
      key: PAYU_CONFIG.key,
      txnid,
      amount: String(amount),
      productinfo,
      firstname,
      email,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
      salt: PAYU_CONFIG.salt,
    });

    res.json({
      success: true,
      gateway: {
        key: PAYU_CONFIG.key,
        salt: PAYU_CONFIG.salt,
        maskedSalt: maskSecret(PAYU_CONFIG.salt),
        baseUrl: PAYU_CONFIG.baseUrl,
        mode: PAYU_CONFIG.mode,
      },
      testInputs: {
        txnid,
        amount,
        productinfo,
        firstname,
        email,
      },
      requestHash: hash,
      hashFormula: 'sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT)',
      hashSequencePreview: `${PAYU_CONFIG.key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||${maskSecret(PAYU_CONFIG.salt)}`,
    });
  } catch (err) {
    console.error('[Admin] Test hash error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to compute test hash' });
  }
});

/**
 * GET /api/admin/orders/analytics
 * Executive order analytics: Today vs Yesterday revenue, success vs failure counts, and conversion rates
 */
adminRouter.get('/orders/analytics', requireAdminAuth, async (req, res) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    // Grouped by date and status
    const [rows] = await pool.query(`
      SELECT
        DATE(created_at) as order_date,
        status,
        COUNT(*) as count,
        COALESCE(SUM(total_price), 0) as total_amount
      FROM orders
      GROUP BY DATE(created_at), status
    `);

    // Grouped by status (All Time)
    const [allTimeRows] = await pool.query(`
      SELECT
        status,
        COUNT(*) as count,
        COALESCE(SUM(total_price), 0) as total_amount
      FROM orders
      GROUP BY status
    `);

    const aggregateForDate = (dateMatch) => {
      const matching = rows.filter((r) => r.order_date === dateMatch);
      let totalOrders = 0;
      let successCount = 0;
      let failedCount = 0;
      let pendingCount = 0;
      let otherCount = 0;
      let amountReceived = 0;
      let amountFailed = 0;
      let amountPending = 0;

      for (const r of matching) {
        const c = Number(r.count) || 0;
        const amt = Number(r.total_amount) || 0;
        totalOrders += c;

        if (['confirmed', 'shipped', 'delivered'].includes(r.status)) {
          successCount += c;
          amountReceived += amt;
        } else if (['failed', 'cancelled'].includes(r.status)) {
          failedCount += c;
          amountFailed += amt;
        } else if (r.status === 'pending') {
          pendingCount += c;
          amountPending += amt;
        } else {
          otherCount += c;
        }
      }

      const successRate = totalOrders > 0 ? Math.round((successCount / totalOrders) * 100) : 0;

      return {
        date: dateMatch,
        totalOrders,
        successCount,
        failedCount,
        pendingCount,
        otherCount,
        amountReceived,
        amountFailed,
        amountPending,
        successRate,
      };
    };

    const todayStats = aggregateForDate(todayStr);
    const yesterdayStats = aggregateForDate(yesterdayStr);

    const revenueDiff = todayStats.amountReceived - yesterdayStats.amountReceived;
    let revenueGrowthPercent = 0;
    if (yesterdayStats.amountReceived > 0) {
      revenueGrowthPercent = Math.round(((todayStats.amountReceived - yesterdayStats.amountReceived) / yesterdayStats.amountReceived) * 100);
    } else if (todayStats.amountReceived > 0) {
      revenueGrowthPercent = 100;
    }

    let allTotalOrders = 0;
    let allSuccessCount = 0;
    let allFailedCount = 0;
    let allPendingCount = 0;
    let allTotalRevenue = 0;
    let allFailedRevenue = 0;

    for (const r of allTimeRows) {
      const c = Number(r.count) || 0;
      const amt = Number(r.total_amount) || 0;
      allTotalOrders += c;

      if (['confirmed', 'shipped', 'delivered'].includes(r.status)) {
        allSuccessCount += c;
        allTotalRevenue += amt;
      } else if (['failed', 'cancelled'].includes(r.status)) {
        allFailedCount += c;
        allFailedRevenue += amt;
      } else if (r.status === 'pending') {
        allPendingCount += c;
      }
    }

    const allTimeSuccessRate = allTotalOrders > 0 ? Math.round((allSuccessCount / allTotalOrders) * 100) : 0;

    res.json({
      success: true,
      today: todayStats,
      yesterday: yesterdayStats,
      comparison: {
        revenueDiff,
        revenueGrowthPercent,
        moreThanYesterday: revenueDiff >= 0,
      },
      allTime: {
        totalOrders: allTotalOrders,
        successCount: allSuccessCount,
        failedCount: allFailedCount,
        pendingCount: allPendingCount,
        totalRevenue: allTotalRevenue,
        failedRevenue: allFailedRevenue,
        successRate: allTimeSuccessRate,
      },
      dates: {
        today: todayStr,
        yesterday: yesterdayStr,
      },
    });
  } catch (err) {
    console.error('[Admin] Order analytics error:', err);
    res.status(500).json({ success: false, error: 'Failed to compute order analytics' });
  }
});

/**
 * GET /api/admin/orders
 * Filter, search, and list orders with parsed items and address
 */
adminRouter.get('/orders', requireAdminAuth, async (req, res) => {
  try {
    const { status, dateFilter, search, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT order_id, session_id, items_json, address_json, total_price, total_mrp, cod_amount, status, payment_id, payu_status, created_at
      FROM orders
      WHERE 1=1
    `;
    const params = [];

    // Filter by status
    if (status && status !== 'all') {
      if (status === 'success' || status === 'confirmed') {
        query += ` AND status IN ('confirmed', 'shipped', 'delivered')`;
      } else if (status === 'failed') {
        query += ` AND status IN ('failed', 'cancelled')`;
      } else {
        query += ` AND status = ?`;
        params.push(status);
      }
    }

    // Filter by date
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yesterdayStr = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    if (dateFilter === 'today') {
      query += ` AND DATE(created_at) = ?`;
      params.push(todayStr);
    } else if (dateFilter === 'yesterday') {
      query += ` AND DATE(created_at) = ?`;
      params.push(yesterdayStr);
    } else if (dateFilter === 'week') {
      const weekAgoStr = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      query += ` AND DATE(created_at) >= ?`;
      params.push(weekAgoStr);
    }

    // Search query
    if (search && search.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      query += ` AND (LOWER(order_id) LIKE ? OR LOWER(COALESCE(payment_id, '')) LIKE ? OR LOWER(COALESCE(address_json, '')) LIKE ?)`;
      params.push(s, s, s);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const [rows] = await pool.query(query, params);

    const orders = rows.map((r) => {
      let items = [];
      let address = null;
      try { items = JSON.parse(r.items_json || '[]'); } catch (e) {}
      try { address = JSON.parse(r.address_json || 'null'); } catch (e) {}

      return {
        order_id: r.order_id,
        session_id: r.session_id,
        total_price: r.total_price,
        total_mrp: r.total_mrp,
        cod_amount: r.cod_amount,
        status: r.status,
        payment_id: r.payment_id,
        payu_status: r.payu_status,
        created_at: r.created_at,
        items,
        itemCount: items.reduce((sum, it) => sum + (it.quantity || 1), 0),
        firstItemTitle: items[0]?.title || 'Meesho Item',
        firstItemImage: items[0]?.image || '',
        customerName: address?.name || 'Customer',
        customerPhone: address?.contactNumber || address?.phone || '—',
        address,
      };
    });

    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    console.error('[Admin] Get orders error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch orders' });
  }
});

/**
 * GET /api/admin/orders/:orderId
 * Get comprehensive details for a specific order
 */
adminRouter.get('/orders/:orderId', requireAdminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [req.params.orderId]);
    const row = rows[0] || null;
    if (!row) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    let items = [];
    let address = null;
    try { items = JSON.parse(row.items_json || '[]'); } catch (e) {}
    try { address = JSON.parse(row.address_json || 'null'); } catch (e) {}

    res.json({
      success: true,
      order: {
        ...row,
        items,
        address,
      },
    });
  } catch (err) {
    console.error('[Admin] Get order detail error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch order details' });
  }
});

/**
 * PATCH /api/admin/orders/:orderId/status
 * Update order lifecycle status (e.g. confirmed, shipped, delivered, cancelled)
 */
adminRouter.patch('/orders/:orderId/status', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'failed', 'cancelled'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const [result] = await pool.query('UPDATE orders SET status = ? WHERE order_id = ?', [status, req.params.orderId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    console.log(`[Admin OMS] Order ${req.params.orderId} status updated to: ${status}`);

    res.json({
      success: true,
      message: `Order status updated to "${status}"`,
      orderId: req.params.orderId,
      status,
    });
  } catch (err) {
    console.error('[Admin] Update order status error:', err);
    res.status(500).json({ success: false, error: 'Failed to update order status' });
  }
});

/**
 * POST /api/admin/orders/clear
 * Clear all order data from the database
 */
adminRouter.post('/orders/clear', requireAdminAuth, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM orders');
    console.log(`[Admin OMS] All order data cleared by admin (${result.affectedRows} orders deleted)`);
    res.json({
      success: true,
      message: 'All order data has been successfully cleared.',
      deletedCount: result.affectedRows,
    });
  } catch (err) {
    console.error('[Admin] Clear orders error:', err);
    res.status(500).json({ success: false, error: 'Failed to clear order data' });
  }
});

/**
 * POST /api/admin/database/clear
 * Clear database data by mode: 'orders', 'uploads', 'banners', or 'full_reset'
 */
adminRouter.post('/database/clear', requireAdminAuth, async (req, res) => {
  try {
    const { mode = 'all' } = req.body || {};
    const summary = {};

    if (mode === 'products') {
      const [c] = await pool.query('DELETE FROM cart_items');
      const [w] = await pool.query('DELETE FROM wishlist_items');
      const [p] = await pool.query('DELETE FROM products');
      summary.products = p.affectedRows;
      summary.cartItems = c.affectedRows;
      summary.wishlist = w.affectedRows;
    }

    if (mode === 'orders' || mode === 'all' || mode === 'full_reset') {
      const [o] = await pool.query('DELETE FROM orders');
      const [c] = await pool.query('DELETE FROM cart_items');
      const [w] = await pool.query('DELETE FROM wishlist_items');
      const [a] = await pool.query('DELETE FROM addresses');
      summary.orders = o.affectedRows;
      summary.cartItems = c.affectedRows;
      summary.wishlist = w.affectedRows;
      summary.addresses = a.affectedRows;
    }

    if (mode === 'uploads' || mode === 'all' || mode === 'full_reset') {
      const [u] = await pool.query('DELETE FROM uploaded_files');
      summary.uploadedFiles = u.affectedRows;
    }

    if (mode === 'banners' || mode === 'all' || mode === 'full_reset') {
      await pool.query('DELETE FROM banners');
      const defaultBanners = [
        ['assets/banner1.png', 'New Arrivals - Designer Purses', '#', 1, 1],
        ['assets/banner2.png', 'Deal Of The Day - Any 3 Purse 299/- RS', '#', 2, 1],
        ['assets/banner3.png', 'Diwali Sale - Any 3 Purse 299/- RS', '#', 3, 1],
        ['assets/banner4.png', 'Marriage Purse Collection', '#', 4, 1],
      ];
      for (const [img, alt, link, sort, active] of defaultBanners) {
        await pool.query(
          'INSERT INTO banners (image_url, alt_text, link_url, sort_order, is_active) VALUES (?, ?, ?, ?, ?)',
          [img, alt, link, sort, active]
        );
      }
      summary.bannersReset = true;
    }

    if (mode === 'full_reset') {
      await initDb();
      summary.initialized = true;
    }

    console.log(`[Admin DB] Database cleared (${mode}):`, summary);
    res.json({
      success: true,
      message: 'Database cleared successfully.',
      mode,
      summary,
    });
  } catch (err) {
    console.error('[Admin DB] Clear error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to clear database' });
  }
});


