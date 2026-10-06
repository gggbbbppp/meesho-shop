import { Router } from 'express';
import { pool } from '../db.js';

export const addressRouter = Router();

function rowToAddress(row) {
  if (!row) return null;
  return {
    name: row.name,
    contactNumber: row.contact_number,
    pincode: row.pincode,
    houseNo: row.house_no,
    roadArea: row.road_area,
    city: row.city,
    state: row.state,
    landmark: row.landmark,
  };
}

addressRouter.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM addresses WHERE session_id = ?', [req.sessionId]);
    res.json(rowToAddress(rows[0] || null));
  } catch (err) {
    console.error('Get address error:', err);
    res.status(500).json({ error: err.message });
  }
});

addressRouter.put('/', async (req, res) => {
  try {
    const a = req.body || {};
    if (!a.name || !a.contactNumber || !/^\d{6}$/.test(String(a.pincode || '')) || !a.houseNo || !a.city || !a.state) {
      return res.status(400).json({ error: 'Missing or invalid address fields' });
    }

    await pool.query(`
      INSERT INTO addresses (session_id, name, contact_number, pincode, house_no, road_area, city, state, landmark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        contact_number = VALUES(contact_number),
        pincode = VALUES(pincode),
        house_no = VALUES(house_no),
        road_area = VALUES(road_area),
        city = VALUES(city),
        state = VALUES(state),
        landmark = VALUES(landmark)
    `, [
      req.sessionId,
      a.name,
      a.contactNumber,
      a.pincode,
      a.houseNo,
      a.roadArea || '',
      a.city,
      a.state,
      a.landmark || '',
    ]);

    const [rows] = await pool.query('SELECT * FROM addresses WHERE session_id = ?', [req.sessionId]);
    res.json(rowToAddress(rows[0] || null));
  } catch (err) {
    console.error('Save address error:', err);
    res.status(500).json({ error: err.message });
  }
});
