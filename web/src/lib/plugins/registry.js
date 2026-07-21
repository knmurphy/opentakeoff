// SPIKE (throwaway) — issue #166 feasibility probe. NOT the real contract.
//
// In-tree feature registry. Each feature is a folder under src/features/<name>/
// exporting a default descriptor from plugin.{js,jsx}. This is the fork/private
// composition path: a downstream fork (345-Flooring) drops feature folders in,
// public core ships none, and each `git merge public/main` never touches them.
//
// LAZY glob (default, NOT { eager: true }) — each feature resolves to its own
// async chunk, so an opted-out build never loads plugin code into the anonymous
// entry bundle (Axis A). Community packages would register via an explicit
// import barrel using the SAME descriptor shape; both paths funnel here.

const modules = import.meta.glob("../../features/*/plugin.{js,jsx}");

/** Load every in-tree feature descriptor. Never throws — a broken plugin is
 *  logged and skipped so it can't take down the app at load time. */
export async function loadFeaturePlugins() {
  const out = [];
  for (const path in modules) {
    try {
      const mod = await modules[path]();
      const desc = mod && mod.default;
      if (desc && desc.id) out.push(desc);
      else console.warn("[plugins] no default descriptor:", path);
    } catch (e) {
      console.error("[plugins] failed to load", path, e);
    }
  }
  return out;
}
