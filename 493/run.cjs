const { chromium } = require("playwright");
const [, , url, label] = process.argv;
(async () => {
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.goto(url); await p.waitForTimeout(2500);
  const input = p.locator('input[type=file]').first();
  // two separate handleFiles calls, back to back, same name, different bytes
  await Promise.all([input.setInputFiles(`${__dirname}/a/plan.pdf`), input.setInputFiles(`${__dirname}/b/plan.pdf`)]);
  await p.waitForTimeout(6000);
  const state = await p.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("opentakeoff"); r.onsuccess = () => { const db = r.result; const t = db.transaction(["pdfs", "pdf_revs"]); const out = { pdfs: [], revs: [] };
      t.objectStore("pdfs").openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.pdfs.push({ name: c.value.name, rev: c.value.rev, size: c.value.bytes.byteLength }); c.continue(); } };
      t.objectStore("pdf_revs").openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.revs.push({ name: c.value.name, rev: c.value.rev, size: c.value.bytes.byteLength }); c.continue(); } };
      t.oncomplete = () => { db.close(); res(out); }; };
  }));
  await p.screenshot({ path: `${__dirname}/${label}.png` });
  console.log(label, JSON.stringify(state));
  await b.close();
})();
