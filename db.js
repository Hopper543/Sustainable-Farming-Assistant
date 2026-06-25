// db.js — connects to a Postgres database (Neon) and ensures our tables
// exist. Other files import { pool } to run queries, and server.js calls
// init() once at startup before it begins serving requests.

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// One shared connection pool, using the connection string from .env.
// Hosted Postgres (Neon) requires SSL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create tables if they don't exist, and load the product catalogue the
// first time. Postgres differences from SQLite to notice:
//   SERIAL          = auto-incrementing id   (was INTEGER ... AUTOINCREMENT)
//   TIMESTAMPTZ     = a timestamp with timezone
//   now()           = current time           (was datetime('now'))
//   $1, $2 ...      = value placeholders      (were ?)
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      category  TEXT NOT NULL,
      price     DOUBLE PRECISION NOT NULL,
      blurb     TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id    INTEGER NOT NULL REFERENCES users(id),
      product_id TEXT NOT NULL,
      qty        INTEGER NOT NULL,
      PRIMARY KEY (user_id, product_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      total      DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id         SERIAL PRIMARY KEY,
      order_id   INTEGER NOT NULL REFERENCES orders(id),
      product_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      price      DOUBLE PRECISION NOT NULL,
      qty        INTEGER NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS farm_grids (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id),
      state      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Seed the catalogue if it's empty (a brand-new database).
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  if (rows[0].n === 0) {
    const file = path.join(__dirname, 'public', 'data', 'products.json');
    const { products } = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const p of products) {
      await pool.query(
        'INSERT INTO products (id, name, category, price, blurb) VALUES ($1, $2, $3, $4, $5)',
        [p.id, p.name, p.category, p.price, p.blurb]
      );
    }
    console.log(`Seeded ${products.length} products.`);
  }
}

module.exports = { pool, init };