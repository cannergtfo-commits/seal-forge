import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  base: "./",
  build: {
    outDir: "mobile/www",
    emptyOutDir: true,
    rollupOptions: {
      input: "mobile/index.html",
    },
  },
});
