// Static production build for Vercel (or any static host): bundle the client and
// emit dist/index.html pointing at the bundle. The /node proxy is provided by the
// host's rewrites in production, so no server ships with the build.

import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

const result = await Bun.build({
  entrypoints: ["src/client/main.ts"],
  outdir: "dist",
  naming: "main.js",
  minify: true,
  target: "browser",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const shell = await Bun.file("public/index.html").text();
await Bun.write("dist/index.html", shell.replace("../src/client/main.ts", "./main.js"));
console.log("built dist/ (index.html + main.js)");
