// Drive-backed store adapter — the same seam as localStore (store.js), but for
// one project's Google Drive folder.
//
// This implements the exact interface the takeoff canvas already talks to, so
// swapping `store` for a cloudStore turns on team storage with no canvas
// changes. Scope is a single Drive folder (`folderId`): the plan PDFs and the
// annotations JSON for one project live as files inside it.
//
// Deliberate split: PROJECT files (PDFs, annotations.json) go to Drive, but the
// BROWSER-GLOBAL, cross-project assets — condition templates, the material and
// stamp libraries, and local snapshots — DELEGATE to localStore unchanged.
// Those aren't project-scoped, and Drive-backed versioning of them is a planned
// follow-up; keeping them local now matches the rollout plan and avoids
// entangling per-project cloud state with browser-wide libraries.

import { localStore, ANN_SCHEMA, emptyAnnotations } from "./store.js";

const PDF_MIME = "application/pdf";
const ANN_NAME = "annotations.json";

/**
 * @param {string} folderId               the project's Drive folder
 * @param {ReturnType<import('./google/drive.js').createDrive>} drive
 * @param {{ local?: typeof localStore }} [opts]  inject localStore for tests
 */
export function createCloudStore(folderId, drive, { local = localStore } = {}) {
  // Memoized promise that resolves the single annotations.json file id — locate
  // an existing file, else create one exactly once. Shared by load and save so
  // that concurrent autosaves on a brand-new project can't each take the "create"
  // branch and spawn duplicate annotations.json files (a later load would then
  // pick one arbitrarily and lose the other's edits). A failed locate/create is
  // not cached, so the next call retries.
  let annIdP = null;
  function ensureAnnId() {
    if (!annIdP) {
      annIdP = (async () => {
        const child = await drive.findChild(folderId, ANN_NAME);
        if (child) return child.id;
        const { id } = await drive.putJson({ folderId, name: ANN_NAME, data: emptyAnnotations(), existingId: null });
        return id;
      })().catch((e) => { annIdP = null; throw e; });
    }
    return annIdP;
  }

  return {
    async listSheets() {
      const files = await drive.listChildren(folderId, { mimeType: PDF_MIME });
      return files.map((f) => ({ name: f.name }));
    },

    async loadPdfData(name) {
      const child = await drive.findChild(folderId, name);
      if (!child || child.mimeType !== PDF_MIME) {
        throw new Error(`PDF not found in project folder: ${name}`);
      }
      const bytes = await drive.getFileBytes(child.id);
      // hand pdf.js a fresh view each call — getDocument({data}) may detach it
      return new Uint8Array(bytes);
    },

    async addPdf(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // de-dupe by name: a re-dropped file replaces the existing bytes
      const existing = await drive.findChild(folderId, file.name);
      if (existing) {
        await drive.updateFileBytes(existing.id, bytes, PDF_MIME);
      } else {
        await drive.uploadFile({ name: file.name, parentId: folderId, mimeType: PDF_MIME, bytes });
      }
      return { name: file.name };
    },

    async removePdf(name) {
      const existing = await drive.findChild(folderId, name);
      if (existing) await drive.deleteFile(existing.id);
    },

    async loadAnnotations() {
      const child = await drive.findChild(folderId, ANN_NAME);
      // No file yet = a fresh project → the empty default (same as localStore).
      if (!child) return emptyAnnotations();
      // Remember the id for saves (bypass the create branch in ensureAnnId).
      annIdP = Promise.resolve(child.id);
      let data;
      try {
        data = await drive.getJson(child.id);
      } catch (e) {
        // The file EXISTS but couldn't be read/parsed (network blip, truncated
        // upload, hand-edited JSON). Do NOT fall back to the empty default here:
        // the canvas would hydrate empty and autosave that over the real project.
        // Tagged so the canvas load can leave autosave DISARMED (like a stale tab)
        // instead of overwriting Drive. See TakeoffCanvas mount-load catch.
        throw Object.assign(
          new Error(`Couldn't read this project's saved takeoff from Drive — reload to retry. (${e?.message || e})`),
          { name: "CloudLoadError" },
        );
      }
      // A file that parsed to null/falsy is treated as empty (localStore's `a ||`
      // guard) — a degenerate file, safe to replace on the next save.
      return data || emptyAnnotations();
    },

    async saveAnnotations(payload) {
      const existingId = await ensureAnnId();
      await drive.putJson({ folderId, name: ANN_NAME, data: { ...payload, schema: ANN_SCHEMA }, existingId });
    },

    // ── browser-global, local-only (delegated) ───────────────────────────────
    // Cross-project assets and local versioning stay in localStore for now (see
    // header). Forward args and return values untouched.
    loadTemplates(...args) { return local.loadTemplates(...args); },
    saveTemplates(...args) { return local.saveTemplates(...args); },
    loadMaterialLibrary(...args) { return local.loadMaterialLibrary(...args); },
    saveMaterialLibrary(...args) { return local.saveMaterialLibrary(...args); },
    loadStampLibrary(...args) { return local.loadStampLibrary(...args); },
    saveStampLibrary(...args) { return local.saveStampLibrary(...args); },
    saveSnapshot(...args) { return local.saveSnapshot(...args); },
    listSnapshots(...args) { return local.listSnapshots(...args); },
    getSnapshot(...args) { return local.getSnapshot(...args); },
    deleteSnapshot(...args) { return local.deleteSnapshot(...args); },
  };
}
