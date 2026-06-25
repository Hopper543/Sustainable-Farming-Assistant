/* ============================================================
   Sustainable Farming Assistant — homepage tools

   Loads the curated dataset AND the product catalogue, then
   each soil/pest/rotation result can show "Add to cart"
   buttons for the products that fulfil its advice. Those write
   to the same localStorage cart the Shop page reads, so the
   advice and the shop are one connected experience.
   ============================================================ */

let DB = null;
const PRODUCTS = {};

async function loadData() {
  const [aRes, pRes] = await Promise.all([
    fetch("data/agriculture.json"),
    fetch("/api/products")
  ]);
  if (!aRes.ok) throw new Error("Could not load dataset (" + aRes.status + ")");
  DB = await aRes.json();
  if (pRes.ok) {
    const pj = await pRes.json();
    pj.products.forEach(p => { PRODUCTS[p.id] = p; });
  }
}

/* ---- Source links ---- */
function sourceLink(s) { return `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`; }
function sourcesBlock(list) {
  const items = Array.isArray(list) ? list : [list];
  return `<div class="label">Source</div><p class="muted-note">${items.map(sourceLink).join(" &middot; ")}</p>`;
}

/* ---- Shop links: turn product ids into add-to-cart buttons ---- */
function renderShop(ids, label) {
  if (!ids || !ids.length) return "";
  const items = ids.map(id => PRODUCTS[id]).filter(Boolean);
  if (!items.length) return "";
  return `
    <div class="label">${label || "Shop these"}</div>
    <div class="shop-links">
      ${items.map(p => `<button class="shop-link" data-buy="${p.id}"><span class="sl-name">${p.name}</span><span class="sl-add">$${p.price.toFixed(2)} · + Add</span></button>`).join("")}
    </div>`;
}
function wireShop(container) {
  container.querySelectorAll("[data-buy]").forEach(b =>
    b.addEventListener("click", () => addToShopCart(b.dataset.buy, b))
  );
}
async function addToShopCart(id, btn) {
  const cart = await Cart.load();
  cart[id] = (cart[id] || 0) + 1;
  await Cart.save(cart);
  showToast((PRODUCTS[id] ? PRODUCTS[id].name : "Item") + " added to cart");
  if (btn) {
    const add = btn.querySelector(".sl-add");
    if (add) { const original = add.textContent; add.textContent = "Added ✓"; setTimeout(() => { add.textContent = original; }, 1500); }
  }
}

