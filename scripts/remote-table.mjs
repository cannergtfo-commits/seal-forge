import http from "node:http";
import https from "node:https";

const ORIGIN = process.env.SEAL_FORGE_ORIGIN || "https://play.blazarforce.net";

export function remoteTablePlugin() {
  let online = false;
  let checked = 0;
  return {
    name: "seal-forge-remote-table",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url || "";
        const path = raw.split("?")[0];
        if (!path.startsWith("/api/veilforge")) return next();
        const now = Date.now();
        if (now - checked > 15000) {
          checked = now;
          try {
            const probe = await fetch(ORIGIN + "/api/veilforge/health", { signal: AbortSignal.timeout(2500) });
            online = probe.ok;
          } catch {
            online = false;
          }
          console.log(online ? `[seal-forge] table ${ORIGIN}` : "[seal-forge] node box offline, using this machine");
        }
        if (!online) return next();
        const target = new URL(raw, ORIGIN);
        const lib = target.protocol === "https:" ? https : http;
        const headers = { ...req.headers, host: target.host };
        delete headers.connection;
        const proxy = lib.request(target, { method: req.method, headers }, (upstream) => {
          res.writeHead(upstream.statusCode || 502, upstream.headers);
          upstream.pipe(res);
        });
        proxy.on("error", () => {
          online = false;
          if (!res.headersSent) next();
          else res.end();
        });
        req.pipe(proxy);
      });
    },
  };
}
