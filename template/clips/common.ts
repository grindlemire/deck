// Shared setup for this talk's demo clips. Everything generic lives in
// deck/clip.ts; this file says where the demo app lives and
// where the clips go.
//
//   bun install && bunx playwright install chromium   # once
//   bun {{TALK}}/clips/demo-1.ts
//
// CLIP_OUT=/some/dir writes the MP4 somewhere else.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configure, goApp } from "{{DECK_FROM_CLIPS}}/clip.ts";

export * from "{{DECK_FROM_CLIPS}}/clip.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// A port of its own, so recording works while a live demo runs.
export const PORT = 8091;
export const BASE = `http://localhost:${PORT}`;
export const MEDIA = process.env.CLIP_OUT || path.join(here, "..", "deck", "media");

configure({ width: 1200, height: 750 });

// A Go app in <talk>/demo/<dir> that reads PORT. For anything else,
// use startApp({ cmd, args, cwd, env, readyUrl }).
export const startServer = (dir: string, readyPath = "/") =>
  goApp(path.join(here, "..", "demo", dir), { port: PORT, readyPath });
