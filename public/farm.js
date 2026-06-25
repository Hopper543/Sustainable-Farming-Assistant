/* ============================================================
   Farm planner — interactive plot grid
   Pick a crop from the palette, then click or drag across
   plots to plant it. "Details" mode opens the full editor.
   State persists in the browser via localStorage.
   ============================================================ */

const STORAGE_KEY = "farmState";

/* Preset crops, each with a soft colour that tints its plots */
const CROPS = [
  { name: "Tomatoes", color: "#E1A79A" },
  { name: "Lettuce",  color: "#BFD29B" },
  { name: "Carrots",  color: "#EBB583" },
  { name: "Beans",    color: "#AFC79C" },
  { name: "Potatoes", color: "#D8C29C" },
  { name: "Cabbage",  color: "#AEC6BC" },
  { name: "Onions",   color: "#D6BBD0" },
  { name: "Corn",     color: "#E8D596" },
  { name: "Peppers",  color: "#DDA0A0" },
  { name: "Squash",   color: "#E3BD86" }
];
const PALETTE_COLORS = CROPS.map(c => c.color);

let soilTypes = ["Sandy", "Clay", "Loamy", "Silt", "Peaty", "Chalky"];

/* Active tool: a crop to plant, the eraser, or details mode */
let tool = { type: "crop", value: "Tomatoes" };

/* ---- State ---- */
let state = { rows: 3, cols: 3, plots: {} };
let loggedIn = false;
let saveTimer = null;

function readLocal()  { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } }
function writeLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// Save to the database when logged in (debounced so drag-painting doesn't
// fire a request per plot), or to localStorage when a guest.
function saveState() {
  if (loggedIn) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  } else {
    writeLocal();
  }
}
async function persist() {
  try {
    await fetch("/api/farm", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
  } catch { /* offline — ignore */ }
}

// On load: find out if we're logged in, then load the right grid.
// A guest grid is adopted into the account if the account has none yet.
async function initStore() {
  try {
    const me = await (await fetch("/api/me")).json();
    loggedIn = !!(me && me.user);
  } catch { loggedIn = false; }

  let loaded = null;
  if (loggedIn) {
    try {
      const r = await fetch("/api/farm");
      if (r.ok) loaded = (await r.json()).state;
    } catch {}
    const guest = readLocal();
    if (!loaded && guest) {        // bring a guest grid into the account
      state = guest;
      await persist();
      localStorage.removeItem(STORAGE_KEY);
      loaded = guest;
    }
  } else {
    loaded = readLocal();
  }
  if (loaded) state = loaded;
  renderGrid();
}

/* ---- DOM ---- */
const rowsInput = document.getElementById("rows");
const colsInput = document.getElementById("cols");
const grid = document.getElementById("farmGrid");
const palette = document.getElementById("palette");
const statBar = document.getElementById("statBar");
const backdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
let lastFocused = null;
let painting = false;

/* A stable colour for any crop, preset or custom */
function cropColor(name) {
  const preset = CROPS.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (preset) return preset.color;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % PALETTE_COLORS.length;
  return PALETTE_COLORS[hash];
}

/* ---- Palette ---- */
function renderPalette() {
  palette.innerHTML = "";
  CROPS.forEach(c => palette.appendChild(chip({ type: "crop", value: c.name }, c.name, c.color)));
  palette.appendChild(chip({ type: "erase" }, "Eraser", null, "tool"));
  palette.appendChild(chip({ type: "details" }, "Details", null, "tool"));
}
function chip(t, label, color, extra) {
  const el = document.createElement("button");
  el.className = "chip" + (extra ? " " + extra : "") + (sameTool(t, tool) ? " active" : "");
  el.innerHTML = (color ? `<span class="dot" style="background:${color}"></span>` : "") + label;
  el.addEventListener("click", () => { tool = t; renderPalette(); });
  return el;
}
function sameTool(a, b) { return a.type === b.type && a.value === b.value; }

/* ---- Grid ---- */
function createGrid() {
  const rows = clamp(parseInt(rowsInput.value, 10), 1, 10);
  const cols = clamp(parseInt(colsInput.value, 10), 1, 10);
  state.rows = rows; state.cols = cols;
  for (const key of Object.keys(state.plots)) {
    const [r, c] = key.split("-").map(Number);
    if (r >= rows || c >= cols) delete state.plots[key];
  }
  saveState(); renderGrid();
}

function renderGrid() {
  rowsInput.value = state.rows;
  colsInput.value = state.cols;
  grid.style.gridTemplateColumns = `repeat(${state.cols}, minmax(0, 1fr))`;
  grid.innerHTML = "";
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      grid.appendChild(makePlot(`${r}-${c}`));
    }
  }
  renderStats();
}

function makePlot(key) {
  const data = state.plots[key];
  const plot = document.createElement("button");
  plot.className = "plot" + (data ? " planted" : " empty");
  plot.dataset.key = key;
  if (data) {
    plot.style.background = cropColor(data.crop);
    plot.style.borderColor = "transparent";
    plot.innerHTML = `<span class="crop">${escapeHtml(data.crop)}</span>${data.soil ? `<span class="soil">${escapeHtml(data.soil)}</span>` : ""}`;
    plot.setAttribute("aria-label", `Plot ${key}, ${data.crop}`);
  } else {
    plot.innerHTML = `<span class="plus">+</span>`;
    plot.setAttribute("aria-label", `Empty plot ${key}`);
  }
  return plot;
}

