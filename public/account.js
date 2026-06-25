/* ============================================================
   account.js — login / register UI, wired to the auth routes.
   Shows forms when signed out, and a signed-in panel when in.
   ============================================================ */

const card = document.getElementById("authCard");
const title = document.getElementById("authTitle");
const sub = document.getElementById("authSub");

init();

async function init() {
  try {
    const me = await (await fetch("/api/me")).json();
    if (me.user) return renderSignedIn(me.user);
  } catch { /* server not reachable — fall through to forms */ }
  renderForms("login");
}

/* ---- Signed in ---- */
function renderSignedIn(user) {
  const first = user.name.split(" ")[0];
  title.textContent = `Hello, ${first}`;
  sub.textContent = "You're signed in.";
  card.innerHTML = `
    <div class="auth-panel">
      <div class="avatar">${escapeHtml(first[0] || "?").toUpperCase()}</div>
      <p class="muted-note">Signed in as <strong>${escapeHtml(user.name)}</strong><br>${escapeHtml(user.email)}</p>
      <a class="btn btn-ghost" href="orders.html" style="display:inline-flex; margin-top:18px; background:transparent; color:var(--sage); border:1px solid var(--line);">Order history</a>
      <button class="btn" id="logoutBtn" style="margin-top:10px;">Log out</button>
    </div>`;
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    location.reload();
  });
}

/* ---- Forms ---- */
function renderForms(active) {
  title.textContent = active === "login" ? "Welcome back" : "Create your account";
  sub.textContent = active === "login" ? "Sign in to continue." : "It only takes a moment.";

  const loginFields = `
    <label for="lEmail">Email</label>
    <input id="lEmail" type="email" placeholder="you@example.com" autocomplete="email">
    <label for="lPass">Password</label>
    <input id="lPass" type="password" placeholder="Your password" autocomplete="current-password">
    <button class="btn" id="loginBtn">Log in</button>`;

  const registerFields = `
    <label for="rName">Name</label>
    <input id="rName" type="text" placeholder="Your name" autocomplete="name">
    <label for="rEmail">Email</label>
    <input id="rEmail" type="email" placeholder="you@example.com" autocomplete="email">
    <label for="rPass">Password</label>
    <input id="rPass" type="password" placeholder="At least 8 characters" autocomplete="new-password">
    <button class="btn" id="registerBtn">Create account</button>`;

  card.innerHTML = `
    <div class="auth-tabs">
      <button class="auth-tab ${active === "login" ? "active" : ""}" data-tab="login">Log in</button>
      <button class="auth-tab ${active === "register" ? "active" : ""}" data-tab="register">Create account</button>
    </div>
    ${active === "login" ? loginFields : registerFields}
    <p class="auth-error" id="authError"></p>`;

  card.querySelectorAll(".auth-tab").forEach(t =>
    t.addEventListener("click", () => renderForms(t.dataset.tab))
  );

  if (active === "login") {
    const btn = document.getElementById("loginBtn");
    btn.addEventListener("click", () => submit("/api/login", {
      email: val("lEmail"), password: val("lPass")
    }, btn));
    enterToSubmit(["lEmail", "lPass"], btn);
  } else {
    const btn = document.getElementById("registerBtn");
    btn.addEventListener("click", () => submit("/api/register", {
      name: val("rName"), email: val("rEmail"), password: val("rPass")
    }, btn));
    enterToSubmit(["rName", "rEmail", "rPass"], btn);
  }
}

/* ---- Submit handler ---- */
async function submit(url, body, btn) {
  const err = document.getElementById("authError");
  err.textContent = "";
  btn.disabled = true;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error || "Something went wrong.";
      btn.disabled = false;
      return;
    }
    // Success — go to the homepage as a signed-in user
    window.location.href = "index.html";
  } catch {
    err.textContent = "Couldn't reach the server. Is it running on port 3000?";
    btn.disabled = false;
  }
}

/* ---- Helpers ---- */
function val(id) { return document.getElementById(id).value.trim(); }
function enterToSubmit(ids, btn) {
  ids.forEach(id => document.getElementById(id).addEventListener("keydown", e => {
    if (e.key === "Enter") btn.click();
  }));
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])); }