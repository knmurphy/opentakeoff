// Per-user plugin DISABLE ("eject") preference — a HOST/RUNTIME concern, kept
// deliberately OUTSIDE #167's frozen structural core (registry/context/
// descriptor/select/version/storage). loadFeaturePlugins still returns every
// structurally-activatable descriptor; this module only records which of them
// the user has switched OFF, and the RENDER-time consumers filter on it.
//
// Persistence + reactivity mirror theme.js / prefs.js exactly: a localStorage
// key `opentakeoff_<name>`, a same-tab CustomEvent, and a cross-tab `storage`
// listener; a subscribe fn returns its own unsubscribe.
//
// HONEST LIMITATION: disable ejects a plugin from ACTIVATION and RENDER (no
// launcher, no overlay, no export item). It does NOT skip the module's IMPORT —
// the feature glob resolves every thunk to learn each plugin's id, so ids are
// only known POST-import. A plugin that misbehaves purely at import-eval time is
// still contained by the loader's existing try/catch (registry.ts resolveModules
// logs + skips a throwing thunk), but its module still evaluates. A stronger
// skip-the-chunk eject (persisting ids to gate the import itself) is deferred.

const KEY = "opentakeoff_plugins_disabled";
const EVT = "opentakeoff:plugins-disabled";

// Reads are done at CALL time behind typeof-guards so this module imports
// cleanly under node (the unit test), where `localStorage`/`window` are absent
// until the test stubs them onto globalThis.
function readStore() {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // private mode / access denied — treat as no stored choice
  }
}

function writeStore(ids) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private mode — session-only, best effort */
  }
}

/** The set of disabled plugin ids. Tolerates a missing or malformed value —
 *  never throws, returns an empty set on any parse failure. */
export function getDisabledPluginIds() {
  const raw = readStore();
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === "string"));
  } catch {
    return new Set(); // malformed JSON — behave as if nothing is disabled
  }
}

/** Is this plugin id currently disabled? */
export function isPluginDisabled(id) {
  return getDisabledPluginIds().has(id);
}

/** Add or remove `id` from the disabled set, persist, then notify live UIs
 *  (same tab via CustomEvent; other tabs via the browser's own `storage`). */
export function setPluginDisabled(id, disabled) {
  const ids = getDisabledPluginIds();
  if (disabled) ids.add(id);
  else ids.delete(id);
  writeStore([...ids]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT, { detail: [...ids] }));
  }
}

/** Subscribe to disabled-set changes from this tab (CustomEvent) OR another tab
 *  (cross-tab `storage`). Returns the unsubscribe fn, so it can be a useEffect
 *  body directly. */
export function onDisabledPluginsChange(fn) {
  if (typeof window === "undefined") return () => {};
  const onEvt = () => fn(getDisabledPluginIds());
  const onStorage = (e) => {
    if (e.key === KEY) fn(getDisabledPluginIds());
  };
  window.addEventListener(EVT, onEvt);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVT, onEvt);
    window.removeEventListener("storage", onStorage);
  };
}
