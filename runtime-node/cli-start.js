#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const tsxDir = path.dirname(require.resolve("tsx/package.json"));
const tsxPath = path.join(tsxDir, "dist", "cli.mjs");
const cliPath = fileURLToPath(new URL("./cli-start.ts", import.meta.url));

const child = spawn(process.execPath, [tsxPath, cliPath, ...process.argv.slice(2)], {
  stdio: "inherit"
});
child.on("exit", (code) => process.exit(code ?? 0));
