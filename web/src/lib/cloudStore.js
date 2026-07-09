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

import { localStore, ANN_SCHEMA } from "./store.js";

const PDF_MIME = "application/pdf";
const ANN_NAME = "annotations.json";

// The empty-project shape localStore.loadAnnotations() returns — kept identical
// so a fresh cloud project hydrates the canvas exactly like a fresh local one.
function defaultAnnotations() {
  return { schema: ANN_SCHEMA, conditions: [], shapes: [], markups: [], sheets: [], sheet_group: [], last_group: [], sheet_tabs: [] };
}

/**
 * @param {string} folderId               the project's Drive folder
 * @param {ReturnType<import('./google/drive.js').createDrive>} drive
 * @param {{ local?: typeof localStore }} [opts]  inject localStore for tests
 */
export function createCloudStore(folderId, drive, { local = localStore } = {}) {
  // Remember the annotations file id after the first read/write so subsequent
  // saves update in place instead of creating a second annotations.json.
  let annId = null;

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
      if (!child) return defaultAnnotations();
      annId = child.id;
      return drive.getJson(child.id);
    },

    async saveAnnotations(payload) {
      const { id } = await drive.putJson({
        folderId,
        name: ANN_NAME,
        data: { ...payload, schema: ANN_SCHEMA },
        existingId: annId,
      });
      annId = id;
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
