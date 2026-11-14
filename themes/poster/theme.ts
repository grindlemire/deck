/* ============================================================
 * deck / themes / poster / theme.ts
 * The poster theme's script. It numbers every slide (the numeral,
 * top right) and moves the progress rule along the top edge:
 *   - deck:slide  the numeral wipes in from the way you went
 *   - deck:phase  the rule runs from where you were to where
 *                    you are, so it also creeps through the steps
 *                    of a slide with data-phases
 * The drawing is CSS (theme.css, "Numeral and progress rule"); this
 * only sets data-pz-* attributes and --pz-from / --pz-to. Include it
 * after the engine: <script src="{{THEME}}/theme.ts"></script>.
 * ============================================================ */
(() => {
  const deck = document.querySelector(".deck");
  if (!deck) return;
  const dk = (window as any).deck;
  const slides: HTMLElement[] = dk?.slides ?? Array.from(deck.querySelectorAll<HTMLElement>(".slide"));
  const n = slides.length;
  if (!n) return;

  const still = matchMedia("(prefers-reduced-motion: reduce)");
  // How far through the talk step `phase` of `phases` on slide i is.
  const at = (i: number, phase = 1, phases = 1) => (i + phase / phases) / n;

  slides.forEach((slide, i) => {
    slide.dataset.pzN = String(i + 1).padStart(2, "0");
    slide.style.setProperty("--pz-to", String(at(i)));
  });

  // Swapping between two copies of an animation's name replays it.
  const replay = (slide: HTMLElement, key: "pzRoll" | "pzRun") => {
    slide.dataset[key] = slide.dataset[key] === "a" ? "b" : "a";
  };

  let last = -1;
  const onSlide = ({ slide, dir }: { slide: HTMLElement; dir: string }) => {
    if (still.matches) return;
    slide.dataset.pzDir = dir;
    replay(slide, "pzRoll");
  };
  const onPhase = ({ index, slide, phase, phases }: { index: number; slide: HTMLElement; phase: number; phases: number }) => {
    const to = at(index, phase, phases);
    slide.style.setProperty("--pz-from", String(last < 0 ? to : last));
    slide.style.setProperty("--pz-to", String(to));
    last = to;
    if (!still.matches) replay(slide, "pzRun");
  };

  const on = dk?.on ?? ((type: string, fn: (d: any) => void) => document.addEventListener(`deck:${type}`, (e) => fn((e as CustomEvent).detail)));
  on("slide", onSlide);
  on("phase", onPhase);

  // The engine announced the first slide before this script ran.
  const index = slides.findIndex((s) => s.classList.contains("current"));
  if (index >= 0) {
    const slide = slides[index];
    const num = (v: string | undefined) => Math.max(1, parseInt(v || "1", 10) || 1);
    onPhase({ index, slide, phase: num(slide.dataset.phase), phases: num(slide.dataset.phases) });
  }
})();
