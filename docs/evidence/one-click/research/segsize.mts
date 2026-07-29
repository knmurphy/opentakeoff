// Research probe (throwaway) — run: node --import tsx docs/evidence/one-click/research/<file>.mts
// Run from anywhere; paths are absolute to this checkout. Not part of `npm run bench`.
// Research probe (throwaway): §3 segments-only fixtures — measure the real
// repo cost and verify the round-trip claim. Serializes each demo plan's
// extracted geometry three ways and checks bit-exactness.
import { createRequire } from "module";
import { gzipSync } from "zlib";
import { extractVectorGeometry } from "../../../../web/src/lib/oneclick.ts";

const req = createRequire(import.meta.url);
const pdfjs = await import(req.resolve("/home/user/opentakeoff/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs"));
const PLANS = [
  { name: "sample-plan", pdf: "/home/user/opentakeoff/demo/sample-plan.pdf", scale: 2 },
  { name: "va-finish-plan", pdf: "/home/user/opentakeoff/demo/sample-finish-plan.pdf", scale: 2 },
];
const MB = (n: number) => (n / 1048576).toFixed(2) + " MB";

for (const p of PLANS) {
  const doc = await pdfjs.getDocument({ url: p.pdf, useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: p.scale });
  const ops = await page.getOperatorList();
  const g = extractVectorGeometry(ops, vp.transform, pdfjs.OPS);
  const segCount = g.segs.length / 4;

  const decimal = JSON.stringify(g.segs);
  const f64 = new Float64Array(g.segs);
  const b64 = Buffer.from(f64.buffer).toString("base64");
  const metaB64 = g.meta ? Buffer.from(g.meta).toString("base64") : "";
  const gz = gzipSync(Buffer.from(f64.buffer));

  // round-trip fidelity
  const bb = Buffer.from(b64, "base64");
  const back = new Float64Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
  let exact = back.length === g.segs.length;
  if (exact) for (let i = 0; i < back.length; i++) if (back[i] !== g.segs[i]) { exact = false; break; }
  const backDec = JSON.parse(decimal) as number[];
  let exactDec = backDec.length === g.segs.length;
  if (exactDec) for (let i = 0; i < backDec.length; i++) if (backDec[i] !== g.segs[i]) { exactDec = false; break; }
  const f32 = new Float32Array(g.segs);
  let f32Exact = true;
  for (let i = 0; i < f32.length; i++) if (f32[i] !== g.segs[i]) { f32Exact = false; break; }

  console.log(`\n== ${p.name} == ${Math.round(vp.width)}x${Math.round(vp.height)} px · ${segCount} segments · meta ${g.meta ? g.meta.length : 0} B`);
  console.log(`  decimal JSON array   ${MB(Buffer.byteLength(decimal))}   exact round-trip: ${exactDec}`);
  console.log(`  Float64 base64       ${MB(Buffer.byteLength(b64))}   exact round-trip: ${exact}`);
  console.log(`  Float64 raw (binary) ${MB(f64.byteLength)}`);
  console.log(`  Float64 gzip(binary) ${MB(gz.byteLength)}`);
  console.log(`  meta base64          ${MB(Buffer.byteLength(metaB64))}`);
  console.log(`  Float32 would be lossless? ${f32Exact}`);
}
