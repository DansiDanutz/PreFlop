import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { createWorker } from "../worker.mjs";
import { localDatabase } from "./sqlite.mjs";
mkdirSync(new URL("../../.local/", import.meta.url), { recursive: true });
const db = localDatabase(
  new URL("../../.local/practice.sqlite", import.meta.url).pathname,
);
const types = {
  "index.html": "text/html",
  "app.js": "text/javascript",
  "styles.css": "text/css",
  "icon.svg": "image/svg+xml",
  "manifest.webmanifest": "application/manifest+json",
};
const port = Number(process.env.PORT || 4173);
createServer(async (req, res) => {
  try {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 8192) {
        res.writeHead(413);
        res.end("Request too large");
        return;
      }
      chunks.push(chunk);
    }
    const assets = Object.fromEntries(
      Object.entries(types).map(([file, type]) => [
        "/" + file,
        {
          body: readFileSync(new URL("../" + file, import.meta.url), "utf8"),
          type: type + "; charset=utf-8",
        },
      ]),
    );
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    const response = await createWorker(assets).fetch(request, { DB: db });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e.message);
    res.writeHead(500);
    res.end("Local server error");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`PreFlop practice: http://127.0.0.1:${port}`),
);
