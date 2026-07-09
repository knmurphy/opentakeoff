// Drive-backed store adapter — the same seam contract as store.test.ts, but
// against an in-memory fake Drive (a Map) and a recording fake localStore. No
// network, no IndexedDB, no DOM: we prove listSheets/addPdf/annotations hit
// Drive with the localStore-compatible shapes, and that the browser-global
// methods delegate straight through to localStore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCloudStore } from "../src/lib/cloudStore.js";
import { ANN_SCHEMA } from "../src/lib/store.js";

const PDF_MIME = "application/pdf";

// Fake Drive over a Map<id, record>. Records are
// { id, name, mimeType, bytes, parent?, modifiedTime?, size? }.
// Enough of the createDrive surface for cloudStore to run. `parent` lets a test
// place a file in a SUBFOLDER: listChildren(folderId) returns only that folder's
// children, and findChild(folderId, name) matches only same-folder files —
// records seeded WITHOUT a parent stay findable in any folder (back-compat).
function fakeDrive() {
  const byId = new Map<string, any>();
  let seq = 0;
  const newId = () => `id_${++seq}`;
  const find = (folderId: string, name: string) => {
    for (const rec of byId.values()) {
      if (rec.name !== name) continue;
      if (rec.parent !== undefined && rec.parent !== folderId) continue;
      return rec;
    }
    return null;
  };
  return {
    _byId: byId,
    async listChildren(folderId: string, { mimeType }: any = {}) {
      const out = [];
      for (const rec of byId.values()) {
        if (rec.parent !== folderId) continue;
        if (mimeType && rec.mimeType !== mimeType) continue;
        out.push({ id: rec.id, name: rec.name, mimeType: rec.mimeType, modifiedTime: rec.modifiedTime ?? "t", size: rec.size });
      }
      return out;
    },
    async findChild(folderId: string, name: string) {
      const rec = find(folderId, name);
      return rec ? { id: rec.id, name: rec.name, mimeType: rec.mimeType, modifiedTime: "t" } : null;
    },
    async getFileBytes(fileId: string) {
      return new Uint8Array(byId.get(fileId).bytes);
    },
    async getJson(fileId: string) {
      return JSON.parse(new TextDecoder().decode(byId.get(fileId).bytes));
    },
    async uploadFile({ name, parentId, mimeType, bytes }: any) {
      const id = newId();
      byId.set(id, { id, name, parent: parentId, mimeType, bytes: new Uint8Array(bytes) });
      return { id, name };
    },
    async updateFileBytes(fileId: string, bytes: Uint8Array, mimeType?: string) {
      const rec = byId.get(fileId);
      rec.bytes = new Uint8Array(bytes);
      if (mimeType) rec.mimeType = mimeType;
      return { id: fileId };
    },
    // Set _failPutJsonOnce = true to make the NEXT putJson reject (persist
    // failure), then it auto-clears — lets a test prove memory doesn't diverge.
    _failPutJsonOnce: false as boolean,
    async putJson({ folderId, name, data, existingId }: any) {
      if (this._failPutJsonOnce) { this._failPutJsonOnce = false; throw new Error("putJson boom"); }
      const bytes = new TextEncoder().encode(JSON.stringify(data));
      if (existingId) return this.updateFileBytes(existingId, bytes, "application/json");
      return this.uploadFile({ name, parentId: folderId, mimeType: "application/json", bytes });
    },
    async deleteFile(fileId: string) {
      byId.delete(fileId);
    },
  };
}

// A localStore stand-in that records which delegated method was called.
function fakeLocal() {
  const calls: { method: string; args: any[] }[] = [];
  const rec = (method: string) => (...args: any[]) => { calls.push({ method, args }); return `ret:${method}`; };
  return {
    _calls: calls,
    loadTemplates: rec("loadTemplates"),
    saveTemplates: rec("saveTemplates"),
    loadMaterialLibrary: rec("loadMaterialLibrary"),
    saveMaterialLibrary: rec("saveMaterialLibrary"),
    loadStampLibrary: rec("loadStampLibrary"),
    saveStampLibrary: rec("saveStampLibrary"),
    saveSnapshot: rec("saveSnapshot"),
    listSnapshots: rec("listSnapshots"),
    getSnapshot: rec("getSnapshot"),
    deleteSnapshot: rec("deleteSnapshot"),
  };
}

