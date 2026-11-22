import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChrome, buildFirefox, firefoxManifest } from "../scripts/build.mjs";

const chromeManifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("Firefox manifest uses an event page instead of a service worker", () => {
    const manifest = firefoxManifest(chromeManifest);
    assert.deepEqual(manifest.background, { scripts: ["config.js", "background.js"] });
    assert.equal("service_worker" in manifest.background, false);
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "140.0");
    assert.match(manifest.browser_specific_settings.gecko.id, /@/);
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, {
        required: ["authenticationInfo", "websiteActivity"],
    });
});

test("Firefox manifest keeps the MAIN-world hook", () => {
    const manifest = firefoxManifest(chromeManifest);
    const main = manifest.content_scripts.find((cs) => cs.world === "MAIN");
    assert.ok(main, "a MAIN world content script is required to patch the page");
    assert.deepEqual(main.js, ["hook.js"]);
    assert.equal(main.run_at, "document_start");
});

test("Chromium package keeps the MV3 service worker manifest", () => {
    const out = mkdtempSync(join(tmpdir(), "tw2k-chrome-"));
    try {
        const { dir, file, manifest } = buildChrome({ outDir: out });
        const written = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
        assert.deepEqual(written, chromeManifest);
        assert.deepEqual(manifest.background, { service_worker: "background.js" });

        const bytes = readFileSync(file);
        assert.equal(bytes.readUInt32LE(0), 0x04034b50);
        assert.ok(bytes.includes(Buffer.from("manifest.json")));
        assert.ok(file.endsWith(`twitch-1440p-relay-chrome-${chromeManifest.version}.zip`), file);
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
});

test("build produces an unpacked Firefox extension and XPI", () => {
    const out = mkdtempSync(join(tmpdir(), "tw2k-firefox-"));
    try {
        const { dir, file, zip, fileCount, manifest } = buildFirefox({ outDir: out });

        assert.equal(manifest.version, chromeManifest.version);
        assert.ok(existsSync(join(dir, "manifest.json")));
        for (const name of ["background.js", "bridge.js", "config.js", "hook.js", "popup.html", "popup.js"]) {
            assert.ok(existsSync(join(dir, name)), name);
        }

        const written = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
        assert.deepEqual(written.background, manifest.background);

        // A valid ZIP starts with a local file header; the manifest is the first entry.
        const bytes = readFileSync(file);
        assert.equal(bytes.readUInt32LE(0), 0x04034b50);
        assert.ok(bytes.includes(Buffer.from("manifest.json")), "XPI contains manifest.json");
        assert.match(file, /\.xpi$/);
        assert.match(zip, /\.zip$/);
        assert.deepEqual(readFileSync(zip), bytes, "ZIP and XPI carry the same Firefox package");
        assert.equal(fileCount, 12); // manifest + 7 extension files + 4 icons
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
});
