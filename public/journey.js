/* ============================================================
   journey.js — the pinned, scroll-scrubbed "How it works"
   growth sequence. Requires GSAP + ScrollTrigger (loaded
   before this file). Honours prefers-reduced-motion.
   ============================================================ */
(function () {
  if (typeof gsap === "undefined") return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const steps = gsap.utils.toArray(".step");
  const bar = document.getElementById("bar");
  if (!steps.length) return;

  if (reduce) {
    gsap.set(steps, { autoAlpha: 1 });
    gsap.set([".stem", ".leaf", ".fruit", ".fruit-shine"], { clearProps: "all" });
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  gsap.set(steps, { autoAlpha: 0, y: 30 });
  gsap.set(steps[0], { autoAlpha: 1, y: 0 });
  gsap.set(".stem", { scaleY: 0, svgOrigin: "200 356" });
  gsap.set(".leaf", { scale: 0 });
  gsap.set(".leaf-l", { svgOrigin: "196 268" });
  gsap.set(".leaf-r", { svgOrigin: "204 222" });
  gsap.set([".fruit", ".fruit-shine"], { scale: 0, svgOrigin: "200 150" });

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: "#journey",
      start: "top top",
      end: "+=320%",
      scrub: 1,
      pin: true,
      onUpdate: self => { if (bar) bar.style.width = (self.progress * 100) + "%"; }
    }
  });

  tl.to(steps[0], { autoAlpha: 0, y: -30, duration: 0.4 }, 0.8)
    .to(".seed", { scale: 0, duration: 0.3 }, "<")
    .to(".stem", { scaleY: 0.6, duration: 0.7 }, "<")
    .to(steps[1], { autoAlpha: 1, y: 0, duration: 0.4 }, "<0.1")

    .to(steps[1], { autoAlpha: 0, y: -30, duration: 0.4 }, 1.9)
    .to(".stem", { scaleY: 1, duration: 0.6 }, "<")
    .to(".leaf", { scale: 1, duration: 0.6, stagger: 0.12 }, "<")
    .to(steps[2], { autoAlpha: 1, y: 0, duration: 0.4 }, "<0.1")

    .to(steps[2], { autoAlpha: 0, y: -30, duration: 0.4 }, 3.0)
    .to([".fruit", ".fruit-shine"], { scale: 1, duration: 0.6, ease: "back.out(1.6)" }, "<")
    .to(steps[3], { autoAlpha: 1, y: 0, duration: 0.4 }, "<0.1");
})();