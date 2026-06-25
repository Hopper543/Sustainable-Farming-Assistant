/* orders.js — show the signed-in user's order history. */
const list = document.getElementById("ordersList");

(async function () {
  let res;
  try {
    res = await fetch("/api/orders");
  } catch {
    list.innerHTML = `<p class="orders-empty">Couldn't reach the server.</p>`;
    return;
  }

  if (res.status === 401) {
    list.innerHTML = `<p class="orders-empty">Please <a href="account.html">log in</a> to see your orders.</p>`;
    return;
  }

  const { orders } = await res.json();
  if (!orders.length) {
    list.innerHTML = `<p class="orders-empty">No orders yet. <a href="shop.html">Visit the shop</a> to get started.</p>`;
    return;
  }

  list.innerHTML = orders.map(o => `
    <div class="order-card">
      <div class="order-head">
        <h3>Order #${o.id}</h3>
        <span class="date">${formatDate(o.created_at)}</span>
      </div>
      <ul>${o.items.map(it => `<li>${escapeHtml(it.name)} &times; ${it.qty} &mdash; $${(it.price * it.qty).toFixed(2)}</li>`).join("")}</ul>
      <div class="order-total"><span>Total</span><span class="t">$${o.total.toFixed(2)}</span></div>
    </div>
  `).join("");
})();

function formatDate(s) {
  // SQLite gives "YYYY-MM-DD HH:MM:SS" in UTC
  const d = new Date((s || "").replace(" ", "T") + "Z");
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }