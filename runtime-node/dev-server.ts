import { createServer } from "./server.js";

const port = Number(process.env.SUPERVIEW_API_PORT ?? 5174);
createServer().listen(port, "127.0.0.1", () => {
  console.log(`SuperView API listening on http://127.0.0.1:${port}`);
});
