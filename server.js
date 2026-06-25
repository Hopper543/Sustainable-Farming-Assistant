const express = require('express');
const path = require('path');
const db = require('./db');
const session = require('express-session');
const { hashPassword, verifyPassword } = require('./auth');

// Stripe — only active if a secret key is present in .env.
// We keep the key server-side only; the browser never sees it.
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

const app = express();
app.set('trust proxy', 1); // we run behind the host's proxy (for HTTPS + cookies)
const PORT = process.env.PORT || 3000; // the host assigns a port via env

// Parse JSON request bodies (so req.body works on POST routes)
app.use(express.json());

// Sessions: after login, the server remembers the user via a signed cookie
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS-only once deployed
    maxAge: 1000 * 60 * 60 * 24 * 7
  } // 1 week
}));

// Serve everything in the public/ folder to the browser
// (index.html, css, js, data, images…)
app.use(express.static(path.join(__dirname, 'public')));

// ---- Weather route ----
// The browser calls THIS (e.g. /api/weather?city=Pune).
// Our server then calls OpenWeatherMap using the secret key,
// so the key never reaches the browser.
app.get('/api/weather', async (req, res) => {
  const { city, lat, lon } = req.query;

  // 1. Need either a city name or a lat/lon pair
  if (!city && !(lat && lon)) {
    return res.status(400).json({ error: 'Please provide a city or coordinates.' });
  }

  // 2. Read the secret key from the environment (.env)
  const key = process.env.WEATHER_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Server is missing its weather API key.' });
  }

  try {
    // 3. Build the OpenWeatherMap URL — by coordinates if we have them, else by city
    const locationQuery = (lat && lon)
      ? `lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
      : `q=${encodeURIComponent(city)}`;
    const url = `https://api.openweathermap.org/data/2.5/weather`
      + `?${locationQuery}&units=metric&appid=${key}`;
    const response = await fetch(url);

    // 4. Handle errors from the weather service cleanly
    if (!response.ok) {
      const message = response.status === 404 ? 'City not found.'
        : response.status === 401 ? 'API key not active yet — try again shortly.'
        : 'Weather service error.';
      return res.status(response.status).json({ error: message });
    }

    // 5. Pick out just the bits the front-end needs and send them back
    const data = await response.json();
    res.json({
      city: data.name,
      country: data.sys && data.sys.country,
      description: data.weather && data.weather[0] && data.weather[0].description,
      temp: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      wind: data.wind && data.wind.speed
    });
  } catch (err) {
    // 6. Network or unexpected failure
    console.error('Weather route error:', err);
    res.status(500).json({ error: 'Could not reach the weather service.' });
  }
});

// ---- Products route ----
// The catalogue now comes from the SQLite database (seeded from
// products.json), not a static file. The browser asks the server,
// the server queries the database, and clean JSON comes back.
app.get('/api/products', (req, res) => {
  try {
    const products = db.prepare(
      'SELECT id, name, category, price, blurb FROM products'
    ).all();
    const categories = ['All', ...new Set(products.map(p => p.category))];
    res.json({ products, categories });
  } catch (err) {
    console.error('Products route error:', err);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

// ---- Accounts ----

// Register a new user
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const cleanEmail = String(email).trim().toLowerCase();

  // Is the email already taken? (UNIQUE column would also stop it, but we check for a clean message)
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'That email is already registered.' });
  }

  const info = db.prepare(
    'INSERT INTO users (name, email, password) VALUES (?, ?, ?)'
  ).run(String(name).trim(), cleanEmail, hashPassword(password));

  const id = Number(info.lastInsertRowid);
  req.session.userId = id;                       // log them in immediately
  res.json({ user: { id, name: String(name).trim(), email: cleanEmail } });
});

// Log in an existing user
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase());

  // Same generic message whether the email is unknown or the password is wrong,
  // so we don't reveal which emails are registered.
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  req.session.userId = user.id;
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

// Log out
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Who is logged in right now?
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?')
    .get(req.session.userId);
  res.json({ user: user || null });
});

// Small guard: only a logged-in user may use the route below it.
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in.' });
  next();
}

// ---- Cart (per logged-in user) ----

// Get the current user's cart as { productId: qty }
app.get('/api/cart', requireLogin, (req, res) => {
  const rows = db.prepare('SELECT product_id, qty FROM cart_items WHERE user_id = ?')
    .all(req.session.userId);
  const cart = {};
  for (const r of rows) cart[r.product_id] = r.qty;
  res.json({ cart });
});

