// Lets `node --test` run the game's TypeScript sources directly.
// Resolves extensionless relative imports and the `@/` alias to `.ts` / `.tsx` files.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

registerHooks({
  resolve(specifier, context, next) {
    let base = null;
    if (specifier.startsWith("@/")) base = path.join(src, specifier.slice(2));
    else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:")
    ) {
      base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base && !path.extname(base)) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
      }
    }
    if (base && specifier.startsWith("@/")) return next(pathToFileURL(base).href, context);
    return next(specifier, context);
  },
});
