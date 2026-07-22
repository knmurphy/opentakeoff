// Per-slot plugin isolation. A feature plugin is third-party code (even a
// first-party private one is loaded through the same seam), so a throw in its
// render must NOT white-screen the canvas — it degrades to a small inline
// "feature missing" notice and the rest of the app keeps running.
//
// React error boundaries catch RENDER-PHASE throws only (render + the commit-
// phase lifecycles + constructors of descendants). They do NOT catch throws in
// event handlers or in async work scheduled from a useEffect — React has no way
// to associate those with a subtree. Such a throw is NOT swallowed: it escapes
// as an uncaught error that React logs and isolates to that one handler, so the
// app survives, but this boundary shows NO "unavailable" notice for it (there is
// no render to intercept). Surfacing action-time plugin faults to the user would
// need a host-level error channel — a deliberate follow-up, not attempted here.
// A well-behaved plugin should guard its own onClick/async handlers.

import React from "react";

export default class PluginErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Logged, never swallowed — the "skip a broken plugin" path stays visible.
    console.error(`[plugins] "${this.props.label}" crashed during render:`, error, info);
  }

  render() {
    if (this.state.error) {
      const detail = String(this.state.error?.message || this.state.error);
      return (
        <div
          role="alert"
          style={{
            // Relative content — the host positions the panel slot (Option A).
            width: "100%", boxSizing: "border-box",
            padding: "10px 12px", background: "var(--paper-bright)",
            border: "1px solid var(--c-danger)", boxShadow: "var(--shadow-2)",
            fontSize: 12.5, color: "var(--ink)",
          }}
        >
          <strong style={{ color: "var(--c-danger)" }}>
            Plugin “{this.props.label}” unavailable
          </strong>
          <div style={{ color: "var(--ink-muted)", marginTop: 4 }}>{detail}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            {this.props.onClose && (
              <button
                type="button"
                onClick={this.props.onClose}
                style={{
                  padding: "4px 10px", border: "1px solid var(--ink-faint)",
                  background: "var(--paper-bright)", cursor: "pointer", fontSize: 12,
                }}
              >
                Dismiss
              </button>
            )}
            {/* Quick-eject: a render-crashed plugin can be turned off for good.
                The host filters on the disabled set, so the crashed slot
                disappears on the re-render and stays gone across reloads. */}
            {this.props.onDisable && (
              <button
                type="button"
                onClick={this.props.onDisable}
                style={{
                  padding: "4px 10px", border: "1px solid var(--c-danger)",
                  background: "var(--paper-bright)", color: "var(--c-danger)",
                  cursor: "pointer", fontSize: 12,
                }}
              >
                Disable plugin
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
