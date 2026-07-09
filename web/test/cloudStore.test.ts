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

// Fake Drive over a Map<id, record>. Records are { id, name, mimeType, bytes }.
// Enough of the createDrive surface for cloudStore to run.
function fakeDrive() {
  const byId = new Map<string, any>();
  let seq = 0;
  const newId = () => `id_${++seq}`;
  const find = (folderId: string, name: string) => {
    for (const rec of byId.values()) if (rec.name === name) return rec;
    return null;
  };
  return {
    _byId: byId,
    async listChildren(_folderId: string, { mimeType }: any = {}) {
      const out = [];
      for (const rec of byId.values()) {
        if (!mimeType || rec.mimeType === mimeType) {
          out.push({ id: rec.id, name: rec.name, mimeType: rec.mimeType, modifiedTime: "t" });
        }
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
    async uploadFile({ name, mimeType, bytes }: any) {
      const id = newId();
      byId.set(id, { id, name, mimeType, bytes: new Uint8Array(bytes) });
      return { id, name };
    },
    async updateFileBytes(fileId: string, bytes: Uint8Array, mimeType?: string) {
      const rec = byId.get(fileId);
      rec.bytes = new Uint8Array(bytes);
      if (mimeType) rec.mimeType = mimeType;
      return { id: fileId };
    },
    async putJson({ folderId, name, data, existingId }: any) {
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

test("listSheets returns only PDFs as [{ name }]", async () => {
  const drive = fakeDrive();
  drive._byId.set("id_a", { id: "id_a", name: "plan-a.pdf", mimeType: PDF_MIME, bytes: new Uint8Array() });
  drive._byId.set("id_b", { id: "id_b", name: "annotations.json", mimeType: "application/json", bytes: new Uint8Array() });
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  assert.deepEqual(await store.listSheets(), [{ name: "plan-a.pdf" }]);
});

test("addPdf uploads a new file, then updates on re-add (dedupe by name)", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });

  await store.addPdf(fakeFile("plan.pdf", new Uint8Array([1, 2, 3])) as any);
  assert.equal(drive._byId.size, 1);
  assert.deepEqual([...drive._byId.values()][0].bytes, new Uint8Array([1, 2, 3]));

  const ret = await store.addPdf(fakeFile("plan.pdf", new Uint8Array([9, 9])) as any);
  assert.deepEqual(ret, { name: "plan.pdf" });
  assert.equal(drive._byId.size, 1); // replaced, not duplicated
  assert.deepEqual([...drive._byId.values()][0].bytes, new Uint8Array([9, 9]));
});

test("loadPdfData returns fresh bytes; throws when missing", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store.addPdf(fakeFile("plan.pdf", new Uint8Array([37, 80, 68, 70])) as any);
  assert.deepEqual(await store.loadPdfData("plan.pdf"), new Uint8Array([37, 80, 68, 70]));
  await assert.rejects(store.loadPdfData("missing.pdf"), /PDF not found in project folder: missing\.pdf/);
});

test("removePdf deletes the matching file", async () => {
  const drive = fakeDrive();
  const store = createCloudStore("folder1", drive as any, { local: fakeLocal() as any });
  await store.addPdf(fakeFile("plan.pdf", new Uint8Array([1])) as any);
  await store.removePdf("plan.pdf");
  assert.equal(drive._byId.size, 0);
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
  // args forwarded verbatim
  assert.deepEqual(local._calls[6].args, ["label", { x: 1 }]);
});
