// db.js — opens (or creates) the SQLite database file and makes sure
// the tables we need exist. Other files require this to talk to the DB.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// The whole database is a single file in the project root: farm.db
// (It's created automatically the first time this runs.)
const db = new DatabaseSync(path.join(__dirname, 'farm.db'));

// A "schema" defines the shape of our data: a table and its columns.
// Unlike free-form JSON, every row must follow this structure.
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id        TEXT PRIMARY KEY,   -- unique id, e.g. "bt-spray"
    name      TEXT NOT NULL,      -- display name
    category  TEXT NOT NULL,      -- e.g. "Pest & Disease Control"
    price     REAL NOT NULL,      -- a decimal number
    blurb     TEXT                -- short description
  )
`);

// Users for registration / login.
// The "password" column holds a salted hash — never the real password.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,   -- no two accounts share an email
    password   TEXT NOT NULL,          -- stored as "salt:hash"
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Each row is one product in one user's cart.
// The composite primary key means a user can have a product only once
// (with a quantity), never duplicated.
db.exec(`
  CREATE TABLE IF NOT EXISTS cart_items (
    user_id    INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    qty        INTEGER NOT NULL,
    PRIMARY KEY (user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// One row per placed order (header).
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    total      REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// The lines of each order. We copy the name and price IN so the order
// is a permanent record — it won't change if the product is later
// repriced or removed. (A "snapshot", not a live reference.)
db.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    name       TEXT NOT NULL,
    price      REAL NOT NULL,
    qty        INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  )
`);

// One saved farm grid per user. The whole grid (rows, cols, plots) is
// stored as a JSON string — it's a single document that belongs to one
// user, so a JSON column is a fine, simple fit here.
db.exec(`
  CREATE TABLE IF NOT EXISTS farm_grids (
    user_id    INTEGER PRIMARY KEY,
    state      TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Make sure the product catalogue exists. In production the database
// starts empty on each deploy, so we load products.json automatically
// when the table is empty. (Locally, this also means you may not need
// to run seed.js by hand.)
try {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  if (n === 0) {
    const fs = require('fs');
    const file = path.join(__dirname, 'public', 'data', 'products.json');
    const { products } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const insert = db.prepare(
      'INSERT INTO products (id, name, category, price, blurb) VALUES (?, ?, ?, ?, ?)'
    );
    for (const p of products) insert.run(p.id, p.name, p.category, p.price, p.blurb);
    console.log(`Seeded ${products.length} products.`);
  }
} catch (err) {
  console.error('Product seed check failed:', err);
}

module.exports = db;