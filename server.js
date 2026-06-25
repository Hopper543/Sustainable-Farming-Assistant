const express = require('express');
const path = require('path');
const { pool, init } = require('./db');
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
app.use(express.static(path.join(__dirname, 'public')));

// ---- Weather route ----
// The browser calls THIS (e.g. /api/weather?city=Pune). Our server then
// calls OpenWeatherMap with the secret key, so the key never reaches the browser.
app.get('/api/weather', async (req, res) => {
  const { city, lat, lon } = req.query;
  if (!city && !(lat && lon)) {
    return res.status(400).json({ error: 'Please provide a city or coordinates.' });
  }
  const key = process.env.WEATHER_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Server is missing its weather API key.' });
  }
  try {
    const locationQuery = (lat && lon)
      ? `lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
      : `q=${encodeURIComponent(city)}`;
    const url = `https://api.openweathermap.org/data/2.5/weather`
      + `?${locationQuery}&units=metric&appid=${key}`;
    const response = await fetch(url);
    if (!response.ok) {
      const message = response.status === 404 ? 'City not found.'
        : response.status === 401 ? 'API key not active yet — try again shortly.'
        : 'Weather service error.';
      return res.status(response.status).json({ error: message });
    }
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
    console.error('Weather route error:', err);
    res.status(500).json({ error: 'Could not reach the weather service.' });
  }
});

// ---- Products route ----
app.get('/api/products', async (req, res) => {
  try {
    const { rows: products } = await pool.query(
      'SELECT id, name, category, price, blurb FROM products ORDER BY category, name'
    );
    const categories = ['All', ...new Set(products.map(p => p.category))];
    res.json({ products, categories });
  } catch (err) {
    console.error('Products route error:', err);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

// ---- Accounts ----

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'That email is already registered.' });
    }
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id',
      [String(name).trim(), cleanEmail, hashPassword(password)]
    );
    const id = rows[0].id;
    req.session.userId = id;                       // log them in immediately
    res.json({ user: { id, name: String(name).trim(), email: cleanEmail } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Could not register.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1', [String(email).trim().toLowerCase()]
    );
    const user = rows[0];
    // Same generic message whether email is unknown or password is wrong.
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    req.session.userId = user.id;
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1', [req.session.userId]
    );
    res.json({ user: rows[0] || null });
  } catch (err) {
    console.error('Me route error:', err);
    res.status(500).json({ error: 'Could not load account.' });
  }
});

// Small guard: only a logged-in user may use the route below it.
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in.' });
  next();
}

// ---- Cart (per logged-in user) ----

app.get('/api/cart', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT product_id, qty FROM cart_items WHERE user_id = $1', [req.session.userId]
    );
    const cart = {};
    for (const r of rows) cart[r.product_id] = r.qty;
    res.json({ cart });
  } catch (err) {
    console.error('Cart load error:', err);
    res.status(500).json({ error: 'Could not load cart.' });
  }
});

// Replace the user's whole cart. A transaction makes the delete+inserts
// one all-or-nothing unit. With pg we check out a dedicated client for it.
app.put('/api/cart', requireLogin, async (req, res) => {
  const cart = (req.body && req.body.cart) || {};
  const uid = req.session.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [uid]);
    for (const [pid, qty] of Object.entries(cart)) {
      const q = Math.max(0, parseInt(qty, 10) || 0);
      if (q > 0) {
        await client.query(
          'INSERT INTO cart_items (user_id, product_id, qty) VALUES ($1, $2, $3)',
          [uid, pid, q]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ cart });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cart save error:', err);
    res.status(500).json({ error: 'Could not save cart.' });
  } finally {
    client.release();
  }
});

// ---- Orders ----

// Build an order from the user's cart. Returns the order, or null if the
// cart is empty. Used by the direct route AND after Stripe payment.
async function createOrderForUser(uid) {
  const { rows: items } = await pool.query(`
    SELECT c.product_id, c.qty, p.name, p.price
    FROM cart_items c
    JOIN products p ON p.id = c.product_id
    WHERE c.user_id = $1
  `, [uid]);

  if (!items.length) return null;

  const total = items.reduce((sum, it) => sum + it.price * it.qty, 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING id', [uid, total]
    );
    const orderId = rows[0].id;
    for (const it of items) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES ($1, $2, $3, $4, $5)',
        [orderId, it.product_id, it.name, it.price, it.qty]
      );
    }
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [uid]);
    await client.query('COMMIT');
    return { id: orderId, total, items };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

app.post('/api/orders', requireLogin, async (req, res) => {
  try {
    const order = await createOrderForUser(req.session.userId);
    if (!order) return res.status(400).json({ error: 'Your cart is empty.' });
    res.json({ order });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: 'Could not place order.' });
  }
});

app.get('/api/orders', requireLogin, async (req, res) => {
  try {
    const { rows: orders } = await pool.query(`
      SELECT id, total,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at
      FROM orders WHERE user_id = $1 ORDER BY id DESC
    `, [req.session.userId]);
    for (const o of orders) {
      const { rows: items } = await pool.query(
        'SELECT product_id, name, price, qty FROM order_items WHERE order_id = $1', [o.id]
      );
      o.items = items;
    }
    res.json({ orders });
  } catch (err) {
    console.error('Orders list error:', err);
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

// ---- Farm grid (per logged-in user) ----

app.get('/api/farm', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT state FROM farm_grids WHERE user_id = $1', [req.session.userId]
    );
    res.json({ state: rows[0] ? JSON.parse(rows[0].state) : null });
  } catch (err) {
    console.error('Farm load error:', err);
    res.status(500).json({ error: 'Could not load grid.' });
  }
});

// Save (insert or update) the user's grid — an "upsert" via ON CONFLICT.
app.put('/api/farm', requireLogin, async (req, res) => {
  const state = req.body && req.body.state;
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'Invalid farm state.' });
  }
  try {
    await pool.query(`
      INSERT INTO farm_grids (user_id, state, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
    `, [req.session.userId, JSON.stringify(state)]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Farm save error:', err);
    res.status(500).json({ error: 'Could not save grid.' });
  }
});

// ---- Stripe payment (test mode) ----

app.post('/api/checkout', requireLogin, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments are not configured.' });
  const uid = req.session.userId;
  try {
    const { rows: items } = await pool.query(`
      SELECT c.qty, p.name, p.price
      FROM cart_items c JOIN products p ON p.id = c.product_id
      WHERE c.user_id = $1
    `, [uid]);
    if (!items.length) return res.status(400).json({ error: 'Your cart is empty.' });

    const base = `${req.protocol}://${req.get('host')}`;
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
      client_reference_id: String(uid)
    });
    res.json({ url: checkoutSession.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

app.get('/api/checkout/success', requireLogin, async (req, res) => {
  if (!stripe) return res.redirect('/shop.html');
  try {
    const cs = await stripe.checkout.sessions.retrieve(req.query.session_id);
    const paid = cs.payment_status === 'paid';
    const mine = String(cs.client_reference_id) === String(req.session.userId);
    if (paid && mine) {
      try { await createOrderForUser(req.session.userId); } catch (e) { console.error(e); }
      return res.redirect('/orders.html');
    }
  } catch (err) {
    console.error('Stripe verify error:', err);
  }
  res.redirect('/shop.html');
});

// Create tables + seed, THEN start serving (so the schema is ready).
init()
  .then(() => app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`)))
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });