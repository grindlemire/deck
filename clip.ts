/* ============================================================
 * deck / clip.ts
 * Record silent demo clips for "fallback" demo slides: a real app
 * driven by Playwright, with a visible cursor, captions that say what
 * is happening, an optional live network panel (real requests only,
 * never invented), and an H.264 MP4 that deck inlines and loops.
 *
 *   bun install && bunx playwright install chromium   # once
 *   bun my-talk/clips/demo-1.ts                       # your clip script
 *
 * A clip script: start the app (startApp / goApp), open a recorded
 * page, overlay(), settle(), caption()/clickOn()/typeSlow(), then
 * encode() the video between two mark()s. See AUTHORING.md.
 * Needs ffmpeg and ffprobe on PATH.
 * ============================================================ */
import { chromium } from "playwright";
import type { Page, Browser, BrowserContext, BrowserContextOptions, Locator, Request } from "playwright";
import type { ChildProcess } from "node:child_process";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export { chromium };

// Recording size (16:10 fits the demo-slide frame) and scratch dir.
export let W = 1200;
export let H = 750;
export let TMP = path.join(os.tmpdir(), "deck-clips");

export type ClipConfig = { width?: number; height?: number; tmpDir?: string };

// What a clip script's page carries between calls (cursor, network
// panel, last caption, recording start). Stored on the Playwright Page.
export type Point = { x: number; y: number };
export type OverlayOptions = { net?: boolean; capWidth?: number; capSize?: number; netWidth?: number };
export type NetRow = { m: string; p: string; s: string; t: string };
export type NetState = { rows: NetRow[]; armed: boolean; label: string; note?: string; preview?: string };
export type ClipState = {
  __t0?: number;
  __ovOpts?: OverlayOptions;
  __cur?: Point;
  __net?: NetState;
  __lastCap?: string;
  __who?: string;
  __panelHtml?: string;
};
export type ClipPage = Page & ClipState;

export function configure({ width, height, tmpDir }: ClipConfig = {}): void {
  if (width) W = width;
  if (height) H = height;
  if (tmpDir) TMP = tmpDir;
  fs.mkdirSync(path.join(TMP, "rec"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "frames"), { recursive: true });
}
configure();

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type StartAppOptions = {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  readyUrl: string;
  timeoutMs?: number;
};

// Start any app and wait until readyUrl answers 2xx. Returns the child.
export async function startApp({ cmd, args = [], cwd, env = {}, readyUrl, timeoutMs = 60000 }: StartAppOptions): Promise<ChildProcess> {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: "ignore" });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(readyUrl);
      if (r.ok) return p;
    } catch {}
    await sleep(150);
  }
  p.kill();
  throw new Error(`app in ${cwd} did not answer ${readyUrl}`);
}

// Build a Go app to a temp binary and run it with PORT set (building
// first means killing the child really stops the server, unlike go run).
export type GoAppOptions = { port?: number; readyPath?: string; env?: Record<string, string> };

export async function goApp(dir: string, { port = 8091, readyPath = "/", env = {} }: GoAppOptions = {}): Promise<ChildProcess> {
  const bin = path.join(TMP, `app-${path.basename(dir)}-${port}`);
  execFileSync("go", ["build", "-o", bin, "."], { cwd: dir, stdio: "inherit" });
  return startApp({ cmd: bin, cwd: dir, env: { PORT: String(port), ...env }, readyUrl: `http://localhost:${port}${readyPath}` });
}

// ---------------------------------------------------------------- overlay

