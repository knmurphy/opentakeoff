// Per-slot plugin isolation. A feature plugin is third-party code (even a
// first-party private one is loaded through the same seam), so a throw in its
// render must NOT white-screen the canvas — it degrades to a small inline
// "feature missing" notice and the rest of the app keeps running.
//
// React error boundaries catch RENDER-PHASE throws only (render + the commit-
// phase lifecycles + constructors of descendants). They do NOT catch throws in
// event handlers or in async work scheduled from a useEffect — React has no
// way to associate those with a subtree, so they surface as normal rejections.
// This boundary contains what is structurally containable and is honest about
// the rest; a plugin's onClick/async faults are its own to handle.

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
            position: "absolute", left: 14, bottom: 60, zIndex: 50, maxWidth: 320,
            padding: "10px 12px", background: "var(--paper-bright)",
            border: "1px solid var(--c-danger)", boxShadow: "var(--shadow-2)",
            fontSize: 12.5, color: "var(--ink)",
          }}
        >
          <strong style={{ color: "var(--c-danger)" }}>
            Plugin “{this.props.label}” unavailable
          </strong>
          <div style={{ color: "var(--ink-muted)", marginTop: 4 }}>{detail}</div>
          {this.props.onClose && (
            <button
              type="button"
              onClick={this.props.onClose}
              style={{
                marginTop: 8, padding: "4px 10px", border: "1px solid var(--ink-faint)",
                background: "var(--paper-bright)", cursor: "pointer", fontSize: 12,
              }}
            >
              Dismiss
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
