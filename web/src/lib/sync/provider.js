// The annotation-sync PROVIDER seam — the two-method cloud interface the
// annotation reconciler (syncStore, a later slice) talks to. Drive satisfies it
// today; a OneDrive/O365 provider implements the same two methods later.
//
//   pull()                       -> { data, rev } | null
//   push(data, { expectedRev })  -> { rev } | { conflict, remote: { data, rev } }
//
// Design notes:
//   • Provider-agnostic preconditions. There is NO reliance on an HTTP
//     If-Match/ETag. The precondition is APP-LEVEL: push re-reads the current
//     remote rev and compares it to the caller's expectedRev. Any backend that
//     can read-then-write a JSON blob can implement this.
//   • The provider is MECHANICAL. It reports what it sees (a rev, or a conflict
//     with the remote payload) and never decides policy. All the hard policy —
//     seed-guard via `touched`, last-writer-wins, loser-snapshot, rev-regression
//     handling — lives in the reconciler, not here.
//   • rev lives INSIDE the annotations payload as an additive integer key, so a
//     flag-off writer (cloudStore.saveAnnotations, which writes no rev) simply
//     yields rev === null on pull — the reconciler treats that as an external
//     authoritative write. `updated_at` is likewise additive and owned by the
//     reconciler; the provider neither reads nor writes it.
//   • Shared-sidecar safety (adversarial F4): the `.opentakeoff` folder resolver
//     is INJECTED (cloudStore's memoized ensureSidecarId), so this provider and
//     cloudStore never race to create two split sidecar folders. The provider
//     owns only annotations.json inside that shared folder.

import { emptyAnnotations } from "../store.js";

const ANN_NAME = "annotations.json";

// Read a rev out of a payload: a finite integer or null (absent/garbage).
function revOf(data) {
  return typeof data?.rev === "number" && Number.isFinite(data.rev) ? data.rev : null;
}

/**
 * @param {string} folderId  Drive project folder id (for symmetry / logging; the
 *   actual writes target the shared sidecar folder)
 * @param {ReturnType<import("../google/drive.js").createDrive>} drive
 * @param {{ ensureSidecarId: () => Promise<string> }} deps  shared `.opentakeoff` resolver
 */
export function createDriveProvider(folderId, drive, { ensureSidecarId }) {
  // Memoized annotations.json id: locate-else-create exactly once, so concurrent
  // first-writes can't each create a duplicate file. Not cached on failure, so a
  // transient error retries. Mirrors cloudStore.ensureAnnId.
  let annIdP = null;
  function ensureAnnId() {
    if (!annIdP) {
      annIdP = (async () => {
        const sidecarId = await ensureSidecarId();
        const child = await drive.findChild(sidecarId, ANN_NAME);
        if (child) return child.id;
        // Seed a brand-new file with the empty shape (no rev — the first push
        // stamps rev 1). Create branch only; a found file is used as-is.
        const { id } = await drive.putJson({ folderId: sidecarId, name: ANN_NAME, data: emptyAnnotations(), existingId: null });
        return id;
      })().catch((e) => { annIdP = null; throw e; });
    }
    return annIdP;
  }

  return {
    // Read the current remote annotations. Returns null when no file exists yet
    // (a fresh project — the caller seeds). A read that throws (network blip,
    // corrupt/truncated JSON) PROPAGATES: the caller must decide (the reconciler
    // keeps local canonical and never hydrates-empty-over-real on a failed pull).
    async pull() {
      const sidecarId = await ensureSidecarId();
      const child = await drive.findChild(sidecarId, ANN_NAME);
      if (!child) return null;
      const data = await drive.getJson(child.id);
      annIdP = Promise.resolve(child.id); // cache the id for a subsequent push
      return { data, rev: revOf(data) };
    },

    // Write `data` with a bumped rev, guarded by an app-level precondition: if
    // the caller expected a specific rev and the remote has since moved to a
    // DIFFERENT rev (including a rev-less external write → remote rev null), the
    // write is refused and the current remote is returned so the reconciler can
    // resolve. On success the new rev is data's expectedRev+1 (or remote+1 / 1
    // for a first push).
    /**
     * @param {object} data  full annotations payload (schema etc. already set by caller)
     * @param {{ expectedRev?: number|null }} [opts]
     */
    async push(data, { expectedRev = null } = {}) {
      const id = await ensureAnnId();
      const sidecarId = await ensureSidecarId();
      // Precondition read: what's actually on Drive right now?
      let remote = null;
      try {
        remote = await drive.getJson(id);
      } catch {
        // Unreadable remote (corrupt/blip): treat as "no known rev". A caller
        // that passed expectedRev will therefore see a conflict below and can
        // decide; a first push (expectedRev null) proceeds and overwrites the
        // degenerate file.
        remote = null;
      }
      const remoteRev = revOf(remote);
      if (expectedRev != null && remoteRev !== expectedRev) {
        // Remote diverged from what we based our edit on — hand it back.
        return { conflict: true, remote: { data: remote, rev: remoteRev } };
      }
      const nextRev = (expectedRev ?? remoteRev ?? 0) + 1;
      await drive.putJson({ folderId: sidecarId, name: ANN_NAME, data: { ...data, rev: nextRev }, existingId: id });
      return { rev: nextRev };
    },
  };
}
