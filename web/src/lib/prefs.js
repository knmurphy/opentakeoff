// Per-browser preferences (localStorage), mirroring the opentakeoff_dark /
// opentakeoff_panel pattern. Cloud sync is OPT-IN and default OFF — flag-off
// reproduces today's behavior byte-for-byte (ProjectGate builds the legacy
// Drive-canonical store; nothing local-first is wired). Slice 6 adds the Settings
// UI that flips this and a status line; here we only read/write the flag.
//
// No cloud vocabulary or imports — this is a plain browser-pref helper so the
// gating decision stays cheap and synchronous (never blocks a mount on network).

const CLOUD_SYNC_KEY = "opentakeoff_cloud_sync";

/** True when this browser has opted into local-first + optional Drive sync. */
export function cloudSyncOptedIn() {
  try {
    return localStorage.getItem(CLOUD_SYNC_KEY) === "1";
  } catch {
    return false; // private mode / storage disabled → treat as not opted in
  }
}

/** Enable/disable the opt-in for this browser. Slice 6's Settings toggle calls this. */
export function setCloudSyncOptedIn(on) {
  try {
    if (on) localStorage.setItem(CLOUD_SYNC_KEY, "1");
    else localStorage.removeItem(CLOUD_SYNC_KEY);
  } catch {
    /* storage unavailable → the flag simply stays off */
  }
}
