/* eslint-disable @typescript-eslint/no-require-imports */
// Next.js `output: "standalone"` produces a minimal server bundle but does NOT
// copy the `.next/static` and `public` directories next to it. When we run the
// server directly (from Electron or from a portable folder) we need those
// assets alongside `server.js`. This script mirrors them so the standalone
// server can be launched from any location.
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");

if (!fs.existsSync(standaloneDir)) {
  console.log("[copy-standalone] .next/standalone not found — skipping.");
  process.exit(0);
}

function copyRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

// .next/static -> .next/standalone/.next/static
copyRecursive(
  path.join(root, ".next", "static"),
  path.join(standaloneDir, ".next", "static"),
);

// public -> .next/standalone/public
copyRecursive(path.join(root, "public"), path.join(standaloneDir, "public"));

console.log("[copy-standalone] static + public copied ✓");
