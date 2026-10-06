import { Router } from 'express';
import { pool, rowToProduct } from '../db.js';

export const productsRouter = Router();

productsRouter.get('/', async (req, res) => {
  try {
    const search = (req.query.search || '').toString().trim().toLowerCase();
    const category = (req.query.category || '').toString().trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(500, parseInt(req.query.pageSize, 10) || 10));

    let countQuery = 'SELECT COUNT(*) as total FROM products';
    let dataQuery = 'SELECT * FROM products';
    const countParams = [];
    const dataParams = [];

    const whereClauses = [];
    if (search) {
      whereClauses.push('LOWER(title) LIKE ?');
      countParams.push(`%${search}%`);
      dataParams.push(`%${search}%`);
    }
    if (category && category !== 'all') {
      whereClauses.push('category = ?');
      countParams.push(category);
      dataParams.push(category);
    }

    if (whereClauses.length > 0) {
      const whereSql = ' WHERE ' + whereClauses.join(' AND ');
      countQuery += whereSql;
      dataQuery += whereSql;
    }

    const [[{ total }]] = await pool.query(countQuery, countParams);

    const offset = (page - 1) * pageSize;
    dataQuery += ' ORDER BY id ASC LIMIT ? OFFSET ?';
    dataParams.push(pageSize, offset);

    const [rows] = await pool.query(dataQuery, dataParams);
    const items = rows.map(rowToProduct);

    res.json({ items, total, hasMore: offset + pageSize < total, page, pageSize });
  } catch (err) {
    console.error('Products get error:', err);
    res.status(500).json({ error: err.message });
  }
});

productsRouter.get('/meta/categories', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.category, COUNT(*) as count,
        (SELECT p2.image FROM products p2 WHERE p2.category = p.category AND p2.image IS NOT NULL LIMIT 1) as sample_image
      FROM products p
      GROUP BY p.category
      ORDER BY count DESC
    `);

    const categories = rows.map((r) => ({
      category: r.category,
      count: r.count,
      image: r.sample_image || null,
    }));

    res.json(categories);
  } catch (err) {
    console.error('Categories get error:', err);
    res.status(500).json({ error: err.message });
  }
});

productsRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid product id' });
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(rowToProduct(rows[0]));
  } catch (err) {
    console.error('Product detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update product title, image, or prices directly in MySQL
productsRouter.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid product id' });
    const { title, image, images, sizes, price, mrp, category } = req.body || {};

    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (images !== undefined) {
      const sanitizedImages = Array.isArray(images) ? images : [];
      updates.push('images_json = ?');
      params.push(JSON.stringify(sanitizedImages));
      if (image === undefined && sanitizedImages.length > 0) {
        updates.push('image = ?');
        params.push(sanitizedImages[0]);
      }
    }
    if (sizes !== undefined) {
      const sanitizedSizes = Array.isArray(sizes)
        ? sizes.map((s) => String(s).trim()).filter(Boolean)
        : null;
      updates.push('sizes_json = ?');
      params.push(sanitizedSizes && sanitizedSizes.length > 0 ? JSON.stringify(sanitizedSizes) : null);
    }
    if (image !== undefined) {
      updates.push('image = ?');
      params.push(image);
    }
    if (price !== undefined) {
      updates.push('price = ?');
      params.push(Number(price));
    }
    if (mrp !== undefined) {
      updates.push('mrp = ?');
      params.push(Number(mrp));
    }
    if (category !== undefined) {
      updates.push('category = ?');
      params.push(category);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    params.push(id);
    await pool.query(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ success: true, product: rowToProduct(rows[0]) });
  } catch (err) {
    console.error('Product update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST add brand new product
productsRouter.post('/', async (req, res) => {
  try {
    const {
      title,
      price,
      mrp,
      category = 'Marrige Purse',
      image,
      images = [],
      sizes,
      specialOffer,
    } = req.body || {};

    if (!title || !price) {
      return res.status(400).json({ error: 'Title and Price are required' });
    }

    const [[{ maxId }]] = await pool.query('SELECT COALESCE(MAX(id), 10000) as maxId FROM products');
    const newId = maxId + 1;
    const finalMrp = Number(mrp) || Math.round(Number(price) * 3);
    const finalPrice = Number(price);
    const discountPercent = Math.max(0, Math.round(((finalMrp - finalPrice) / finalMrp) * 100));
    const discountLabel = `${discountPercent}% off`;
    const finalImages = Array.isArray(images) && images.length > 0 ? images : (image ? [image] : ['assets/kurti1-CcoeKMaM.webp']);
    const finalCover = image || finalImages[0] || 'assets/kurti1-CcoeKMaM.webp';
    const sanitizedSizes = Array.isArray(sizes)
      ? sizes.map((s) => String(s).trim()).filter(Boolean)
      : null;
    const finalSizesJson = sanitizedSizes && sanitizedSizes.length > 0 ? JSON.stringify(sanitizedSizes) : null;

    await pool.query(`
      INSERT INTO products (
        id, slug, title, category, image, images_json, sizes_json, price, mrp,
        discount_label, rating, reviews, offers, special_offer, trusted, deal_timer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4.2, 100, 1, ?, 1, 0)
    `, [
      newId,
      `prod-${newId}`,
      title,
      category,
      finalCover,
      JSON.stringify(finalImages),
      finalSizesJson,
      finalPrice,
      finalMrp,
      discountLabel,
      specialOffer || `₹${Math.max(1, finalPrice - 10)} with Special Offer`,
    ]);

    const [created] = await pool.query('SELECT * FROM products WHERE id = ?', [newId]);
    res.status(201).json({ success: true, product: rowToProduct(created[0]) });
  } catch (err) {
    console.error('Add product error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE product
productsRouter.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Invalid product id' });

    const [result] = await pool.query('DELETE FROM products WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ success: true, deletedId: id });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ error: err.message });
  }
});

