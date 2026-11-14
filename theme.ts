/* ============================================================
 * deck / theme.ts
 * deck theme: start a theme of your own, from one that exists.
 *
 *   bun deck theme <name> [--from paper]
 *
 * Copies the theme (its theme.css, fonts, CATALOG.md and starter
 * deck) into the talks folder's themes/<name>/, where new, dev, check
 * and publish find it: bun deck new my-talk --theme <name>. A
 * theme there with a built-in's name replaces the built-in. The
 * contract a theme follows is deck/THEMES.md.
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fail, findTheme, listThemes, parseArgs, talksRoot } from "./args.ts";

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv, ["from"]);
  const name = args.positional[0];
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) fail("usage: bun deck theme <name> [--from paper]  (name: lowercase letters, digits, dashes)");
  const from = args.opt("from") ?? "paper";
  const src = findTheme(from) ?? fail(`no theme "${from}"; the themes are ${listThemes().join(", ")}`);
  const dest = path.join(talksRoot(), "themes", name);
  if (fs.existsSync(dest)) fail(`${path.relative(process.cwd(), dest)} already exists; not overwriting`);

  fs.cpSync(src, dest, { recursive: true });
  // Name the copy in its own docs and header comment.
  for (const file of ["CATALOG.md", "theme.css"]) {
    const p = path.join(dest, file);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, text.replace(`# The ${from} theme`, `# The ${name} theme`).replace(`themes / ${from} /`, `themes / ${name} /`));
  }

  const rel = path.relative(process.cwd(), dest) || ".";
  console.log(`created ${rel}, a copy of ${from}

next:
  1. change ${rel}/theme.css: the tokens first (colors, fonts, motion),
     then the components; THEMES.md in deck lists every token
  2. bun deck new try-${name} --theme ${name}
  3. bun deck dev try-${name}             # see it, t for the other mode
  4. bun deck check try-${name}           # contrast, sizes, overflow in both modes
  5. keep ${rel}/CATALOG.md and template/ in step with what you change`);
}
