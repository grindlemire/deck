/* ============================================================
 * deck / browser.ts
 * The deck's browser code (engine.ts, lint.ts, story.ts,
 * dev-client.ts) is TypeScript. browserScript strips the types
 * with Bun's own transpiler, no dependencies, for build.ts,
 * dev.ts and check.ts. Comments go with the types, so a built
 * deck's script is readable but uncommented.
 * ============================================================ */
import { readFileSync } from "node:fs";

const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });

export const browserScript = (file: string): string => {
  const src = readFileSync(file, "utf8");
  return file.endsWith(".ts") ? transpiler.transformSync(src) : src;
};
