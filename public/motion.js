/* ============================================================
   motion.js — reusable "modern feel" layer.
     data-reveal              fade + rise into view on scroll
     data-stagger             on a parent: its [data-reveal]
                              children get a small cascade delay
     data-parallax="0.25"     element drifts as you scroll
     data-count-to="10000"    number counts up when seen
       (optional data-count-suffix="K+")
   Each element reveals as IT enters the viewport, so the
   animation plays where you can actually see it.
   Honours prefers-reduced-motion.
   ============================================================ */
(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const supportsIO = "IntersectionObserver" in window;

  /* Give staggered children a small incremental delay */
  document.querySelectorAll("[data-stagger]").forEach(group => {
    group.querySelectorAll("[data-reveal]").forEach((el, i) => {
      el.style.transitionDelay = (i * 0.1) + "s";
    });
  });

  const revealEls = Array.from(document.querySelectorAll("[data-reveal]"));

  if (reduceMotion || !supportsIO) {
    revealEls.forEach(el => el.classList.add("in"));
  } else {
    const revealIO = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        obs.unobserve(entry.target);
      });
    }, { threshold: 0, rootMargin: "0px 0px -12% 0px" });

    revealEls.forEach(el => revealIO.observe(el));
  }

  /* ---------- Count-up numbers ---------- */
  const counters = Array.from(document.querySelectorAll("[data-count-to]"));
  function runCount(el) {
    const to = parseFloat(el.dataset.countTo) || 0;
    const suffix = el.dataset.countSuffix || "";
    const dur = 1300, start = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(step);
    })(start);
  }
  if (counters.length) {
    if (reduceMotion || !supportsIO) {
      counters.forEach(el => { el.textContent = (parseFloat(el.dataset.countTo) || 0) + (el.dataset.countSuffix || ""); });
    } else {
      counters.forEach(el => { el.textContent = "0" + (el.dataset.countSuffix || ""); });
      const countIO = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => { if (entry.isIntersecting) { runCount(entry.target); obs.unobserve(entry.target); } });
      }, { threshold: 0.5 });
      counters.forEach(el => countIO.observe(el));
    }
  }

  /* ---------- Parallax drift ---------- */
  const parallaxEls = Array.from(document.querySelectorAll("[data-parallax]"));
  if (!reduceMotion && parallaxEls.length) {
    let ticking = false;
    function update() {
      const y = window.scrollY;
      parallaxEls.forEach(el => {
        const factor = parseFloat(el.dataset.parallax) || 0.2;
        el.style.transform = "translateY(" + (y * factor) + "px)";
      });
      ticking = false;
    }
    window.addEventListener("scroll", () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
  }

  /* ---------- Account link reflects login state ---------- */
  const navAccount = document.getElementById("navAccount");
  if (navAccount) {
    fetch("/api/me")
      .then(r => r.json())
      .then(d => { navAccount.textContent = d.user ? d.user.name.split(" ")[0] : "Log in"; })
      .catch(() => {});
  }

  /* ---------- Mobile nav toggle ---------- */
  const nav = document.querySelector(".nav");
  const navToggle = document.querySelector(".nav-toggle");
  if (nav && navToggle) {
    navToggle.addEventListener("click", e => {
      e.stopPropagation();
      const open = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll(".nav-links a").forEach(a =>
      a.addEventListener("click", () => { nav.classList.remove("open"); navToggle.setAttribute("aria-expanded", "false"); })
    );
    document.addEventListener("click", e => {
      if (nav.classList.contains("open") && !nav.contains(e.target)) {
        nav.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---------- Current year in footers ---------- */
  const yr = String(new Date().getFullYear());
  document.querySelectorAll(".js-year").forEach(el => { el.textContent = yr; });
})();