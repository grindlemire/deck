// Demo 1 fallback clip: a silent loop that shows the demo on its own.
// Captions say what is happening; the network panel lists only real
// requests. Keep it 10-25 s and under ~1 MB.
import * as L from "./common.ts";
import path from "node:path";

const { sleep, caption, clickOn } = L;

const server = await L.startServer("step-1");
const browser = await L.chromium.launch();
try {
  const { ctx, page } = await L.recordedPage(browser);
  L.trackNetwork(page); // optional: the live "Network" panel
  await page.goto(L.BASE + "/", { waitUntil: "load" });
  await L.settle(page); // wait for fonts, then start counting requests
  await L.overlay(page, { net: true });

  const start = L.mark(page);
  await caption(page, "What the room is looking at");
  await sleep(2500);

  await caption(page, "Click the thing: watch what changes");
  await clickOn(page, page.locator("button").first(), { ms: 900 });
  await sleep(2500);

  await caption(page, "The point, in one line");
  await sleep(2500);
  const end = L.mark(page);

  const video = page.video();
  await ctx.close();
  const out = path.join(L.MEDIA, "demo-1.mp4");
  L.encode(await video.path(), out, { start: start - 0.2, end });
  console.log("wrote", out, L.duration(out), "s");
} finally {
  await browser.close();
  server.kill();
}
