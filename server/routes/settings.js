import { Router } from 'express';
import { pool } from '../db.js';

export const settingsRouter = Router();
export const bannersRouter = Router();

// GET all site settings as a key-value object
settingsRouter.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value, description FROM site_settings');
    const settings = {};
    for (const r of rows) {
      settings[r.setting_key] = r.setting_value;
    }
    res.json({ success: true, settings });
  } catch (err) {
    console.error('Failed to get settings:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update site settings
settingsRouter.put('/', async (req, res) => {
  try {
    const updates = req.body || {};
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        'INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
        [key, String(value)]
      );
    }
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM site_settings');
    const settings = {};
    for (const r of rows) {
      settings[r.setting_key] = r.setting_value;
    }
    res.json({ success: true, settings });
  } catch (err) {
    console.error('Failed to update settings:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET active banners
bannersRouter.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, image_url, alt_text, link_url, sort_order FROM banners WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
    );
    res.json({ success: true, banners: rows });
  } catch (err) {
    console.error('Failed to get banners:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add banner
bannersRouter.post('/', async (req, res) => {
  try {
    const { imageUrl, altText, linkUrl, sortOrder } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

    const [result] = await pool.query(
      'INSERT INTO banners (image_url, alt_text, link_url, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
      [imageUrl, altText || '', linkUrl || '#', Number(sortOrder) || 0]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Failed to add banner:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT edit banner
bannersRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { imageUrl, altText, linkUrl, sortOrder, isActive } = req.body || {};
    await pool.query(
      `UPDATE banners SET
        image_url = COALESCE(?, image_url),
        alt_text = COALESCE(?, alt_text),
        link_url = COALESCE(?, link_url),
        sort_order = COALESCE(?, sort_order),
        is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [
        imageUrl ?? null,
        altText ?? null,
        linkUrl ?? null,
        sortOrder !== undefined ? Number(sortOrder) : null,
        isActive !== undefined ? (isActive ? 1 : 0) : null,
        id,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to update banner:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE banner
bannersRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query('DELETE FROM banners WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete banner:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