// Minimal File stand-in: node has no DOM File, and cloudStore only needs
// `name` + `arrayBuffer()`.
function fakeFile(name: string, bytes: Uint8Array) {
  return { name, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
}

test("listSheets returns the manifest's chosen PDFs, not everything in the folder", async () => {
  const drive = fakeDrive();
  // an un-manifested PDF sitting in the project folder must NOT surface
  drive._byId.set("id_a", { id: "id_a", name: "spec-book.pdf", parent: "folder1", mimeType: PDF_MIME, bytes: new Uint8Array() });
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  assert.deepEqual(await store.listSheets(), []); // empty manifest → []

  await store.addSheets([{ id: "id_pick", name: "plan-a.pdf" }]);
  assert.deepEqual(await store.listSheets(), [{ name: "plan-a.pdf" }]);
});

test("addSheets dedupes by id and by name, keeps pick order, persists sheets.json", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });

  await store.addSheets([{ id: "1", name: "a.pdf" }, { id: "2", name: "b.pdf" }]);
  // same id (different name) and same name (different id) are both skipped
  const files = await store.addSheets([{ id: "1", name: "renamed.pdf" }, { id: "9", name: "b.pdf" }, { id: "3", name: "c.pdf" }]);
  assert.deepEqual(files, [{ id: "1", name: "a.pdf" }, { id: "2", name: "b.pdf" }, { id: "3", name: "c.pdf" }]);

  // exactly one sheets.json, holding the deduped set
  const sheetsFiles = [...drive._byId.values()].filter((r) => r.name === "sheets.json");
  assert.equal(sheetsFiles.length, 1);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(sheetsFiles[0].bytes)).files.map((f: any) => f.name), ["a.pdf", "b.pdf", "c.pdf"]);
});

test("concurrent addSheets with no sheets.json yet creates exactly ONE, keeping both sets of picks", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  // two picks race before any sheets.json exists — the write chain must serialize
  // them so the first creates the file and the second reuses its id (no dup, no
  // lost picks).
  await Promise.all([
    store.addSheets([{ id: "1", name: "a.pdf" }]),
    store.addSheets([{ id: "2", name: "b.pdf" }]),
  ]);
  const sheetsFiles = [...drive._byId.values()].filter((r) => r.name === "sheets.json");
  assert.equal(sheetsFiles.length, 1);
  assert.deepEqual((await store.listSheets()).map((s) => s.name).sort(), ["a.pdf", "b.pdf"]);
});

test("a failed putJson leaves the in-memory manifest unchanged and rethrows", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store.addSheets([{ id: "1", name: "a.pdf" }]);

  drive._failPutJsonOnce = true;
  await assert.rejects(store.addSheets([{ id: "2", name: "b.pdf" }]), /putJson boom/);
  // memory did not absorb the failed pick, and disk still holds only a.pdf
  assert.deepEqual(await store.listSheets(), [{ name: "a.pdf" }]);
  // the write chain recovered — a later write still lands
  await store.addSheets([{ id: "3", name: "c.pdf" }]);
  assert.deepEqual((await store.listSheets()).map((s) => s.name), ["a.pdf", "c.pdf"]);
});

test("addSheets name-dedupe keeps the first id when a later pick reuses the name", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store.addSheets([{ id: "X", name: "plan.pdf" }]);
  const files = await store.addSheets([{ id: "Y", name: "plan.pdf" }]);
  // second (different id, same name) is dropped — the store pins name-dedupe even
  // though the picker also guards this in the UI.
  assert.deepEqual(files, [{ id: "X", name: "plan.pdf" }]);
});

test("addPdf uploads a new file, then updates on re-add (dedupe by name), and manifests it", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });

  await store.addPdf(fakeFile("plan.pdf", new Uint8Array([1, 2, 3])) as any);
  const pdfs = () => [...drive._byId.values()].filter((r) => r.mimeType === PDF_MIME);
  assert.equal(pdfs().length, 1);
  assert.deepEqual(pdfs()[0].bytes, new Uint8Array([1, 2, 3]));
  // the dropped PDF joined the working set
  assert.deepEqual(await store.listSheets(), [{ name: "plan.pdf" }]);

  const ret = await store.addPdf(fakeFile("plan.pdf", new Uint8Array([9, 9])) as any);
  assert.deepEqual(ret, { name: "plan.pdf" });
  assert.equal(pdfs().length, 1); // replaced, not duplicated
  assert.deepEqual(pdfs()[0].bytes, new Uint8Array([9, 9]));
  assert.deepEqual(await store.listSheets(), [{ name: "plan.pdf" }]); // re-add didn't dup the manifest entry
});