/* ---- Toast ---- */
let toastEl = null;
function showToast(msg) {
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
  toastEl.innerHTML = `${msg} &nbsp;<a href="shop.html">View cart</a>`;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

/* ---- Tool registry ---- */
const tools = {
  soil: {
    title: "Soil & fertilizer advisor",
    render() {
      const options = Object.keys(DB.soil.types).map(s => `<option value="${s}">${s}</option>`).join("");
      return `<label for="soilSelect">Select your soil type</label><select id="soilSelect">${options}</select><div id="soilResult"></div>`;
    },
    init(body) {
      const select = body.querySelector("#soilSelect");
      const out = body.querySelector("#soilResult");
      function update() {
        const d = DB.soil.types[select.value];
        out.innerHTML = `
          <div class="result">
            <h4>${select.value} soil</h4>
            <p class="muted-note">${d.characteristics}</p>
            <div class="label">Typical pH</div>
            <p class="muted-note">${d.ph}</p>
            <div class="label">Good crops</div>
            <ul>${d.crops.map(c => `<li>${c}</li>`).join("")}</ul>
            <div class="label">How to improve it</div>
            <ul>${d.amendments.map(a => `<li>${a}</li>`).join("")}</ul>
            ${renderShop(d.products)}
            ${sourcesBlock(DB.soil.sources)}
          </div>`;
        wireShop(out);
      }
      select.addEventListener("change", update);
      update();
    }
  },

  irrigation: {
    title: "Irrigation scheduler",
    render() {
      return `
        <label for="irrCrop">Crop name</label>
        <input type="text" id="irrCrop" placeholder="e.g. Tomatoes">
        <label for="irrInterval" style="margin-top:16px;">Water every (days)</label>
        <input type="number" id="irrInterval" min="1" max="30" value="3">
        <button class="btn" id="irrGo" style="margin-top:18px;">Build schedule</button>
        <div id="irrResult"></div>`;
    },
    init(body) {
      body.querySelector("#irrGo").addEventListener("click", () => {
        const crop = body.querySelector("#irrCrop").value.trim() || "your crop";
        const interval = Math.max(1, parseInt(body.querySelector("#irrInterval").value, 10) || 3);
        const dates = [];
        const today = new Date();
        for (let i = 1; i <= 6; i++) {
          const dt = new Date(today); dt.setDate(today.getDate() + interval * i);
          dates.push(dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
        }
        body.querySelector("#irrResult").innerHTML = `
          <div class="result">
            <h4>Next waterings for ${crop}</h4>
            <p class="muted-note">Every ${interval} day${interval > 1 ? "s" : ""}, starting from today.</p>
            <ul>${dates.map(d => `<li>${d}</li>`).join("")}</ul>
          </div>`;
      });
    }
  },

  pest: {
    title: "Pest & disease guide",
    render() {
      return `
        <label for="pestCrop">Which crop are you worried about?</label>
        <input type="text" id="pestCrop" placeholder="e.g. tomato, cabbage, potato">
        <button class="btn" id="pestGo" style="margin-top:18px;">Find issues</button>
        <div id="pestResult"></div>`;
    },
    init(body) {
      const input = body.querySelector("#pestCrop");
      const out = body.querySelector("#pestResult");
      function search() {
        const q = input.value.trim().toLowerCase();
        if (q.length < 3) { out.innerHTML = `<p class="muted-note" style="margin-top:16px;">Type a crop name to see what commonly affects it.</p>`; return; }
        const matches = DB.pests.filter(p => p.affectedCrops.some(c => c.includes(q) || q.includes(c)));
        if (!matches.length) { out.innerHTML = `<p class="muted-note" style="margin-top:16px;">No specific matches for "${input.value.trim()}". Try "cabbage" or "tomato".</p>`; return; }
        out.innerHTML = matches.map(p => `
          <div class="result">
            <h4>${p.name} <span class="muted-note">(${p.type})</span></h4>
            <div class="label">Signs</div>
            <p class="muted-note">${p.signs}</p>
            <div class="label">Organic treatment</div>
            <ul>${p.organicTreatment.map(t => `<li>${t}</li>`).join("")}</ul>
            <div class="label">Prevention</div>
            <ul>${p.prevention.map(t => `<li>${t}</li>`).join("")}</ul>
            ${renderShop(p.products)}
            ${sourcesBlock(p.source)}
          </div>`).join("");
        wireShop(out);
      }
      body.querySelector("#pestGo").addEventListener("click", search);
      input.addEventListener("keydown", e => { if (e.key === "Enter") search(); });
    }
  },

  rotation: {
    title: "Crop rotation planner",
    render() {
      return `
        <label for="rotCrop">What did you grow here last?</label>
        <input type="text" id="rotCrop" placeholder="e.g. cabbage, peas, carrots">
        <button class="btn" id="rotGo" style="margin-top:18px;">Plan next season</button>
        <div id="rotResult"></div>`;
    },
    init(body) {
      const out = body.querySelector("#rotResult");
      function plan() {
        const q = body.querySelector("#rotCrop").value.trim().toLowerCase();
        let familyName = null;
        for (const [crop, fam] of Object.entries(DB.rotation.cropToFamily)) {
          if (q === crop || q.includes(crop) || crop.includes(q)) { familyName = fam; break; }
        }
        if (!familyName) {
          const cycle = DB.rotation.cycle.join(" &rarr; ") + " &rarr; (back to start)";
          out.innerHTML = `<div class="result"><h4>General rotation order</h4><p class="muted-note">We couldn't match that crop, but here's the recommended cycle:</p><p class="muted-note" style="margin-top:8px;"><strong>${cycle}</strong></p>${sourcesBlock(DB.rotation.source)}</div>`;
          return;
        }
        const fam = DB.rotation.families[familyName];
        const nextFam = DB.rotation.families[fam.followWith];
        out.innerHTML = `
          <div class="result">
            <h4>Last crop: ${familyName}</h4>
            <p class="muted-note">${fam.role}</p>
            <div class="label">Plant next</div>
            <p class="muted-note"><strong>${fam.followWith}</strong> &mdash; ${nextFam.role}</p>
            <ul>${nextFam.members.map(m => `<li>${m}</li>`).join("")}</ul>
            <div class="label">Avoid</div>
            <p class="muted-note">${fam.avoid}.</p>
            ${renderShop(nextFam.products, "Shop seeds for " + fam.followWith)}
            ${sourcesBlock(DB.rotation.source)}
          </div>`;
        wireShop(out);
      }
      body.querySelector("#rotGo").addEventListener("click", plan);
    }
  },

  weather: {
    title: "Weather insights",
    render() {
      return `
        <label for="wxCity">Your town or city</label>
        <input type="text" id="wxCity" placeholder="e.g. Pune">
        <div style="display:flex; gap:10px; margin-top:18px;">
          <button class="btn" id="wxGo" style="flex:1; justify-content:center;">Get weather</button>
          <button class="btn" id="wxLoc" style="background:transparent; color:var(--sage); border:1px solid var(--line);">Use my location</button>
        </div>
        <div id="wxResult"></div>`;
    },
    init(body) {
      const input = body.querySelector("#wxCity");
      const out = body.querySelector("#wxResult");

      // One function does the fetch + render; both buttons feed it a query.
      async function fetchWeather(query, loadingLabel) {
        out.innerHTML = `<p class="muted-note" style="margin-top:16px;">${loadingLabel}</p>`;
        try {
          // The browser calls OUR server, not OpenWeatherMap directly.
          const res = await fetch(`/api/weather?${query}`);
          const data = await res.json();
          if (!res.ok) {
            out.innerHTML = `<p class="muted-note" style="margin-top:16px;">${data.error || "Couldn't get the weather."}</p>`;
            return;
          }
          out.innerHTML = `
            <div class="result">
              <h4>${data.city}${data.country ? ", " + data.country : ""}</h4>
              <p class="muted-note" style="text-transform:capitalize;">${data.description || ""}</p>
              <div class="label">Temperature</div>
              <p class="muted-note">${data.temp}&deg;C (feels like ${data.feelsLike}&deg;C)</p>
              <div class="label">Humidity</div>
              <p class="muted-note">${data.humidity}%</p>
              <div class="label">Wind</div>
              <p class="muted-note">${data.wind} m/s</p>
              <p class="muted-note" style="margin-top:14px;">${cropTip(data)}</p>
            </div>`;
        } catch (err) {
          out.innerHTML = `<p class="muted-note" style="margin-top:16px;">Couldn't reach the server. Is it running on port 3000?</p>`;
        }
      }

      function byCity() {
        const city = input.value.trim();
        if (!city) { input.focus(); return; }
        fetchWeather(`city=${encodeURIComponent(city)}`, `Checking the sky over ${city}…`);
      }

      function byLocation() {
        if (!navigator.geolocation) {
          out.innerHTML = `<p class="muted-note" style="margin-top:16px;">Your browser can't share location — type a city instead.</p>`;
          return;
        }
        out.innerHTML = `<p class="muted-note" style="margin-top:16px;">Finding your location…</p>`;
        navigator.geolocation.getCurrentPosition(
          pos => fetchWeather(`lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`, "Checking the sky above you…"),
          ()  => { out.innerHTML = `<p class="muted-note" style="margin-top:16px;">Couldn't get your location — type a city instead.</p>`; }
        );
      }

      body.querySelector("#wxGo").addEventListener("click", byCity);
      body.querySelector("#wxLoc").addEventListener("click", byLocation);
      input.addEventListener("keydown", e => { if (e.key === "Enter") byCity(); });
    }
  }
};

/* A small touch of crop advice based on the live conditions */
function cropTip(d) {
  if (d.temp >= 32) return "Hot day — water early or late, and watch for heat stress on seedlings.";
  if (d.temp <= 5) return "Cold — protect tender plants with fleece or a cloche overnight.";
  if (d.humidity >= 85) return "Very humid — keep airflow up to reduce the risk of fungal disease.";
  if (d.wind >= 8) return "Breezy — stake taller plants and hold off on spraying.";
  return "Mild conditions — a good window for sowing, transplanting, or general care.";
}

function placeholder(text) { return () => `<p class="muted-note">This tool will let you ${text}. We'll wire it up next.</p>`; }

/* ============================================================
   Modal machinery
   ============================================================ */
const backdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
let lastFocused = null;

function openTool(id) {
  const tool = tools[id];
  if (!tool) return;
  lastFocused = document.activeElement;
  modalTitle.textContent = tool.title;
  const needsData = ["soil", "pest", "rotation"].includes(id);
  if (needsData && !DB) {
    modalBody.innerHTML = `<p class="muted-note">Loading data… try again in a moment.</p>`;
  } else {
    modalBody.innerHTML = tool.render();
    if (tool.init) tool.init(modalBody);
  }
  backdrop.classList.add("open");
  document.body.style.overflow = "hidden";
  const focusable = modalBody.querySelector("select, input, button") || backdrop.querySelector(".modal-close");
  if (focusable) focusable.focus();
}
function closeModal() {
  backdrop.classList.remove("open");
  document.body.style.overflow = "";
  if (lastFocused) lastFocused.focus();
}
document.querySelectorAll("[data-tool]").forEach(card => {
  card.addEventListener("click", () => openTool(card.dataset.tool));
  card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTool(card.dataset.tool); } });
});
backdrop.querySelector(".modal-close").addEventListener("click", closeModal);
backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && backdrop.classList.contains("open")) closeModal(); });

loadData().catch(err => console.error(err));