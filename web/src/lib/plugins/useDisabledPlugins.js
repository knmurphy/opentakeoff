// Reactive read of the per-user disabled-plugin set. Both render-time consumers
// (PluginOverlayHost, TakeoffCanvas's export filter) use this hook so the
// subscribe/unsubscribe wiring lives in exactly one place. Returns the current
// Set<string> and re-renders when the set changes (this tab or another).

import { useEffect, useState } from "react";
import { getDisabledPluginIds, onDisabledPluginsChange } from "./pluginPrefs.js";

export function useDisabledPluginIds() {
  const [disabled, setDisabled] = useState(getDisabledPluginIds);
  useEffect(() => onDisabledPluginsChange(setDisabled), []);
  return disabled;
}
