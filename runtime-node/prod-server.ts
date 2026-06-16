import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiDist = path.resolve(__dirname, "..", "dist", "ui");

const app = createServer();

app.use(express.static(uiDist, { index: "index.html" }));

// SPA fallback — serve index.html for any non-API, non-file route
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.includes(".")) return next();
  res.sendFile(path.join(uiDist, "index.html"));
});

export function startProdServer(port?: number) {
  const p = port ?? Number(process.env.SUPERVIEW_PORT ?? 5174);
  return app.listen(p, "0.0.0.0", () => {
    console.log(`SuperView running at http://127.0.0.1:${p}`);
  });
}
