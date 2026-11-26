import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Le VPS (ARM, mise à jour en parallèle du build) est ~20 fois plus lent que le poste de dev :
    // le délai par défaut de 10 s faisait échouer les beforeAll qui importent les modules du bot,
    // et la mise à jour était annulée. Délais larges : un vrai blocage échoue toujours.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
