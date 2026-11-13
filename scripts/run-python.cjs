#!/usr/bin/env node
// Use the activated venv when present; otherwise prefer the platform's Python launcher.
const { spawnSync } = require("node:child_process");
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const result = spawnSync(python, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(`Could not start ${python}. Install Python or set PYTHON to your interpreter.`);
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
