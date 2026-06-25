// seed.js — loads the products from products.json into the database.
// Run this once (and any time products.json changes): node seed.js
// It clears the table first, so re-running never creates duplicates.

const fs = require('fs');
const path = require('path');
const db = require('./db');

// Read the existing product catalogue file
const file = path.join(__dirname, 'public', 'data', 'products.json');
const { products } = JSON.parse(fs.readFileSync(file, 'utf8'));

// Start clean so re-seeding doesn't pile up duplicates
db.exec('DELETE FROM products');

// A "prepared statement": the ? marks are filled in safely for each row.
// This is also how databases prevent SQL-injection attacks — values are
// never glued straight into the SQL text.
const insert = db.prepare(
  'INSERT INTO products (id, name, category, price, blurb) VALUES (?, ?, ?, ?, ?)'
);

for (const p of products) {
  insert.run(p.id, p.name, p.category, p.price, p.blurb);
}

const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
console.log(`Seeded ${n} products into farm.db`);