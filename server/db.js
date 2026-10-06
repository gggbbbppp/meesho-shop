import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MYSQL_CONFIG } from './config/mysql.js';
import { getCategory } from './lib/productHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Ensure the MySQL database exists before creating the pool
async function ensureDatabaseExists() {
  try {
    const rootConn = await mysql.createConnection({
      host: MYSQL_CONFIG.host,
      user: MYSQL_CONFIG.user,
      password: MYSQL_CONFIG.password,
      port: MYSQL_CONFIG.port,
      ssl: MYSQL_CONFIG.ssl,
    });

    try {
      await rootConn.query(
        `CREATE DATABASE IF NOT EXISTS \`${MYSQL_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } finally {
      await rootConn.end();
    }
  } catch (err) {
    // If connecting without DB or CREATE DATABASE fails (e.g. Aiven/cloud where DB already exists), continue
    console.log('[db] ensureDatabaseExists notice:', err.message);
  }
}

await ensureDatabaseExists();

// 2. Export the connection pool for the entire application
export const pool = mysql.createPool(MYSQL_CONFIG);

// 3. Define schema tables
const SCHEMA_QUERIES = [
  `CREATE TABLE IF NOT EXISTS products (
    id INT PRIMARY KEY,
    slug VARCHAR(255),
    title VARCHAR(500) NOT NULL,
    category VARCHAR(255),
    image VARCHAR(500),
    images_json LONGTEXT,
    sizes_json TEXT,
    price INT NOT NULL,
    mrp INT NOT NULL,
    discount_label VARCHAR(100),
    rating DECIMAL(3,1),
    reviews INT,
    offers INT,
    special_offer VARCHAR(255),
    trusted TINYINT(1) DEFAULT 0,
    deal_timer TINYINT(1) DEFAULT 0,
    INDEX idx_category (category),
    INDEX idx_title (title(100))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS site_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT,
    description VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS banners (
    id INT AUTO_INCREMENT PRIMARY KEY,
    image_url VARCHAR(500) NOT NULL,
    alt_text VARCHAR(255),
    link_url VARCHAR(500) DEFAULT '#',
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS cart_items (
    session_id VARCHAR(128) NOT NULL,
    product_id INT NOT NULL,
    size VARCHAR(50) NOT NULL,
    quantity INT NOT NULL,
    PRIMARY KEY (session_id, product_id, size)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS wishlist_items (
    session_id VARCHAR(128) NOT NULL,
    product_id INT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, product_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS addresses (
    session_id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255),
    contact_number VARCHAR(50),
    pincode VARCHAR(20),
    house_no VARCHAR(255),
    road_area VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    landmark VARCHAR(255)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS orders (
    order_id VARCHAR(100) PRIMARY KEY,
    session_id VARCHAR(128) NOT NULL,
    items_json LONGTEXT NOT NULL,
    address_json TEXT,
    total_price INT NOT NULL,
    total_mrp INT NOT NULL,
    cod_amount INT NOT NULL,
    payment_id VARCHAR(255),
    payu_status VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'confirmed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_created_at (created_at),
    INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS uploaded_files (
    filename VARCHAR(255) PRIMARY KEY,
    mime_type VARCHAR(100) NOT NULL,
    data LONGBLOB NOT NULL,
    size INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
];

export async function initDb() {
  for (const q of SCHEMA_QUERIES) {
    await pool.query(q);
  }

  // Ensure sizes_json column exists in products table for existing database
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'sizes_json'`,
      [MYSQL_CONFIG.database]
    );
    if (cols.length === 0) {
      await pool.query('ALTER TABLE products ADD COLUMN sizes_json TEXT DEFAULT NULL AFTER images_json');
      console.log("Added 'sizes_json' column to products table.");
    }
  } catch (colErr) {
    console.warn('Error checking/adding sizes_json column:', colErr.message);
  }

  // Seed site settings if empty
  const [settingsCount] = await pool.query('SELECT COUNT(*) as count FROM site_settings');
  if (settingsCount[0].count === 0) {
    const defaultSettings = [
      ['site_title', 'meesho - Lowest Prices, Best Quality Shopping', 'Browser tab and page title'],
      ['brand_name', 'meesho', 'Header logo text / brand title'],
      ['meta_description', 'Shop elegant kurtis, dress materials, suits, accessories, and jewellery at the lowest prices on meesho. Free delivery, COD available.', 'SEO description'],
      ['marquee_text', 'LAST DAY SALE AT 3 PIC COMBO PRICE 199/- ONLY', 'Top marquee announcement message'],
      ['default_sizes', 'S, M, L, XL, XXL', 'Default sizes for products when not specified per-product'],
      ['max_order_amount', '299', 'Maximum allowed order value in rupees (₹)'],
      ['search_placeholder', 'Search for Marrige Purse, Office Purse, Kurtis, etc.', 'Header search box placeholder text'],
    ];

    for (const [k, v, desc] of defaultSettings) {
      await pool.query(
        'INSERT IGNORE INTO site_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
        [k, v, desc]
      );
    }
  } else {
    // Ensure default_sizes, max_order_amount and search_placeholder exist even if site_settings was already seeded
    await pool.query(
      'INSERT IGNORE INTO site_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
      ['default_sizes', 'S, M, L, XL, XXL', 'Default sizes for products when not specified per-product']
    );
    await pool.query(
      'INSERT IGNORE INTO site_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
      ['max_order_amount', '299', 'Maximum allowed order value in rupees (₹)']
    );
    await pool.query(
      'INSERT IGNORE INTO site_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
      ['search_placeholder', 'Search for Marrige Purse, Office Purse, Kurtis, etc.', 'Header search box placeholder text']
    );
  }

  // Seed banners if empty
  const [bannerCount] = await pool.query('SELECT COUNT(*) as count FROM banners');
  if (bannerCount[0].count === 0) {
    const defaultBanners = [
      ['assets/kurti1-CcoeKMaM.webp', 'First slide', '#', 1, 1],
      ['assets/kurti2-BijmMluk.jpg', 'Second slide', '#', 2, 1],
      ['assets/kurti3-VJxgG-0W.jpg', 'Third slide', '#', 3, 1],
      ['assets/kurti4-BPcNrcZO.jpg', 'Fourth slide', '#', 4, 1],
    ];

    for (const [img, alt, link, sort, active] of defaultBanners) {
      await pool.query(
        'INSERT INTO banners (image_url, alt_text, link_url, sort_order, is_active) VALUES (?, ?, ?, ?, ?)',
        [img, alt, link, sort, active]
      );
    }
  }

  // Products seeding is only performed if explicitly requested via environment variable
  if (process.env.SEED_DEFAULT_PRODUCTS === 'true') {
    const [prodCount] = await pool.query('SELECT COUNT(*) as count FROM products');
    if (prodCount[0].count === 0) {
      const productsPath = path.join(__dirname, '..', 'data', 'products.json');
      const products = JSON.parse(readFileSync(productsPath, 'utf8'));

      const sql = `
        INSERT INTO products (id, slug, title, category, image, images_json, price, mrp,
          discount_label, rating, reviews, offers, special_offer, trusted, deal_timer)
        VALUES ?
      `;

      const values = products.map((p) => [
        p.id,
        p.slug ?? null,
        p.title,
        getCategory(p.title),
        p.image ?? null,
        JSON.stringify(p.images ?? []),
        p.price,
        p.mrp,
        p.discountLabel ?? null,
        p.rating ?? null,
        p.reviews ?? null,
        p.offers ?? null,
        p.specialOffer ?? null,
        p.trusted ? 1 : 0,
        p.dealTimer ? 1 : 0,
      ]);

      const chunkSize = 50;
      for (let i = 0; i < values.length; i += chunkSize) {
        const chunk = values.slice(i, i + chunkSize);
        await pool.query(sql, [chunk]);
      }

      console.log(`Seeded ${products.length} products into MySQL database '${MYSQL_CONFIG.database}'`);
    }
  }
}

// Convert database row to product object
export function rowToProduct(row) {
  if (!row) return null;
  let sizes = null;
  if (row.sizes_json) {
    try {
      sizes = typeof row.sizes_json === 'string' ? JSON.parse(row.sizes_json) : row.sizes_json;
    } catch (e) {
      sizes = null;
    }
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    image: row.image,
    images: typeof row.images_json === 'string' ? JSON.parse(row.images_json || '[]') : (row.images_json || []),
    sizes: Array.isArray(sizes) ? sizes : null,
    price: row.price,
    mrp: row.mrp,
    discountLabel: row.discount_label,
    rating: row.rating !== null ? Number(row.rating) : null,
    reviews: row.reviews,
    offers: row.offers,
    specialOffer: row.special_offer,
    trusted: !!row.trusted,
    dealTimer: !!row.deal_timer,
  };
}