function installOverlay(opts: OverlayOptions): void {
  if (document.getElementById('__ov-style')) return;
  const style = document.createElement('style');
  style.id = '__ov-style';
  style.textContent = `
    .__panel{position:fixed;z-index:2147483646;background:#161a21;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.5);pointer-events:none;box-sizing:border-box}
    #__cap{left:16px;bottom:16px;max-width:${opts.capWidth || 640}px;padding:11px 16px 12px;font:400 ${opts.capSize || 16}px/1.4 "IBM Plex Sans",system-ui,-apple-system,sans-serif;transition:opacity .2s ease;}
    #__cap .who{display:block;font:600 12px/1.2 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#5aa7ff;margin-bottom:4px}
    #__cap .txt b{font-weight:600}
    #__net{right:16px;top:60px;width:${opts.netWidth || 420}px;padding:10px 12px 10px;font:400 12.5px/1.55 "IBM Plex Mono",ui-monospace,monospace}
    #__net .hd{display:flex;justify-content:space-between;color:rgba(255,255,255,.6);margin-bottom:6px;font-size:11.5px;letter-spacing:.04em}
    #__net .hd b{color:#fff;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
    #__net .row{display:flex;gap:10px;white-space:nowrap;color:#fff}
    #__net .row .m{width:38px;color:#5aa7ff}
    #__net .row .p{flex:1;overflow:hidden;text-overflow:ellipsis}
    #__net .row .s{width:42px;text-align:right}
    #__net .row .s.ok{color:#7ee2a8}
    #__net .row .s.nm{color:#e8c46a}
    #__net .row .s.bad{color:#ff7b72}
    #__net .row .t{width:112px;color:rgba(255,255,255,.6);overflow:hidden;text-overflow:ellipsis}
    #__net .pv{margin-top:8px;padding:8px 10px;background:#0d1016;border:1px solid rgba(255,255,255,.08);border-radius:6px;color:#c9d1d9;white-space:pre-wrap;word-break:break-all;font-size:11.5px;line-height:1.5}
    #__net .pv:before{content:"response body";display:block;color:rgba(255,255,255,.45);margin-bottom:4px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
    #__net .empty{color:rgba(255,255,255,.45)}
    #__net .ft{margin-top:6px;color:rgba(255,255,255,.6);font-size:11.5px}
    #__cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:22px;height:22px;transform:translate(-100px,-100px)}
    #__ring{position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;border-radius:50%;border:2px solid #5aa7ff;opacity:0;transform:translate(-50%,-50%) scale(.4);left:0;top:0}
    #__ring.go{animation:__ring .45s ease-out}
    @keyframes __ring{0%{opacity:.9;transform:translate(-50%,-50%) scale(.4)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}
  `;
  document.head.append(style);
  const cap = document.createElement('div');
  cap.id = '__cap';
  cap.className = '__panel';
  cap.style.opacity = '0';
  document.body.append(cap);
  if (opts.net) {
    const net = document.createElement('div');
    net.id = '__net';
    net.className = '__panel';
    document.body.append(net);
  }
  const cur = document.createElement('div');
  cur.id = '__cur';
  cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.2 14.2 L10 20.5 L12.8 19.3 L10.1 13.2 L15.8 13.2 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  document.body.append(cur);
  const ring = document.createElement('div');
  ring.id = '__ring';
  document.body.append(ring);
}

export async function overlay(page: ClipPage, opts: OverlayOptions = {}): Promise<void> {
  page.__ovOpts = opts;
  await page.evaluate(installOverlay, opts);
  const c = page.__cur || { x: W / 2, y: H / 2 };
  await setCursor(page, c.x, c.y);
  if (page.__net) await renderNet(page);
  if (page.__lastCap) await caption(page, page.__lastCap);
}

export async function caption(page: ClipPage, html: string, who?: string): Promise<void> {
  who = who ?? page.__who;
  page.__lastCap = html;
  await page.evaluate(
    ([html, who]) => {
      const cap = document.getElementById('__cap');
      if (!cap) return;
      cap.innerHTML = (who ? `<span class="who">${who}</span>` : '') + `<span class="txt">${html}</span>`;
      cap.style.opacity = html ? '1' : '0';
    },
    [html, who] satisfies [string, string | undefined],
  );
}

// ---------------------------------------------------------------- network

// Tracks real requests made after the page's load event and shows them in
// the overlay panel. Nothing is invented: rows come from Playwright events.
export type TrackNetworkOptions = { label?: string; filter?: (req: Request) => boolean; note?: string };

export function trackNetwork(page: ClipPage, { label = 'since page load', filter, note }: TrackNetworkOptions = {}): NetState {
  const net: NetState = { rows: [], armed: false, label, note };
  page.__net = net;
  // Armed by settle(): after the load event AND after the fonts the
  // first paint asked for, so the panel starts from a fully loaded page.
  const shortPath = (u: string) => {
    const x = new URL(u);
    return x.pathname + x.search;
  };
  const byReq = new Map<Request, NetRow>();
  page.on('request', (req) => {
    if (!net.armed) return;
    if (filter && !filter(req)) return;
    const row = { m: req.method(), p: shortPath(req.url()), s: '...', t: '' };
    byReq.set(req, row);
    net.rows.push(row);
    renderNet(page).catch(() => {});
  });
  page.on('response', (res) => {
    const row = byReq.get(res.request());
    if (!row) return;
    row.s = String(res.status());
    const ct = (res.headers()['content-type'] || '').split(';')[0];
    row.t = res.status() === 304 ? 'not modified' : ct || '-';
    renderNet(page).catch(() => {});
  });
  page.on('requestfailed', (req) => {
    const row = byReq.get(req);
    // Chromium reports a bodiless 304 as aborted after its response; keep the status
    if (!row || row.s !== '...') return;
    row.s = 'fail';
    row.t = 'no response';
    renderNet(page).catch(() => {});
  });
  return net;
}