test("loadPdfData resolves by manifest id; throws when not in the working set", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store.addPdf(fakeFile("plan.pdf", new Uint8Array([37, 80, 68, 70])) as any);
  assert.deepEqual(await store.loadPdfData("plan.pdf"), new Uint8Array([37, 80, 68, 70]));
  await assert.rejects(store.loadPdfData("missing.pdf"), /PDF not in project sheet set: missing\.pdf/);
});

test("loadPdfData resolves a file living in a SUBFOLDER purely via the manifest id", async () => {
  const drive = fakeDrive();
  // the picked PDF lives in a subfolder, NOT the project folder — a
  // findChild-by-name in the project folder would never find it.
  drive._byId.set("sub_pdf", { id: "sub_pdf", name: "wing-b.pdf", parent: "subfolder1", mimeType: PDF_MIME, bytes: new Uint8Array([5, 6, 7]) });
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store.addSheets([{ id: "sub_pdf", name: "wing-b.pdf" }]);
  assert.deepEqual(await store.loadPdfData("wing-b.pdf"), new Uint8Array([5, 6, 7]));
  // prove the project-folder name lookup is not the path: there is no such file
  // in folder1, yet the load succeeds.
  assert.equal(await drive.findChild("folder1", "wing-b.pdf"), null);
});

test("listFolder splits folders vs pdfs, carries size+modifiedTime, defaults to the project folder", async () => {
  const drive = fakeDrive();
  drive._byId.set("d1", { id: "d1", name: "Wing B", parent: "folder1", mimeType: "application/vnd.google-apps.folder", bytes: new Uint8Array() });
  drive._byId.set("p1", { id: "p1", name: "plan.pdf", parent: "folder1", mimeType: PDF_MIME, size: "2048", modifiedTime: "m1", bytes: new Uint8Array() });
  drive._byId.set("j1", { id: "j1", name: "annotations.json", parent: "folder1", mimeType: "application/json", bytes: new Uint8Array() });
  drive._byId.set("p2", { id: "p2", name: "wing.pdf", parent: "subfolder1", mimeType: PDF_MIME, size: "99", modifiedTime: "m2", bytes: new Uint8Array() });
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });

  const root = await store.listFolder(); // defaults to folder1
  assert.deepEqual(root.folders, [{ id: "d1", name: "Wing B" }]);
  assert.deepEqual(root.pdfs, [{ id: "p1", name: "plan.pdf", size: "2048", modifiedTime: "m1" }]); // json ignored

  // drilling into a subfolder returns THAT folder's children
  const sub = await store.listFolder("subfolder1");
  assert.deepEqual(sub.folders, []);
  assert.deepEqual(sub.pdfs, [{ id: "p2", name: "wing.pdf", size: "99", modifiedTime: "m2" }]);
});

test("constructing the store and listing sheets triggers ZERO PDF downloads", async () => {
  const drive = fakeDrive();
  // a folder full of PDFs, none picked into the working set
  for (let i = 0; i < 5; i++) {
    drive._byId.set(`big_${i}`, { id: `big_${i}`, name: `spec-${i}.pdf`, parent: "folder1", mimeType: PDF_MIME, bytes: new Uint8Array([i]) });
  }
  let downloads = 0;
  const orig = drive.getFileBytes.bind(drive);
  (drive as any).getFileBytes = async (id: string) => { downloads++; return orig(id); };

  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store.listSheets();
  assert.equal(downloads, 0); // the core fix: no auto-download of the whole folder

  // a download happens ONLY when a picked sheet is actually loaded
  await store.addSheets([{ id: "big_2", name: "spec-2.pdf" }]);
  await store.loadPdfData("spec-2.pdf");
  assert.equal(downloads, 1);
});

test("removePdf drops the entry from the manifest but LEAVES the Drive file", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store.addPdf(fakeFile("plan.pdf", new Uint8Array([1])) as any);
  const pdfId = [...drive._byId.values()].find((r) => r.mimeType === PDF_MIME)!.id;

  await store.removePdf("plan.pdf");
  assert.deepEqual(await store.listSheets(), []); // out of the working set
  assert.ok(drive._byId.has(pdfId)); // but the shared Drive file survives

  await store.removePdf("nope.pdf"); // no-op, no throw
});

test("loadAnnotations returns the localStore default shape when absent", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  assert.deepEqual(await store.loadAnnotations(), {
    schema: ANN_SCHEMA, conditions: [], shapes: [], markups: [], sheets: [], sheet_group: [], last_group: [], sheet_tabs: [],
  });
});

