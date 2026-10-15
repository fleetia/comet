import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";

export default defineConfig({
  plugins: [react(), vanillaExtractPlugin()],
  test: {
    environment: "jsdom",
    include: ["ds/**/*.test.{ts,tsx,mjs}"],
    restoreMocks: true,
    maxWorkers: 2,
  },
});
