/* ============================================================
   Shop — product catalogue + cart
   Products load from data/products.json. The cart lives in
   localStorage as { productId: quantity }. Real accounts,
   saved orders, and payment arrive with the backend phases.
   ============================================================ */

let products = [];
let categories = ["All"];
let activeCategory = "All";
let searchTerm = "";
let cart = {};   // filled by Cart.load() once we know login state

/* Simple category icons for the product thumbnails */
const ICONS = {
  "Seeds": '<path d="M12 3c4 4 6 7 6 11a6 6 0 0 1-12 0c0-2 1-4 2-5"></path><path d="M12 14V8"></path>',
  "Tools": '<path d="M14 7l-1.5-1.5a3 3 0 0 0-4 4L4 13l3 3 3.5-4.5a3 3 0 0 0 4-4L17 4"></path>',
  "Soil & Compost": '<path d="M3 7h18M3 12h18M3 17h18"></path>',
  "Protection": '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"></path>'
};
function iconFor(cat) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[cat] || ICONS["Seeds"]}</svg>`;
}

/* ---- Storage: server when logged in, localStorage when guest ---- */
function saveCart() { Cart.save(cart); }

/* ---- DOM ---- */
const grid = document.getElementById("shopGrid");
const filters = document.getElementById("filters");
const searchInput = document.getElementById("searchInput");
const shopCount = document.getElementById("shopCount");
const cartBtn = document.getElementById("cartBtn");
const cartCount = document.getElementById("cartCount");
const cartItems = document.getElementById("cartItems");
const cartTotal = document.getElementById("cartTotal");
const cartDrawer = document.getElementById("cartDrawer");
const cartBackdrop = document.getElementById("cartBackdrop");
const checkoutBtn = document.getElementById("checkoutBtn");
const backdrop = document.getElementById("modalBackdrop");
const modalBody = document.getElementById("modalBody");
const modalTitle = document.getElementById("modalTitle");

/* ---- Load products ---- */
fetch("/api/products")
  .then(r => r.json())
  .then(async db => {
    products = db.products;
    categories = db.categories || ["All"];
    cart = await Cart.load();
    renderFilters();
    renderGrid();
    renderCart();
  })
  .catch(() => { grid.innerHTML = `<p class="muted-note">Couldn't load products.</p>`; });

/* ---- Filters ---- */
function renderFilters() {
  filters.innerHTML = categories.map(c =>
    `<button class="filter ${c === activeCategory ? "active" : ""}" data-cat="${c}">${c}</button>`
  ).join("");
  filters.querySelectorAll(".filter").forEach(b =>
    b.addEventListener("click", () => { activeCategory = b.dataset.cat; renderFilters(); renderGrid(); })
  );
}

/* ---- Product grid ---- */
function renderGrid() {
  const term = searchTerm.trim().toLowerCase();
  let list = activeCategory === "All" ? products : products.filter(p => p.category === activeCategory);
  if (term) list = list.filter(p => (p.name + " " + p.blurb + " " + p.category).toLowerCase().includes(term));
  shopCount.textContent = list.length + (list.length === 1 ? " product" : " products");
  if (!list.length) { grid.innerHTML = '<p class="muted-note" style="grid-column:1/-1;text-align:center;padding:40px 0;">No products match your search.</p>'; return; }
  grid.innerHTML = list.map(p => `
    <article class="product">
      <div class="thumb">${iconFor(p.category)}</div>
      <div class="pbody">
        <div class="ptag">${p.category}</div>
        <h3>${p.name}</h3>
        <p class="pblurb">${p.blurb}</p>
        <div class="prow">
          <span class="price">$${p.price.toFixed(2)}</span>
          <button class="add-btn" data-add="${p.id}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Add
          </button>
        </div>
      </div>
    </article>
  `).join("");
  grid.querySelectorAll("[data-add]").forEach(b =>
    b.addEventListener("click", () => addToCart(b.dataset.add))
  );
}

