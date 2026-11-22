#!/usr/bin/env node
// Syntax-check every shipped script. Works on Windows and POSIX.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [];

for (const dir of ["extension", "relay", "scripts"]) {
    for (const name of readdirSync(join(ROOT, dir))) {
        if (/\.(?:js|mjs)$/.test(name)) files.push(join(ROOT, dir, name));
    }
}

for (const file of files) {
    execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

console.log(`Checked ${files.length} files.`);
