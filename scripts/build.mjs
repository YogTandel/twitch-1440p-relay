#!/usr/bin/env node
// ============================================================
// Package the extension for every supported browser engine.
// ============================================================
// Chrome/Chromium (Chrome, Edge, Brave, Opera, Vivaldi) and Firefox
// (Firefox, Zen, LibreWolf, Waterfox) share the same source. The only
// manifest difference is the background: Chromium needs a service
// worker, Firefox needs an event page. Firefox also needs a stable
// gecko ID, and supports content_scripts world "MAIN" since 128.
//
//   npm run build           both packages
//   npm run build:chrome    dist/twitch-1440p-relay-chrome-<v>.zip
//   npm run build:firefox   dist/twitch-1440p-relay-firefox-<v>.xpi
// ============================================================

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "extension");
const DIST = join(ROOT, "dist");
const GECKO_ID = "twitch-1440p-relay@smaknomercy.github.io";
const MIN_FIREFOX = "140.0"; // data_collection_permissions support; world: "MAIN" needs 128

export const chromeManifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));

// ---- Manifests ----

export function firefoxManifest(chrome = chromeManifest) {
    const manifest = structuredClone(chrome);

    // Firefox MV3 uses an event page. config.js loads before background.js,
    // replacing the importScripts() call Chrome uses in its service worker.
    manifest.background = { scripts: ["config.js", "background.js"] };

    manifest.browser_specific_settings = {
        gecko: {
            id: GECKO_ID,
            strict_min_version: MIN_FIREFOX,
            // AMO requires this declaration. The relay receives the viewer's
            // Twitch token and the usher URL, but stores neither.
            data_collection_permissions: {
                required: ["authenticationInfo", "websiteActivity"],
            },
        },
        gecko_android: {
            // data_collection_permissions support starts here on Android.
            strict_min_version: "142.0",
        },
    };

    return manifest;
}

// ---- Files ----

function listFiles(dir, base = dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
        else out.push({ full, path: relative(base, full).split("\\").join("/") });
    }
    return out;
}

// ---- Minimal ZIP writer (store/deflate), deterministic timestamps ----

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function zip(entries) {
    const local = [];
    const central = [];
    let offset = 0;

    for (const { path, data } of entries) {
        const name = Buffer.from(path, "utf8");
        const crc = crc32(data);
        const deflated = deflateRawSync(data);
        const method = deflated.length < data.length ? 8 : 0;
        const body = method === 8 ? deflated : data;

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4); // version needed
        localHeader.writeUInt16LE(0x0800, 6); // UTF-8 names
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(0, 10); // time
        localHeader.writeUInt16LE(0x0021, 12); // 1980-01-01
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(body.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(name.length, 26);
        localHeader.writeUInt16LE(0, 28);
        local.push(localHeader, name, body);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4); // version made by
        centralHeader.writeUInt16LE(20, 6); // version needed
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(method, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0x0021, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(body.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(name.length, 28);
        centralHeader.writeUInt16LE(0, 30); // extra
        centralHeader.writeUInt16LE(0, 32); // comment
        centralHeader.writeUInt16LE(0, 34); // disk
        centralHeader.writeUInt16LE(0, 36); // internal attrs
        centralHeader.writeUInt32LE(0, 38); // external attrs
        centralHeader.writeUInt32LE(offset, 42);
        central.push(centralHeader, name);

        offset += localHeader.length + name.length + body.length;
    }

    const centralSize = central.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...local, ...central, end]);
}

// ---- Build ----

function stage(extensionFiles, outDir, name, manifest) {
    const dir = join(outDir, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    for (const file of extensionFiles) {
        const target = join(dir, file.path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(file.full, target);
    }
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return dir;
}

function packageFiles(extensionFiles, outDir, name, manifest, ext) {
    const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
    const dir = stage(extensionFiles, outDir, name, manifest);
    const entries = [
        { path: "manifest.json", data: Buffer.from(manifestJson) },
        ...extensionFiles
            .filter((f) => f.path !== "manifest.json")
            .map((f) => ({ path: f.path, data: readFileSync(f.full) })),
    ];
    const file = join(outDir, `twitch-1440p-relay-${name}-${manifest.version}.${ext}`);
    writeFileSync(file, zip(entries));
    return { dir, file, fileCount: entries.length, manifest };
}

export function buildChrome({ outDir = DIST } = {}) {
    const files = listFiles(EXT);
    return packageFiles(files, outDir, "chrome", chromeManifest, "zip");
}

export function buildFirefox({ outDir = DIST } = {}) {
    const files = listFiles(EXT);
    const out = packageFiles(files, outDir, "firefox", firefoxManifest(), "xpi");
    // Same bytes with a .zip name: easier to unzip for `about:debugging`,
    // while the .xpi is what Firefox/Zen installs.
    const zip = out.file.replace(/\.xpi$/, ".zip");
    copyFileSync(out.file, zip);
    return { ...out, zip };
}

export function buildAll({ outDir = DIST } = {}) {
    return { chrome: buildChrome({ outDir }), firefox: buildFirefox({ outDir }) };
}

const TARGETS = { chrome: buildChrome, firefox: buildFirefox, all: buildAll };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const target = process.argv[2] || "all";
    const build = TARGETS[target];
    if (!build) {
        console.error(`Unknown target "${target}". Use: ${Object.keys(TARGETS).join(", ")}`);
        process.exit(2);
    }
    const result = build();
    const outputs = target === "all" ? Object.entries(result) : [[target, result]];
    for (const [name, out] of outputs) {
        console.log(`${name} ${out.manifest.version}: ${out.fileCount} files`);
        console.log(`  unpacked: ${out.dir}`);
        console.log(`  package:  ${out.file}`);
        if (out.zip) console.log(`  package:  ${out.zip}`);
    }
}
