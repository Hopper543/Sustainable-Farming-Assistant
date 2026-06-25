/* ============================================================
   cart.js — one place that decides WHERE the cart lives.
   Logged in  → the database (via /api/cart), so it follows you.
   Guest      → localStorage, so the shop still works without an account.
   On login, any guest cart is merged into the account.
   Both shop.js and main.js use this, so the logic lives in one spot.
   ============================================================ */
const Cart = (function () {
  const KEY = "shopCart";
  let loggedIn = false;

  const readLocal  = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const writeLocal = (c) => localStorage.setItem(KEY, JSON.stringify(c));
  const clearLocal = () => localStorage.removeItem(KEY);

  const fetchServer = async () => {
    const r = await fetch("/api/cart");
    if (!r.ok) return {};
    const d = await r.json();
    return d.cart || {};
  };
  const putServer = async (c) => {
    await fetch("/api/cart", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart: c })
    });
  };
  const merge = (a, b) => {
    const m = { ...a };
    for (const k in b) m[k] = (m[k] || 0) + b[k];
    return m;
  };

  // Run once on load: find out if we're logged in, and if so, fold any
  // guest cart into the account so nothing added-while-logged-out is lost.
  const ready = (async () => {
    try {
      const me = await (await fetch("/api/me")).json();
      loggedIn = !!(me && me.user);
    } catch { loggedIn = false; }

    if (loggedIn) {
      const guest = readLocal();
      if (Object.keys(guest).length) {
        const merged = merge(await fetchServer(), guest);
        await putServer(merged);
        clearLocal();
      }
    }
  })();

  return {
    ready,
    isLoggedIn: () => loggedIn,
    async load() { await ready; return loggedIn ? await fetchServer() : readLocal(); },
    async save(cart) { await ready; if (loggedIn) await putServer(cart); else writeLocal(cart); }
  };
})();
window.Cart = Cart;