/* ---- Cart operations ---- */
function addToCart(id) { cart[id] = (cart[id] || 0) + 1; saveCart(); renderCart(); openCart(); }
function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  saveCart(); renderCart();
}
function removeFromCart(id) { delete cart[id]; saveCart(); renderCart(); }

function cartLines() {
  return Object.keys(cart).map(id => {
    const p = products.find(x => x.id === id);
    return p ? { ...p, qty: cart[id] } : null;
  }).filter(Boolean);
}
function cartSubtotal() { return cartLines().reduce((s, l) => s + l.price * l.qty, 0); }
function cartCountTotal() { return Object.values(cart).reduce((s, n) => s + n, 0); }

/* ---- Render cart ---- */
function renderCart() {
  const lines = cartLines();
  cartCount.textContent = cartCountTotal();
  if (!lines.length) {
    cartItems.innerHTML = `<p class="cart-empty">Your cart is empty.<br>Add a few things to get started.</p>`;
  } else {
    cartItems.innerHTML = lines.map(l => `
      <div class="cart-item">
        <div class="ci-info">
          <div class="ci-name">${l.name}</div>
          <div class="ci-price">$${l.price.toFixed(2)} each</div>
          <div class="qty">
            <button data-dec="${l.id}" aria-label="Decrease">&minus;</button>
            <span>${l.qty}</span>
            <button data-inc="${l.id}" aria-label="Increase">+</button>
          </div>
        </div>
        <button class="ci-remove" data-rm="${l.id}">Remove</button>
      </div>
    `).join("");
    cartItems.querySelectorAll("[data-inc]").forEach(b => b.addEventListener("click", () => changeQty(b.dataset.inc, 1)));
    cartItems.querySelectorAll("[data-dec]").forEach(b => b.addEventListener("click", () => changeQty(b.dataset.dec, -1)));
    cartItems.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => removeFromCart(b.dataset.rm)));
  }
  cartTotal.textContent = "$" + cartSubtotal().toFixed(2);
  checkoutBtn.disabled = lines.length === 0;
}

/* ---- Drawer open/close ---- */
function openCart() { cartDrawer.classList.add("open"); cartBackdrop.classList.add("open"); }
function closeCart() { cartDrawer.classList.remove("open"); cartBackdrop.classList.remove("open"); }
searchInput.addEventListener("input", () => { searchTerm = searchInput.value; renderGrid(); });
cartBtn.addEventListener("click", openCart);
document.getElementById("cartClose").addEventListener("click", closeCart);
cartBackdrop.addEventListener("click", closeCart);

/* ---- Checkout (placeholder until the backend handles real orders) ---- */
checkoutBtn.addEventListener("click", async () => {
  const lines = cartLines();
  if (!lines.length) return;

  // Orders belong to an account — guests are nudged to sign in first.
  if (!Cart.isLoggedIn()) {
    modalTitle.textContent = "Sign in to order";
    modalBody.innerHTML = `<p class="muted-note">Please <a href="account.html">log in or create an account</a> to place your order — your cart will be waiting for you.</p>`;
    closeCart();
    backdrop.classList.add("open");
    return;
  }

  checkoutBtn.disabled = true;
  try {
    // Ask the server for a Stripe checkout session, then go to Stripe's page.
    const res = await fetch("/api/checkout", { method: "POST" });
    const data = await res.json();
    if (res.ok && data.url) {
      window.location = data.url;   // redirect to Stripe's hosted checkout
      return;
    }
    modalTitle.textContent = "Checkout problem";
    modalBody.innerHTML = `<p class="muted-note">${data.error || "Couldn't start checkout."}</p>`;
  } catch {
    modalTitle.textContent = "Checkout problem";
    modalBody.innerHTML = `<p class="muted-note">Couldn't reach the server.</p>`;
  } finally {
    checkoutBtn.disabled = false;
    closeCart();
    backdrop.classList.add("open");
  }
});

/* ---- Modal close ---- */
backdrop.querySelector(".modal-close").addEventListener("click", () => backdrop.classList.remove("open"));
backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.classList.remove("open"); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { backdrop.classList.remove("open"); closeCart(); }
});