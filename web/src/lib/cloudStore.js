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
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ANN_NAME = "annotations.json";
const SHEETS_NAME = "sheets.json";

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

  // The working-set manifest (sheets.json): the PDFs the user has explicitly
  // picked into this project, in pick order. The gallery reads ONLY this — we no
  // longer enumerate (and download) every PDF in the Drive folder, which for a
  // real folder of spec books and as-builts would be ruinous.
  //
  // Memoized exactly like ensureAnnId: locate-or-treat-absent-as-empty once, and
  // cache the file id so writes update in place instead of spawning duplicate
  // sheets.json files. `manifestFiles` is the live in-memory copy of the chosen
  // set so loadPdfData can resolve name→id synchronously after the first read.
  // A failed read is not cached, so the next call retries.
  let manifestP = null;
  /** @type {{ id: string, name: string }[]} */
  let manifestFiles = [];
  let sheetsId = null;
  function ensureManifest() {
    if (!manifestP) {
      manifestP = (async () => {
        const child = await drive.findChild(folderId, SHEETS_NAME);
        if (!child) { manifestFiles = []; sheetsId = null; return manifestFiles; }
        sheetsId = child.id;
        const data = await drive.getJson(child.id);
        manifestFiles = (data && Array.isArray(data.files)) ? data.files : [];
        return manifestFiles;
      })().catch((e) => { manifestP = null; throw e; });
    }
    return manifestP;
  }

  return {
    async listSheets() {
      // Metadata/JSON only — deliberately NO getFileBytes on any PDF.
      const files = await ensureManifest();
      return files.map((f) => ({ name: f.name }));
    },

    async loadPdfData(name) {
      // Resolve by id from the manifest: picked files may live in SUBFOLDERS, so
      // a findChild-by-name in the project folder wouldn't find them.
      const files = await ensureManifest();
      const entry = files.find((f) => f.name === name);
      if (!entry) throw new Error(`PDF not in project sheet set: ${name}`);
      const bytes = await drive.getFileBytes(entry.id);
      // hand pdf.js a fresh view each call — getDocument({data}) may detach it
      return new Uint8Array(bytes);
    },

    /**
     * Browse a Drive folder for the picker: split children into folders and
     * PDFs. Metadata only — nothing downloads. Other file types are ignored.
     * @param {string} [browseFolderId]  defaults to the project folder
     */
    async listFolder(browseFolderId = folderId) {
      const children = await drive.listChildren(browseFolderId);
      const folders = [];
      const pdfs = [];
      for (const c of children) {
        if (c.mimeType === FOLDER_MIME) folders.push({ id: c.id, name: c.name });
        else if (c.mimeType === PDF_MIME) pdfs.push({ id: c.id, name: c.name, size: c.size, modifiedTime: c.modifiedTime });
      }
      return { folders, pdfs };
    },

    /**
     * Add picked PDFs to the working set, deduping by id AND by name (a file
     * already present under either key is skipped), then persist sheets.json.
     * @param {{ id: string, name: string }[]} items
     */
    async addSheets(items) {
      // Mutate the memoized array in place so the cached ensureManifest promise
      // (and listSheets/loadPdfData) see the update without a re-read.
      const files = await ensureManifest();
      for (const it of items) {
        if (files.some((f) => f.id === it.id || f.name === it.name)) continue;
        files.push({ id: it.id, name: it.name });
      }
      const { id } = await drive.putJson({ folderId, name: SHEETS_NAME, data: { files }, existingId: sheetsId });
      sheetsId = id;
      return files;
    },

    async removePdf(name) {
      // Remove from the working set only — do NOT delete the Drive file, which
      // may be a shared spec book owned by someone else. Splice in place to keep
      // the memoized array reference stable (see addSheets).
      const files = await ensureManifest();
      const before = files.length;
      for (let i = files.length - 1; i >= 0; i--) {
        if (files[i].name === name) files.splice(i, 1);
      }
      if (files.length === before) return;
      const { id } = await drive.putJson({ folderId, name: SHEETS_NAME, data: { files }, existingId: sheetsId });
      sheetsId = id;
    },

    async addPdf(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // de-dupe by name: a re-dropped file replaces the existing bytes
      const existing = await drive.findChild(folderId, file.name);
      let fileId;
      if (existing) {
        await drive.updateFileBytes(existing.id, bytes, PDF_MIME);
        fileId = existing.id;
      } else {
        const created = await drive.uploadFile({ name: file.name, parentId: folderId, mimeType: PDF_MIME, bytes });
        fileId = created.id;
      }
      // a dropped PDF joins the working set (dedupe by id/name in addSheets)
      await this.addSheets([{ id: fileId, name: file.name }]);
      return { name: file.name };
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

    // ── browser-global assets (delegated untouched) ──────────────────────────
    // Condition templates and the material/stamp libraries are cross-project by
    // design, so they stay in localStore for now (see header).
    loadTemplates(...args) { return local.loadTemplates(...args); },
    saveTemplates(...args) { return local.saveTemplates(...args); },
    loadMaterialLibrary(...args) { return local.loadMaterialLibrary(...args); },
    saveMaterialLibrary(...args) { return local.saveMaterialLibrary(...args); },
    loadStampLibrary(...args) { return local.loadStampLibrary(...args); },
    saveStampLibrary(...args) { return local.saveStampLibrary(...args); },

    // ── snapshots: browser-local, but SCOPED to this Drive project ────────────
    // Storage stays in localStore (Drive-backed versioning is a later item), but
    // we pass folderId as the scope so one browser opening several projects can't
    // see or load another project's snapshots. deleteSnapshot is by unique id;
    // the panel only ever surfaces this project's ids.
    saveSnapshot(label, payload) { return local.saveSnapshot(label, payload, folderId); },
    listSnapshots() { return local.listSnapshots(folderId); },
    getSnapshot(id) { return local.getSnapshot(id, folderId); },
    deleteSnapshot(id) { return local.deleteSnapshot(id); },
  };
}
