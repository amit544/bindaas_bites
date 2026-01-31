const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), override: true });
const { Pool } = require("pg");
console.log("DB_HOST =", process.env.DB_HOST);
console.log("DB_PORT =", process.env.DB_PORT);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false
  } 
});

// Auto-migration: Add split payment columns if they don't exist
async function runMigrations() {
  try {
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_amount NUMERIC DEFAULT 0;
    `);
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS online_amount NUMERIC DEFAULT 0;
    `);
    await pool.query(`
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_delivered BOOLEAN DEFAULT FALSE;
    `);
    console.log("✅ Database migrations complete");
  } catch (err) {
    console.error("⚠️ Migration error (may be safe to ignore):", err.message);
  }
}

runMigrations();

module.exports = pool;
