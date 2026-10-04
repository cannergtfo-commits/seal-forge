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
      transformIndexHtml: {
        order: "post",
        handler(html: string) {
          return html
            .replaceAll(' type="module"', "")
            .replaceAll(" crossorigin", "")
            .replace(/<script src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>');
        },
      },
      generateBundle(_options, bundle) {
        for (const item of Object.values(bundle)) {
          if (item.type !== "asset" || typeof item.source !== "string" || !item.fileName.endsWith(".css")) continue;
          item.source = item.source.replaceAll('url("/assets/', 'url("./').replaceAll("url('/assets/", "url('./").replaceAll("url(/assets/", "url(./");
        }
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
