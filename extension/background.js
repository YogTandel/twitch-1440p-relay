// ============================================================
// Twitch 1440p Relay — background page (Firefox) / service worker (Chrome)
// ============================================================
// Toolbar badge: "ON" globally when enabled; per tab it shows the
// quality Twitch granted on the last stream ("2K", "1080", "ERR").
// ============================================================

// Chrome loads config.js with importScripts; Firefox maps it in background.scripts.
if (typeof importScripts === "function") importScripts("config.js");

const api = TW2K.api;
const TWITCH_ORIGINS = ["https://www.twitch.tv/*"];

async function refreshBadge() {
    const { enabled } = await TW2K.load();
    // Firefox/Zen make host permissions optional; without it no content
    // script runs, so "ON" would be a lie.
    const granted = await api.permissions.contains({ origins: TWITCH_ORIGINS }).catch(() => true);
    api.action.setBadgeText({ text: !granted ? "!" : enabled ? "ON" : "" });
    api.action.setBadgeBackgroundColor({ color: !granted ? "#E6A700" : "#9147FF" });
}

api.runtime.onInstalled.addListener(refreshBadge);
api.runtime.onStartup.addListener(refreshBadge);
api.permissions.onAdded?.addListener(refreshBadge);
api.permissions.onRemoved?.addListener(refreshBadge);

api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "enabled" in changes) refreshBadge();
});

// ---- Per-tab status from bridge.js ----

const RES_BADGE = { ULTRA_HD: "4K", QUAD_HD: "2K", FULL_HD: "1080" };

function heightBadge(h) {
    if (h >= 2160) return "4K";
    if (h >= 1440) return "2K";
    return String(h);
}

api.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.action !== "status" || !sender.tab?.id) return;
    const tabId = sender.tab.id;

    let text, color, title;
    if (!msg.ok) {
        text = "ERR";
        color = "#F55";
        title = `Twitch 1440p Relay: ${msg.error || "relay error"} — playing without the relay`;
    } else {
        const unlocked = ["QUAD_HD", "ULTRA_HD"].includes(msg.maxRes);
        const allowed = RES_BADGE[msg.maxRes] || "?";
        if (unlocked) {
            // Show what this stream actually offers, not just what Twitch allows.
            text = msg.height ? heightBadge(msg.height) : allowed;
            color = "#00A86B";
            title = msg.height
                ? `Twitch 1440p Relay: stream up to ${msg.height}p (Twitch allows up to ${allowed})`
                : `Twitch 1440p Relay: up to ${allowed} unlocked`;
        } else {
            const reasons = [...new Set(Object.values(msg.reasons || {}).flat())].join(", ");
            text = allowed;
            color = "#E6A700";
            title = `Twitch 1440p Relay: limited to ${allowed}${reasons ? ` (${reasons})` : ""}`;
        }
    }

    api.action.setBadgeText({ tabId, text });
    api.action.setBadgeBackgroundColor({ tabId, color });
    api.action.setTitle({ tabId, title });
});