export async function renderNet(page: ClipPage): Promise<void> {
  const net = page.__net;
  if (!net) return;
  await page.evaluate(
    ([rows, label, preview, note]) => {
      const el = document.getElementById('__net');
      if (!el) return;
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const n = rows.length;
      const head = `<div class="hd"><b>Network</b><span>${n} request${n === 1 ? '' : 's'} ${esc(label)}</span></div>`;
      const body = n
        ? rows
            .slice(-8)
            .map((r) => {
              const cls = r.s === '...' ? '' : /^2/.test(r.s) ? 'ok' : r.s === '304' ? 'nm' : 'bad';
              return `<div class="row"><span class="m">${r.m}</span><span class="p">${esc(r.p)}</span><span class="s ${cls}">${r.s}</span><span class="t">${esc(r.t)}</span></div>`;
            })
            .join('')
        : `<div class="empty">(nothing)</div>`;
      const pv = preview ? `<div class="pv">${esc(preview)}</div>` : '';
      const nt = note ? `<div class="ft">${esc(note)}</div>` : '';
      el.innerHTML = head + body + pv + nt;
    },
    [net.rows, net.label, net.preview || '', net.note || ''] satisfies [NetRow[], string, string, string],
  );
}

// ---------------------------------------------------------------- input

export async function setCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([x, y]) => {
      const c = document.getElementById('__cur');
      if (c) c.style.transform = `translate(${x - 3}px,${y - 2}px)`;
    },
    [x, y] satisfies [number, number],
  );
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export async function moveTo(page: ClipPage, x: number, y: number, ms = 700): Promise<void> {
  const from = page.__cur || { x: W / 2, y: H / 2 };
  const steps = Math.max(6, Math.round(ms / 28));
  const t0 = Date.now();
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    const xi = from.x + (x - from.x) * t;
    const yi = from.y + (y - from.y) * t;
    await page.mouse.move(xi, yi);
    await setCursor(page, xi, yi);
    const due = t0 + (ms * i) / steps;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
  }
  page.__cur = { x, y };
}

export async function pulse(page: ClipPage): Promise<void> {
  const { x, y } = page.__cur || { x: 0, y: 0 };
  await page.evaluate(
    ([x, y]) => {
      const r = document.getElementById('__ring');
      if (!r) return;
      r.style.left = x + 'px';
      r.style.top = y + 'px';
      r.classList.remove('go');
      void r.offsetWidth;
      r.classList.add('go');
    },
    [x, y] satisfies [number, number],
  );
}

export async function center(locator: Locator): Promise<Point & { box: { x: number; y: number; width: number; height: number } }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('no box');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}

export type ClickOptions = { ms?: number; dx?: number; pause?: number };

export async function clickOn(page: ClipPage, locator: Locator, { ms = 700, dx = 0, pause = 150 }: ClickOptions = {}): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const { x, y } = await center(locator);
  await moveTo(page, x + dx, y, ms);
  await sleep(pause);
  await pulse(page);
  await page.mouse.down();
  await page.mouse.up();
}

export async function typeSlow(page: Page, text: string, delay = 65): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(delay + Math.random() * 30);
  }
}

export async function scrollTo(page: Page, y: number, ms = 1200): Promise<void> {
  const from = await page.evaluate(() => window.scrollY);
  const steps = Math.max(6, Math.round(ms / 30));
  const t0 = Date.now();
  for (let i = 1; i <= steps; i++) {
    const yi = from + (y - from) * ease(i / steps);
    await page.evaluate((v: number) => window.scrollTo(0, v), yi);
    const wait = t0 + (ms * i) / steps - Date.now();
    if (wait > 0) await sleep(wait);
  }
}

// ---------------------------------------------------------------- recording

export async function recordedPage(browser: Browser, ctxOpts: BrowserContextOptions = {}): Promise<{ ctx: BrowserContext; page: ClipPage }> {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    recordVideo: { dir: path.join(TMP, "rec"), size: { width: W, height: H } },
    ...ctxOpts,
  });
  const page: ClipPage = await ctx.newPage();
  page.__t0 = Date.now();
  return { ctx, page };
}

export const mark = (page: ClipPage): number => (Date.now() - (page.__t0 as number)) / 1000;

export type EncodeOptions = { start?: number; end?: number; crf?: number; extraVf?: string };

export function encode(webm: string, out: string, { start = 0, end, crf = 30, extraVf }: EncodeOptions = {}): void {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(start), '-i', webm];
  if (end) args.push('-t', String(end - start));
  const vf = ['fps=25', ...(extraVf ? [extraVf] : []), 'format=yuv420p'].join(',');
  args.push('-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-tune', 'animation', '-movflags', '+faststart', out);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
}