/* Apply the current tool to one plot */
function applyTool(key) {
  if (tool.type === "details") { openPlot(key); return; }
  if (tool.type === "erase") {
    delete state.plots[key];
  } else if (tool.type === "crop") {
    const existing = state.plots[key] || {};
    state.plots[key] = { crop: tool.value, soil: existing.soil || "", treatment: existing.treatment || "" };
  }
  saveState();
  // Repaint just this plot for snappy feedback
  const old = grid.querySelector(`[data-key="${key}"]`);
  if (old) old.replaceWith(makePlot(key));
  renderStats();
}

/* ---- Drag-to-paint with pointer events (works for mouse + touch) ---- */
grid.addEventListener("pointerdown", e => {
  const plot = e.target.closest(".plot");
  if (!plot) return;
  if (tool.type === "details") { applyTool(plot.dataset.key); return; }
  painting = true;
  applyTool(plot.dataset.key);
});
grid.addEventListener("pointerover", e => {
  if (!painting) return;
  const plot = e.target.closest(".plot");
  if (plot) applyTool(plot.dataset.key);
});
window.addEventListener("pointerup", () => { painting = false; });

/* ---- Live stats ---- */
function renderStats() {
  const total = state.rows * state.cols;
  const planted = Object.values(state.plots);
  const kinds = new Set(planted.map(p => p.crop)).size;
  statBar.innerHTML =
    `<span><strong>${planted.length}</strong> of ${total} plots planted</span>` +
    `<span><strong>${kinds}</strong> crop type${kinds === 1 ? "" : "s"}</span>`;
}

/* ---- Detailed editor (Details mode) ---- */
function openPlot(key) {
  const data = state.plots[key] || { crop: "", soil: "", treatment: "" };
  modalTitle.textContent = "Manage plot";
  const soilOptions = ['<option value="">Select soil type</option>']
    .concat(soilTypes.map(s => `<option value="${s}" ${data.soil === s ? "selected" : ""}>${s}</option>`))
    .join("");
  modalBody.innerHTML = `
    <label for="cropName">Crop</label>
    <input type="text" id="cropName" placeholder="e.g. Tomatoes" value="${escapeAttr(data.crop)}">
    <label for="soilType" style="margin-top:16px;">Soil type</label>
    <select id="soilType">${soilOptions}</select>
    <label for="treatment" style="margin-top:16px;">Treatment / notes</label>
    <input type="text" id="treatment" placeholder="e.g. organic compost" value="${escapeAttr(data.treatment)}">
    <div class="modal-footer">
      ${state.plots[key] ? `<button class="btn btn-danger" id="removePlot">Clear plot</button>` : ""}
      <button class="btn" id="savePlot">Save</button>
    </div>`;
  modalBody.querySelector("#savePlot").addEventListener("click", () => {
    const crop = modalBody.querySelector("#cropName").value.trim();
    if (!crop) { modalBody.querySelector("#cropName").focus(); return; }
    state.plots[key] = {
      crop,
      soil: modalBody.querySelector("#soilType").value,
      treatment: modalBody.querySelector("#treatment").value.trim()
    };
    saveState(); renderGrid(); closeModal();
  });
  const rm = modalBody.querySelector("#removePlot");
  if (rm) rm.addEventListener("click", () => { delete state.plots[key]; saveState(); renderGrid(); closeModal(); });
  openModal();
  modalBody.querySelector("#cropName").focus();
}

/* ---- Summary ---- */
function showSummary() {
  modalTitle.textContent = "Farm summary";
  const total = state.rows * state.cols;
  const planted = Object.values(state.plots);
  const crops = {}, soils = {};
  planted.forEach(p => {
    crops[p.crop] = (crops[p.crop] || 0) + 1;
    if (p.soil) soils[p.soil] = (soils[p.soil] || 0) + 1;
  });
  const list = (obj, empty) => Object.keys(obj).length
    ? Object.entries(obj).map(([k, n]) => `<li>${escapeHtml(k)} &times; ${n}</li>`).join("")
    : `<li class="muted-note">${empty}</li>`;
  modalBody.innerHTML = `
    <div class="result">
      <h4>${state.rows} &times; ${state.cols} grid</h4>
      <p class="muted-note">${planted.length} of ${total} plots planted.</p>
      <div class="label">Crops</div>
      <ul>${list(crops, "Nothing planted yet")}</ul>
      <div class="label">Soil types</div>
      <ul>${list(soils, "No soil recorded yet")}</ul>
    </div>`;
  openModal();
}

/* ---- Modal machinery ---- */
function openModal() { lastFocused = document.activeElement; backdrop.classList.add("open"); document.body.style.overflow = "hidden"; }
function closeModal() { backdrop.classList.remove("open"); document.body.style.overflow = ""; if (lastFocused) lastFocused.focus(); }
backdrop.querySelector(".modal-close").addEventListener("click", closeModal);
backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && backdrop.classList.contains("open")) closeModal(); });

/* ---- Helpers ---- */
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, isNaN(n) ? lo : n)); }
function escapeHtml(s) { return String(s).replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }

/* ---- Wire up ---- */
document.getElementById("createGrid").addEventListener("click", createGrid);
document.getElementById("showSummary").addEventListener("click", showSummary);
document.getElementById("clearAll").addEventListener("click", () => {
  if (Object.keys(state.plots).length && confirm("Clear every plot? This can't be undone.")) {
    state.plots = {}; saveState(); renderGrid();
  }
});

renderPalette();
initStore();

/* Pull real soil types from the shared dataset if available */
fetch("data/agriculture.json")
  .then(r => r.ok ? r.json() : null)
  .then(db => { if (db && db.soil && db.soil.types) soilTypes = Object.keys(db.soil.types); })
  .catch(() => {});