test("saveAnnotations round-trips, stamps schema, and updates in place", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });

  const payload = { conditions: [{ id: "c1" }], shapes: [{ id: "s1" }], markups: [], sheets: [], sheet_group: [], last_group: [], sheet_tabs: [] };
  await store.saveAnnotations(payload);
  assert.deepEqual(await store.loadAnnotations(), { ...payload, schema: ANN_SCHEMA });

  // second save must update the same file, not create a second annotations.json
  await store.saveAnnotations({ ...payload, conditions: [{ id: "c2" }] });
  const jsonFiles = [...drive._byId.values()].filter((r) => r.name === "annotations.json");
  assert.equal(jsonFiles.length, 1);
  assert.deepEqual((await store.loadAnnotations()).conditions, [{ id: "c2" }]);
});

test("saveAnnotations after loadAnnotations reuses the discovered file id", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store.saveAnnotations({ shapes: [] }); // creates the file
  // fresh store instance: loadAnnotations must find + cache the id so the next save updates
  const store2 = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store2.loadAnnotations();
  await store2.saveAnnotations({ shapes: [{ id: "s9" }] });
  const jsonFiles = [...drive._byId.values()].filter((r) => r.name === "annotations.json");
  assert.equal(jsonFiles.length, 1);
});

test("loadAnnotations throws a tagged CloudLoadError when the file exists but is unreadable", async () => {
  const drive = fakeDrive();
  // a present-but-corrupt annotations.json: getJson (JSON.parse) will throw
  drive._byId.set("id_x", { id: "id_x", name: "annotations.json", mimeType: "application/json", bytes: new TextEncoder().encode("{not json") });
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await assert.rejects(store.loadAnnotations(), (e: any) => {
    assert.equal(e.name, "CloudLoadError");   // canvas routes on this to leave autosave DISARMED
    return true;
  });
});

test("loadAnnotations falls back to the empty default when the file parses to null", async () => {
  const drive = fakeDrive();
  drive._byId.set("id_n", { id: "id_n", name: "annotations.json", mimeType: "application/json", bytes: new TextEncoder().encode("null") });
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  assert.deepEqual((await store.loadAnnotations()).conditions, []);
  assert.equal((await store.loadAnnotations()).schema, ANN_SCHEMA);
});

test("concurrent saves on a fresh project create exactly one annotations.json (no dup race)", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  // two autosaves fire before the first resolves — the memoized file id must
  // funnel both to the same file instead of each taking the create branch.
  await Promise.all([
    store.saveAnnotations({ shapes: [{ id: "a" }] }),
    store.saveAnnotations({ shapes: [{ id: "b" }] }),
  ]);
  const jsonFiles = [...drive._byId.values()].filter((r) => r.name === "annotations.json");
  assert.equal(jsonFiles.length, 1);
});

test("browser-global methods delegate to localStore untouched", async () => {
  const drive = fakeDrive();
  const local = fakeLocal();
  const store = createCloudStore("folder1", drive as any, { local: local as any });

  assert.equal(store.loadTemplates(), "ret:loadTemplates");
  assert.equal(store.saveTemplates(["t"]), "ret:saveTemplates");
  assert.equal(store.loadMaterialLibrary(), "ret:loadMaterialLibrary");
  assert.equal(store.saveMaterialLibrary(["m"]), "ret:saveMaterialLibrary");
  assert.equal(store.loadStampLibrary(), "ret:loadStampLibrary");
  assert.equal(store.saveStampLibrary({ s: 1 }), "ret:saveStampLibrary");
  assert.equal(store.saveSnapshot("label", { x: 1 }), "ret:saveSnapshot");
  assert.equal(store.listSnapshots(), "ret:listSnapshots");
  assert.equal(store.getSnapshot("snap_1"), "ret:getSnapshot");
  assert.equal(store.deleteSnapshot("snap_1"), "ret:deleteSnapshot");

  assert.deepEqual(local._calls.map((c) => c.method), [
    "loadTemplates", "saveTemplates", "loadMaterialLibrary", "saveMaterialLibrary",
    "loadStampLibrary", "saveStampLibrary", "saveSnapshot", "listSnapshots",
    "getSnapshot", "deleteSnapshot",
  ]);
  // snapshot delegates inject this store's folderId ("folder1") as the scope;
  // deleteSnapshot is by unique id and stays unscoped.
  assert.deepEqual(local._calls[6].args, ["label", { x: 1 }, "folder1"]); // saveSnapshot
  assert.deepEqual(local._calls[7].args, ["folder1"]);                    // listSnapshots
  assert.deepEqual(local._calls[8].args, ["snap_1", "folder1"]);          // getSnapshot
  assert.deepEqual(local._calls[9].args, ["snap_1"]);                     // deleteSnapshot
});
