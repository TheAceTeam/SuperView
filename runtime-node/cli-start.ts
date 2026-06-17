import path from "node:path";
import { startProdServer } from "./prod-server.js";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const dataDirArg = process.argv.find((arg) => arg.startsWith("--data-dir="));
const projectDirArg = process.argv.find((arg) => arg.startsWith("--project-dir="));

if (portArg) process.env.SUPERVIEW_PORT = portArg.split("=")[1];
if (dataDirArg) process.env.SUPERVIEW_DATA_DIR = dataDirArg.split("=")[1];

const rawProjectDir = projectDirArg
  ? projectDirArg.split("=")[1]
  : process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2]
    : undefined;

const projectDir = rawProjectDir
  ? path.resolve(process.cwd(), rawProjectDir)
  : undefined;

startProdServer({ projectDir });
