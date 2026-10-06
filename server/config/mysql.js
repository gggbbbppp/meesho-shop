export const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  port: Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE || 'meesho_db',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  dateStrings: true, // keeps DATETIME/DATE as strings instead of converting to UTC Date objects
  ssl: process.env.MYSQL_SSL === 'false' ? undefined : (process.env.MYSQL_HOST && process.env.MYSQL_HOST !== 'localhost' && process.env.MYSQL_HOST !== '127.0.0.1' ? { rejectUnauthorized: false } : undefined),
};