// Replace the user's whole cart with the one sent from the browser
app.put('/api/cart', requireLogin, (req, res) => {
  const cart = (req.body && req.body.cart) || {};
  const uid = req.session.userId;
  const del = db.prepare('DELETE FROM cart_items WHERE user_id = ?');
  const ins = db.prepare('INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, ?)');
  try {
    db.exec('BEGIN');
    del.run(uid);
    for (const [pid, qty] of Object.entries(cart)) {
      const q = Math.max(0, parseInt(qty, 10) || 0);
      if (q > 0) ins.run(uid, pid, q);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('Cart save error:', err);
    return res.status(500).json({ error: 'Could not save cart.' });
  }
  res.json({ cart });
});

// ---- Orders ----

// Build an order from the user's current cart. Returns the order, or
// null if the cart is empty. Used by the direct route AND after payment.
function createOrderForUser(uid) {
  const items = db.prepare(`
    SELECT c.product_id, c.qty, p.name, p.price
    FROM cart_items c
    JOIN products p ON p.id = c.product_id
    WHERE c.user_id = ?
  `).all(uid);

  if (!items.length) return null;

  const total = items.reduce((sum, it) => sum + it.price * it.qty, 0);

  db.exec('BEGIN');
  try {
    const orderInfo = db.prepare('INSERT INTO orders (user_id, total) VALUES (?, ?)').run(uid, total);
    const orderId = Number(orderInfo.lastInsertRowid);
    const insItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)'
    );
    for (const it of items) insItem.run(orderId, it.product_id, it.name, it.price, it.qty);
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(uid);
    db.exec('COMMIT');
    return { id: orderId, total, items };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Place an order directly from the cart (no payment step).
app.post('/api/orders', requireLogin, (req, res) => {
  try {
    const order = createOrderForUser(req.session.userId);
    if (!order) return res.status(400).json({ error: 'Your cart is empty.' });
    res.json({ order });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: 'Could not place order.' });
  }
});

// List the user's orders, newest first, each with its items.
app.get('/api/orders', requireLogin, (req, res) => {
  const orders = db.prepare(
    'SELECT id, total, created_at FROM orders WHERE user_id = ? ORDER BY id DESC'
  ).all(req.session.userId);
  const itemStmt = db.prepare(
    'SELECT product_id, name, price, qty FROM order_items WHERE order_id = ?'
  );
  for (const o of orders) o.items = itemStmt.all(o.id);
  res.json({ orders });
});

// ---- Farm grid (per logged-in user) ----

// Get the user's saved grid (or null if they haven't saved one)
app.get('/api/farm', requireLogin, (req, res) => {
  const row = db.prepare('SELECT state FROM farm_grids WHERE user_id = ?')
    .get(req.session.userId);
  res.json({ state: row ? JSON.parse(row.state) : null });
});

// Save (insert or update) the user's grid
app.put('/api/farm', requireLogin, (req, res) => {
  const state = req.body && req.body.state;
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'Invalid farm state.' });
  }
  // "Upsert": insert a new row, or update the existing one for this user.
  db.prepare(`
    INSERT INTO farm_grids (user_id, state, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = datetime('now')
  `).run(req.session.userId, JSON.stringify(state));
  res.json({ ok: true });
});

// ---- Stripe payment (test mode) ----

// Start checkout: build a Stripe session from the cart, return its URL.
// The browser is then redirected to Stripe's hosted payment page.
app.post('/api/checkout', requireLogin, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments are not configured.' });
  const uid = req.session.userId;

  const items = db.prepare(`
    SELECT c.qty, p.name, p.price
    FROM cart_items c JOIN products p ON p.id = c.product_id
    WHERE c.user_id = ?
  `).all(uid);
  if (!items.length) return res.status(400).json({ error: 'Your cart is empty.' });

  const base = `${req.protocol}://${req.get('host')}`;
  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: items.map(it => ({
        price_data: {
          currency: 'usd',
          product_data: { name: it.name },
          unit_amount: Math.round(it.price * 100) // Stripe wants cents
        },
        quantity: it.qty
      })),
      success_url: `${base}/api/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/shop.html`,
      client_reference_id: String(uid) // ties the session to this user
    });
    res.json({ url: checkoutSession.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

// Stripe redirects here after payment. Verify it was paid, then create
// the order from the cart and send the user to their order history.
app.get('/api/checkout/success', requireLogin, async (req, res) => {
  if (!stripe) return res.redirect('/shop.html');
  try {
    const cs = await stripe.checkout.sessions.retrieve(req.query.session_id);
    const paid = cs.payment_status === 'paid';
    const mine = String(cs.client_reference_id) === String(req.session.userId);
    if (paid && mine) {
      try { createOrderForUser(req.session.userId); } catch (e) { console.error(e); }
      return res.redirect('/orders.html');
    }
  } catch (err) {
    console.error('Stripe verify error:', err);
  }
  res.redirect('/shop.html');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});