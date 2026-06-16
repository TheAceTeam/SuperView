import { startProdServer } from "./prod-server.js";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const dataDirArg = process.argv.find((arg) => arg.startsWith("--data-dir="));

if (portArg) process.env.SUPERVIEW_PORT = portArg.split("=")[1];
if (dataDirArg) process.env.SUPERVIEW_DATA_DIR = dataDirArg.split("=")[1];

startProdServer();
