import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts", migrate: "src/db/migrate.ts", admin: "src/admin.ts" },
  format: "esm",
  target: "node20",
  platform: "node",
  // The shared package ships TypeScript source, so bundle it into the API build.
  noExternal: ["@lightbulb/shared"],
  clean: true,
  sourcemap: true,
});
