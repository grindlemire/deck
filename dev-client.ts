/* ============================================================
 * deck / dev-client.ts
 * Added to the deck page by dev.ts only; never part of a build.
 * Listens for changes: stylesheets swap in place, anything else
 * reloads on the same slide and build step.
 * ============================================================ */
(() => {
  "use strict";

  const KEY = "deck-dev-state";
  const deck = window.deck;
  if (!deck) return;

  // Back from a reload: return to the same build step, without fades.
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    sessionStorage.removeItem(KEY);
    if (saved) deck.apply(saved, { instant: true });
  } catch {}

  const reload = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(deck.state()));
    } catch {}
    location.reload();
  };

  // Load the new copy beside the old one and drop the old one once it
  // has loaded, so the page never shows unstyled for a frame.
  const swapCss = (paths) => {
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
    const hit = links.filter((l) => paths.includes(new URL(l.href).pathname));
    // A changed file no link names (an @import, say): refresh them all.
    (hit.length ? hit : links).forEach((old) => {
      const fresh = old.cloneNode() as HTMLLinkElement;
      const url = new URL(old.href);
      url.searchParams.set("v", String(Date.now()));
      fresh.href = url.href;
      fresh.onload = () => {
        old.remove();
        window.deckLint?.badge();
      };
      fresh.onerror = () => old.remove();
      old.after(fresh);
    });
  };

  let lost = false;
  const es = new EventSource("/__deck/events");
  es.addEventListener("css", (e) => swapCss(JSON.parse(e.data)));
  es.addEventListener("reload", reload);
  // The server restarted: whatever changed meanwhile, start fresh.
  es.addEventListener("open", () => {
    if (lost) reload();
  });
  es.addEventListener("error", () => {
    lost = true;
  });
})();
