#!/usr/bin/env node
/**
 * Gera src/build-info.json com o SHA atual e timestamp do build.
 * Rodado pelo script "prebuild" do package.json. Em dev (sem build), o
 * fallback em src/lib/buildInfo.ts devolve sha="dev".
 */
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function safeExec(cmd) {
  try {
    return cp.execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const sha = safeExec("git rev-parse --short HEAD") || "unknown";
const branch = safeExec("git rev-parse --abbrev-ref HEAD") || "unknown";
const builtAt = new Date().toISOString();
const data = { sha, branch, builtAt };

const target = path.join(__dirname, "..", "src", "build-info.json");
fs.writeFileSync(target, JSON.stringify(data, null, 2) + "\n");
console.log(`[build-info] ${branch}@${sha} (${builtAt})`);