export function duration(file: string): string {
  return execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
}

export function frames(file: string, name: string, times: number[]): void {
  for (const [i, t] of times.entries()) {
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', `${TMP}/frames/${name}-${i}.png`]);
  }
}

export async function panel(page: ClipPage, html: string): Promise<void> {
  page.__panelHtml = html;
  await page.evaluate((html: string) => {
    const el = document.getElementById('__net');
    if (el) el.innerHTML = html;
  }, html);
}

export async function docY(page: Page, sel: string): Promise<number | null> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().top + window.scrollY : null;
  }, sel);
}

// Wait until the page has fully loaded (load event, fonts, a quiet
// moment), then start listing requests in the network panel.
export async function settle(page: ClipPage): Promise<void> {
  await page.waitForLoadState('load');
  // the overlay's own fonts load here, before the panel starts counting
  await page.evaluate(() =>
    Promise.all(
      ['400 16px "IBM Plex Sans"', '600 16px "IBM Plex Sans"', '400 12px "IBM Plex Mono"', '600 12px "IBM Plex Mono"'].map((f) =>
        document.fonts.load(f).catch(() => {}),
      ),
    ).then(() => document.fonts.ready),
  );
  await sleep(400);
  if (page.__net) page.__net.armed = true;
}

// A small live readout of the page's scroll position (JS-enabled pages).
export async function scrollReadout(page: Page, top = 200): Promise<void> {
  await page.evaluate((top: number) => {
    if (document.getElementById('__scroll')) return;
    const el = document.createElement('div');
    el.id = '__scroll';
    el.className = '__panel';
    el.style.cssText = `right:16px;top:${top}px;padding:8px 12px;font:400 12.5px/1.4 "IBM Plex Mono",ui-monospace,monospace;color:rgba(255,255,255,.65)`;
    const draw = () => (el.innerHTML = `scroll position <b style="color:#fff;font-weight:600">${Math.round(window.scrollY).toLocaleString('en-US')} px</b>`);
    draw();
    window.addEventListener('scroll', draw, { passive: true });
    document.body.append(el);
  }, top);
}

// Outline an element (for pointing at it), following it while it stays.
export async function spotlight(page: Page, sel: string, on = true): Promise<void> {
  await page.evaluate(
    ([sel, on]) => {
      let ring = document.getElementById('__spot');
      if (!on) {
        ring?.remove();
        return;
      }
      const t = document.querySelector(sel);
      if (!t) return;
      if (!ring) {
        ring = document.createElement('div');
        ring.id = '__spot';
        ring.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border:2px solid #5aa7ff;border-radius:6px;box-shadow:0 0 0 4px rgba(90,167,255,.25);transition:all .2s';
        document.body.append(ring);
      }
      const r = t.getBoundingClientRect();
      Object.assign(ring.style, { left: r.left - 5 + 'px', top: r.top - 5 + 'px', width: r.width + 10 + 'px', height: r.height + 10 + 'px' });
    },
    [sel, on] satisfies [string, boolean],
  );
}

// A contact sheet: frames every 0.5 s from t for 6 s, cropped, tiled.
export function sheet(file: string, name: string, t: number, crop = '1200:750:0:0', dur = 6): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-t', String(dur), '-i', file, '-vf', `fps=2,crop=${crop},scale=400:-1,tile=4x3`, '-frames:v', '1', `${TMP}/frames/${name}.png`]);
}

// Sync marker: a tiny square in the top-left corner that flashes white.
export async function flash(page: Page, on: boolean): Promise<void> {
  await page.evaluate((on: boolean) => {
    let el = document.getElementById('__sync');
    if (!el) {
      el = document.createElement('div');
      el.id = '__sync';
      el.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;z-index:2147483647;pointer-events:none;background:#fff;display:none';
      document.body.append(el);
    }
    el.style.display = on ? 'block' : 'none';
  }, on);
}

// The video time (seconds) of the first frame where the marker is white.
export function findFlash(webm: string): number | null {
  const meta = `${TMP}/frames/flash-${path.basename(webm)}.txt`;
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', webm, '-vf', `crop=8:8:1:1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${meta}`, '-f', 'null', '-']);
  let t: number | null = null;
  for (const ln of fs.readFileSync(meta, 'utf8').split('\n')) {
    const m = ln.match(/pts_time:([\d.]+)/);
    if (m) t = parseFloat(m[1]);
    const y = ln.match(/YAVG=([\d.]+)/);
    if (y && parseFloat(y[1]) > 200) return t;
  }
  throw new Error('no flash in ' + webm);
}
