import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("data/profile-backups", { recursive: true });
try {
  if (statSync(".pglite").isDirectory()) {
    cpSync(".pglite", `data/profile-backups/pglite-${stamp}`, { recursive: true });
    console.log("copied profile database", stamp);
  }
} catch {
  console.log("no profile database to copy yet");
}
const copies = readdirSync("data/profile-backups").filter((name) => name.startsWith("pglite-")).sort();
for (const name of copies.slice(0, Math.max(0, copies.length - 5))) {
  rmSync(`data/profile-backups/${name}`, { recursive: true, force: true });
}
