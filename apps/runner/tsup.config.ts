import { defineConfig } from "tsup";

export default defineConfig({
  entry: { lightbulb: "src/cli.ts" },
  // One self-contained CommonJS file, so the server can hand it out and `node lightbulb.cjs` just works.
  format: "cjs",
  outExtension: () => ({ js: ".cjs" }),
  target: "node20",
  platform: "node",
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
});
