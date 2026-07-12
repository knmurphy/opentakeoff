// File ingest — turn anything a contractor drops (a plan PDF, a scan or
// screenshot image, or a .zip plan set straight off a bid platform) into the
// PDF "sheets" the canvas already knows how to render.
//
// Everything happens in the browser: zips are unpacked and images are wrapped
// into a one-page PDF locally — nothing is uploaded. Because every input becomes
// a PDF, the rest of the app (sheets, scale, One-Click, render) is unchanged.
//
//   ingestFiles(fileList, { onProgress }) -> { pdfs: File[], skipped: [{name, reason}] }
//
// The returned File objects are all application/pdf, ready for store.addPdf().
// fflate (unzip) and pdf-lib (image→PDF) are loaded on demand — only when a user
// actually drops a zip or image — so they never weigh down the initial page load.

const PDF_EXT = /\.pdf$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const ZIP_EXT = /\.zip$/i;

// Zip-bomb bounds. Real plan sets are dozens of sheets, maybe a couple hundred
// on a hospital job — the caps sit far above anything legitimate while keeping
// a hostile archive from exhausting the tab: an entry count cap, a nesting
// depth cap (zip-in-zip recursion), and per-entry/total decompressed-size caps
// (fflate reports uncompressed sizes before inflating, so oversized entries
// are refused without ever being decompressed).
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_DEPTH = 2;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;        // 512 MB per entry
const MAX_TOTAL_BYTES = 1536 * 1024 * 1024;       // 1.5 GB decompressed per drop

const isPdf = (name, type = "") => PDF_EXT.test(name) || type === "application/pdf";
const isImage = (name, type = "") => IMAGE_EXT.test(name) || (type || "").startsWith("image/");
const isZip = (name, type = "") => ZIP_EXT.test(name) || /zip/i.test(type);

const baseName = (path) => path.split("/").pop() || path;

// macOS / Windows archive cruft and hidden files inside zips
const isJunk = (path) =>
  path.endsWith("/") ||
  /(^|\/)__MACOSX\//.test(path) ||
  /(^|\/)\._/.test(path) ||
  /(^|\/)\.DS_Store$/i.test(path) ||
  /(^|\/)Thumbs\.db$/i.test(path);

// First-bytes sniff so a mislabeled or extension-less zip still works (PK\x03\x04).
async function looksLikeZip(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  } catch { return false; }
}

// Decompress only the entries we can use (saves memory on big plan sets); report
// anything else as skipped via onSkip rather than silently dropping it. `budget`
// is shared across nested zips in one drop, so the caps hold for the whole batch.
async function unzipBytes(bytes, onSkip, budget) {
  const { unzip } = await import("fflate");
  return new Promise((resolve, reject) => {
    unzip(bytes, {
      filter: (f) => {
        if (isJunk(f.name)) return false;
        const bn = baseName(f.name);
        if (!(isPdf(bn) || isImage(bn) || isZip(bn))) { onSkip?.(bn, "unsupported type"); return false; }
        if (budget.entries >= MAX_ZIP_ENTRIES) { onSkip?.(bn, `zip entry cap (${MAX_ZIP_ENTRIES}) reached`); return false; }
        if (f.originalSize > MAX_ENTRY_BYTES) { onSkip?.(bn, "entry too large"); return false; }
        if (budget.bytes + f.originalSize > MAX_TOTAL_BYTES) { onSkip?.(bn, "zip decompressed-size cap reached"); return false; }
        budget.entries += 1;
        budget.bytes += f.originalSize;
        return true;
      },
    }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

// Wrap a raster image into a single-page PDF at its native pixel size so it flows
// through the same pdf.js path as a real plan. JPG/PNG embed directly; webp/gif/
// bmp are decoded by the browser and re-encoded as PNG.
async function imageToPdf(file) {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await PDFDocument.create();
  let img, w, h;
  if (/\.jpe?g$/i.test(file.name) || file.type === "image/jpeg") {
    img = await doc.embedJpg(bytes); w = img.width; h = img.height;
  } else if (/\.png$/i.test(file.name) || file.type === "image/png") {
    img = await doc.embedPng(bytes); w = img.width; h = img.height;
  } else {
    const bmp = await createImageBitmap(new Blob([bytes], { type: file.type || "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext("2d").drawImage(bmp, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer())); w = bmp.width; h = bmp.height;
  }
  doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  const name = baseName(file.name).replace(IMAGE_EXT, "") + ".pdf";
  return new File([await doc.save()], name, { type: "application/pdf" });
}

export async function ingestFiles(fileList, { onProgress } = {}) {
  const incoming = Array.from(fileList || []);
  const pdfs = [];
  const skipped = [];
  const used = new Set();

  // store keys by name; de-dupe within the batch so two "A1.pdf" from different
  // zip folders don't overwrite each other
  const uniqueName = (name) => {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let n = name, i = 2;
    while (used.has(n.toLowerCase())) n = `${stem} (${i++})${ext}`;
    used.add(n.toLowerCase());
    return n;
  };
  const pushPdf = (file) => {
    const name = uniqueName(file.name);
    pdfs.push(name === file.name ? file : new File([file], name, { type: "application/pdf" }));
  };

  // one budget per drop: nested zips draw from the same entry/byte caps
  const budget = { entries: 0, bytes: 0 };

  async function process(file, depth = 0) {
    const name = file.name || "file";
    try {
      if (isPdf(name, file.type)) { pushPdf(file); return; }
      if (isImage(name, file.type)) { onProgress?.(`Converting ${baseName(name)}…`); pushPdf(await imageToPdf(file)); return; }
      if (isZip(name, file.type) || (await looksLikeZip(file))) {
        if (depth >= MAX_ZIP_DEPTH) { skipped.push({ name: baseName(name), reason: `zip nested deeper than ${MAX_ZIP_DEPTH} levels` }); return; }
        onProgress?.(`Unzipping ${baseName(name)}…`);
        const entries = await unzipBytes(new Uint8Array(await file.arrayBuffer()),
          (bn, reason) => skipped.push({ name: bn, reason }), budget);
        const paths = Object.keys(entries);
        if (!paths.length) { skipped.push({ name: baseName(name), reason: "no plans found in zip" }); return; }
        for (const path of paths) {
          const bn = baseName(path);
          if (isPdf(bn)) pushPdf(new File([entries[path]], bn, { type: "application/pdf" }));
          else if (isImage(bn)) { onProgress?.(`Converting ${bn}…`); pushPdf(await imageToPdf(new File([entries[path]], bn))); }
          else if (isZip(bn)) await process(new File([entries[path]], bn, { type: "application/zip" }), depth + 1);
        }
        return;
      }
      skipped.push({ name: baseName(name), reason: "unsupported type" });
    } catch (e) {
      skipped.push({ name: baseName(name), reason: (e && e.message) || "couldn't read" });
    }
  }

  for (const f of incoming) await process(f);
  return { pdfs, skipped };
}
