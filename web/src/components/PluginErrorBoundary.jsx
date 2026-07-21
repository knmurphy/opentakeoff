// SPIKE (throwaway) — issue #166 feasibility probe. NOT the real contract.
//
// Per-slot isolation: a throwing plugin degrades to a small inline notice, it
// does NOT white-screen the canvas (or crash the 345 prod deploy). This is the
// trust boundary even for first-party private plugins.

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
    console.error(`[plugins] "${this.props.label}" crashed:`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: "absolute", left: 14, bottom: 60, zIndex: 50, maxWidth: 320,
          padding: "10px 12px", background: "var(--paper-bright)",
          border: "1px solid var(--c-danger)", boxShadow: "var(--shadow-2)",
          fontSize: 12.5, color: "var(--ink)",
        }}>
          <strong style={{ color: "var(--c-danger)" }}>Plugin “{this.props.label}” failed</strong>
          <div style={{ color: "var(--ink-muted)", marginTop: 4 }}>{String(this.state.error?.message || this.state.error)}</div>
          {this.props.onClose && (
            <button type="button" onClick={this.props.onClose} style={{ marginTop: 8, padding: "4px 10px", border: "1px solid var(--ink-faint)", background: "var(--paper-bright)", cursor: "pointer", fontSize: 12 }}>Dismiss</button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
