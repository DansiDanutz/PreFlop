import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
export function localDatabase(filename = ":memory:") {
  const sql = new DatabaseSync(filename);
  sql.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  sql.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)");
  for (const name of readdirSync(new URL("../../drizzle/", import.meta.url))
    .filter((s) => s.endsWith(".sql"))
    .sort()) {
    if (sql.prepare("SELECT name FROM _migrations WHERE name=?").get(name))
      continue;
    sql.exec("BEGIN");
    try {
      sql.exec(
        readFileSync(new URL("../../drizzle/" + name, import.meta.url), "utf8"),
      );
      sql.prepare("INSERT INTO _migrations VALUES (?)").run(name);
      sql.exec("COMMIT");
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  }
  const wrap = (query, values = []) => ({
    bind(...args) {
      return wrap(query, args);
    },
    async first() {
      return sql.prepare(query).get(...values) || null;
    },
    async all() {
      return { results: sql.prepare(query).all(...values) };
    },
    async run() {
      const r = sql.prepare(query).run(...values);
      return { meta: { changes: Number(r.changes) } };
    },
    execute() {
      const r = sql.prepare(query).run(...values);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: wrap,
    async batch(statements) {
      sql.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map((s) => s.execute());
        sql.exec("COMMIT");
        return result;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      sql.close();
    },
    sql,
  };
}
