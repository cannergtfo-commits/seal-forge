/** Test helper: an in-memory PGLite with every migrations/*.sql applied, wrapped in the app's Sql surface. */
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db";

export async function memoryDb(): Promise<{ sql: Sql; close: () => Promise<void> }> {
  const pg = new PGlite({ parsers: { 20: Number } });
  await pg.waitReady;
  const dir = new URL("../../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(new URL(name, dir), "utf8"));
  }
  const run = async <T>(text: string, params: unknown[]) => (await pg.query<T>(text, params)).rows;
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0]!;
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T>(text: string, params: unknown[] = []) => run<T>(text, params);
  return { sql, close: () => pg.close() };
}
