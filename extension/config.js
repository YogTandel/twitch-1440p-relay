// ============================================================
// Twitch 1440p Relay — shared settings helpers
// ============================================================
// Loaded by the popup, the background page/service worker and the
// bridge content script. Settings live in storage.local:
//   enabled  — boolean
//   relayUrl — Worker URL without the key
//   relayKey — RELAY_KEY value
//
// Firefox/Zen expose promise-based browser.*; Chrome exposes
// chrome.*. Prefer browser.* and fall back to chrome.*.
// ============================================================

const TW2K = {
    api: globalThis.browser ?? globalThis.chrome,

    // Split "https://x.workers.dev/?key=abc" into URL and key.
    splitUrl(raw) {
        const text = (raw || "").trim();
        try {
            const u = new URL(text);
            const key = u.searchParams.get("key") || "";
            u.searchParams.delete("key");
            u.hash = "";
            let url = u.href;
            if (url.endsWith("?")) url = url.slice(0, -1);
            return { url, key };
        } catch {
            return { url: text, key: "" };
        }
    },

    // Full request URL for the relay, with the key and optional extra params.
    buildUrl(relayUrl, relayKey, extra = {}) {
        const u = new URL(relayUrl);
        if (relayKey) u.searchParams.set("key", relayKey);
        for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
        return u.href;
    },

    async load() {
        const api = TW2K.api;
        const d = await api.storage.local.get(["enabled", "relayUrl", "relayKey", "proxyUrl"]);

        // Migrate v3.1 settings: a single proxyUrl with ?key= in it.
        if (d.proxyUrl && !d.relayUrl) {
            const { url, key } = TW2K.splitUrl(d.proxyUrl);
            d.relayUrl = url;
            d.relayKey = d.relayKey || key;
            await api.storage.local.set({ relayUrl: d.relayUrl, relayKey: d.relayKey });
            await api.storage.local.remove("proxyUrl");
        }

        return {
            enabled: !!d.enabled,
            relayUrl: d.relayUrl || "",
            relayKey: d.relayKey || "",
        };
    },
};
