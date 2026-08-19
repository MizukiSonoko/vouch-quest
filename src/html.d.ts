// Bun bundles HTML imports (used by server.ts to serve the game shell).
declare module "*.html" {
  const html: import("bun").HTMLBundle;
  export default html;
}
