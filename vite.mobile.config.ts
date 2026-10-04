import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "classic-script",
      apply: "build",
      transformIndexHtml(html: string) {
        return html.replaceAll(' type="module"', "").replaceAll(" crossorigin", "");
      },
    },
  ],
  resolve: { tsconfigPaths: true },
  base: "./",
  build: {
    outDir: "mobile/www",
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: "mobile/index.html",
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "assets/game.js",
      },
    },
  },
});
