// ACCEPTANCE TEST for the golden re-pin protocol (remediation task 0.9).
//
// This is not a unit test of a helper. It replays THE re-pin that concealed
// this repo's worst measurement regression through the live checker in
// `bench/pin-goldens.mts`, and asserts the checker fires on it.
//
//   2730050 → 92c1242 ("Item C: periodicity-based hatch classification …")
//     patient-room-137:  240.77 → 161.91 SF   = −32.75%   ← shipped as an improvement
//     case total:       2476.72 → 2489.50 SF  =  +0.52%   ← which is why nobody looked
//
// The case total barely moved because a NEW probe (`patient-toilet-137a`,
// 41.15 SF) was added in the very same commit that took 79 SF off the patient
// room. A whole-case invariant — the obvious thing to build — would have waved
// this through. Only the per-probe rule catches it, and the test below asserts
// exactly that: `caseTotal.flagged` is FALSE and `overlap.flagged` is FALSE on
// the historical event, while the per-probe row for `patient-room-137` fails.
//
// Negative control: 92c1242 → 2ea5487 moves the same probe 161.91 → 161.37 SF
// (−0.33%) and must NOT flag, or the protocol is just noise.
//
// Fixtures are the real golden rings from those three commits, embedded
// verbatim (`git show <sha>:web/bench/corpus/va-finish-plan.json`) so the test
// never shells out to git and survives history rewrites. Areas are shoelace at
// ptPerFt 18, which is what those corpus files carry.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffRepin, parseRepinArgs, ringSF, formatRepinDiff, REPIN_LIMITS,
  CASE_TOTAL_KEY, OVERLAP_KEY,
  type RepinProbeInput, type CaseRepinDiff, type ProbeDelta,
} from "../bench/pin-goldens.mts";
import type { Point } from "../src/lib/oneclick.ts";

const PT_PER_FT = 18;   // image px per foot at the corpus scale (scale 2, 1/8" plan)
const near = (a: number, b: number, tol: number, what: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: expected ≈${b}, got ${a} (tol ${tol})`);
const row = (d: CaseRepinDiff, name: string): ProbeDelta => {
  const r = d.probes.find((p) => p.name === name);
  assert.ok(r, `no diff row for ${name}`);
  return r!;
};
/** failures naming EXACTLY this probe — `patient-room-137` is a prefix of
 *  `patient-room-137-band`, and a loose substring match would confuse them. */
const failuresFor = (d: CaseRepinDiff, name: string) => d.failures.filter((f) => f.includes(`/ ${name}:`));

// ── fixtures: golden rings as pinned at each commit ─────────────────────────
const AT_2730050: RepinProbeInput[] = [
  { name: "patient-room-137", golden: [[2538.1,707.6],[2768,707.6],[2768,1181.4],[2564.4,1181.4],[2689.3,1179.4],[2693.4,1157.2],[2743.8,1157.2],[2745.8,1153.2],[2693.4,1151.1],[2693.4,1129],[2705.5,1131],[2707.5,1118.9],[2693.4,1120.9],[2689.3,999.9],[2566.4,999.9],[2566.4,903.2],[2538.1,901.2]] },
  { name: "elevator-e01", golden: [[2507.9,1518],[2511.9,1530.1],[2514,1518],[2538.1,1518],[2540.2,1550.3],[2564.4,1550.3],[2566.4,1540.2],[2723.6,1540.2],[2723.6,1661.2],[2566.4,1661.2],[2566.4,1628.9],[2538.1,1628.9],[2540.2,1673.3],[2628.9,1673.3],[2628.9,1711.6],[2602.7,1717.6],[2590.6,1725.7],[2572.4,1747.9],[2566.4,1764],[2568.4,1780.1],[2628.9,1780.1],[2628.9,1828.5],[2514,1828.5],[2511.9,1822.5],[2507.9,1828.5]] },
  { name: "ward-room-294sf", golden: [[4028,485.9],[4082.4,485.9],[4084.4,512.1],[4116.7,512.1],[4116.7,727.8],[4112.6,731.8],[4122.7,733.8],[4122.7,788.3],[4106.6,794.3],[4116.7,796.3],[4116.7,1080.6],[4082.4,1090.7],[4062.2,1110.8],[4056.2,1129],[4044.1,1108.8],[4028,1137],[4019.9,1129],[3987.6,1155.2],[3987.6,1131],[3993.7,1129],[3993.7,1054.4],[4001.8,1040.3],[3999.7,911.2],[4034,909.2],[4001.8,907.2],[4001.8,887],[3993.7,874.9],[3993.7,796.3],[4019.9,794.3],[3993.7,788.3],[3993.7,733.8],[3997.7,731.8],[3993.7,729.8],[3993.7,512.1],[4026,512.1]] },
  { name: "ward-vestibule", golden: [[4023.9,1131],[4028,1135],[4026,1145.1],[4054.2,1145.1],[4054.2,1161.2],[4062.2,1179.4],[4084.4,1201.5],[4116.7,1209.6],[4116.7,1264],[4114.7,1260],[4100.5,1260],[4084.4,1268.1],[4068.3,1284.2],[4062.2,1306.4],[4060.2,1298.3],[3971.5,1298.3],[3969.5,1306.4],[3969.5,1290.2],[3953.4,1288.2],[4013.9,1288.2],[4015.9,1272.1],[3991.7,1235.8],[3971.5,1223.7],[3953.4,1221.7],[3953.4,1167.3],[3971.5,1171.3]] },
  { name: "cloud-corridor", golden: [[778.2,512.1],[1116.9,512.1],[1116.9,1421.3],[1108.8,1421.3],[1106.8,1427.3],[961.6,1427.3],[959.6,1421.3],[941.5,1421.3],[939.5,1427.3],[921.3,1429.3],[923.3,1443.5],[937.4,1443.5],[937.4,1673.3],[1272.1,1675.3],[1274.1,1691.4],[1290.2,1713.6],[1326.5,1675.3],[1647.1,1675.3],[1691.4,1719.6],[1709.6,1693.4],[1711.6,1675.3],[1939.4,1675.3],[1983.7,1719.6],[2001.9,1693.4],[2003.9,1675.3],[2040.2,1675.3],[2040.2,1828.5],[1895,1828.5],[1893,1810.4],[1874.9,1784.2],[1830.5,1828.5],[1705.5,1828.5],[1661.2,1784.2],[1647.1,1802.3],[1641,1828.5],[1483.8,1828.5],[1439.4,1784.2],[1421.3,1810.4],[1419.3,1828.5],[1334.6,1828.5],[1290.2,1784.2],[1272.1,1810.4],[1270.1,1828.5],[891.1,1828.5],[889.1,1933.3],[883,1933.3],[838.7,1889],[820.5,1915.2],[818.5,1933.3],[764.1,1933.3],[764.1,1812.4],[782.2,1794.2],[774.1,1786.2],[764.1,1784.2],[764.1,1764],[808.4,1719.6],[782.2,1701.5],[764.1,1699.5],[764.1,1441.4],[778.2,1439.4],[778.2,1249.9],[806.4,1241.9],[822.5,1229.8],[778.2,1183.4]] },
  { name: "shaded-wing-office", golden: [[473.8,1447.5],[588.7,1447.5],[590.7,1485.8],[627,1483.8],[627,1447.5],[639.1,1447.5],[641.1,1473.7],[669.3,1473.7],[671.3,1447.5],[683.4,1447.5],[685.4,1473.7],[713.7,1473.7],[715.7,1447.5],[752,1447.5],[752,1536.2],[707.6,1580.5],[725.8,1594.7],[752,1600.7],[752,1608.8],[516.1,1608.8],[514.1,1731.7],[493.9,1731.7],[493.9,1725.7],[506,1711.6],[495.9,1689.4],[483.8,1689.4],[471.7,1699.5],[471.7,1711.6],[481.8,1731.7],[457.6,1731.7],[457.6,1538.2],[473.8,1536.2],[473.8,1487.8],[493.9,1497.9],[506,1497.9],[518.1,1483.8],[508,1465.6],[495.9,1465.6],[473.8,1475.7]] },
  { name: "open-margin" },
];

const AT_92C1242: RepinProbeInput[] = [
  { name: "patient-room-137", golden: [[2564.4,707.6],[2759.9,707.6],[2741.8,733.8],[2669.2,733.8],[2667.2,721.7],[2645,721.7],[2643,733.8],[2576.4,735.8],[2643,737.9],[2645,747.9],[2667.2,747.9],[2669.2,737.9],[2741.8,737.9],[2745.8,741.9],[2743.8,933.4],[2733.7,935.4],[2733.7,957.6],[2743.8,959.6],[2745.8,1155.2],[2743.8,1151.1],[2693.4,1151.1],[2693.4,1129],[2707.5,1129],[2701.4,1102.8],[2701.4,997.9],[2693.4,995.9],[2717.6,993.9],[2715.6,969.7],[2693.4,969.7],[2691.4,981.8],[2584.5,981.8],[2570.4,995.9],[2576.4,979.8],[2576.4,836.6],[2586.5,834.6],[2586.5,812.4],[2576.4,810.4],[2576.4,747.9],[2542.2,709.6]] },
  { name: "patient-toilet-137a", golden: [[2566.4,1012],[2612.7,1016.1],[2606.7,1036.2],[2612.7,1040.3],[2618.8,1066.5],[2626.8,1066.5],[2626.8,1056.4],[2681.3,1056.4],[2679.3,1120.9],[2667.2,1118.9],[2665.2,1122.9],[2641,1124.9],[2665.2,1126.9],[2667.2,1131],[2679.3,1129],[2681.3,1173.3],[2590.6,1171.3],[2600.6,1171.3],[2606.7,1157.2],[2600.6,1131],[2590.6,1137],[2582.5,1137],[2584.5,1133],[2576.4,1131],[2576.4,1153.2],[2570.4,1155.2]] },
  { name: "elevator-e01", golden: [[2507.9,1518],[2511.9,1530.1],[2514,1518],[2538.1,1518],[2540.2,1550.3],[2564.4,1550.3],[2566.4,1540.2],[2723.6,1540.2],[2723.6,1661.2],[2566.4,1661.2],[2566.4,1628.9],[2538.1,1628.9],[2540.2,1673.3],[2628.9,1673.3],[2628.9,1772.1],[2566.4,1774.1],[2568.4,1780.1],[2628.9,1780.1],[2628.9,1828.5],[2514,1828.5],[2511.9,1822.5],[2507.9,1828.5]] },
  { name: "ward-room-294sf", golden: [[4028,485.9],[4082.4,485.9],[4084.4,512.1],[4116.7,512.1],[4116.7,731.8],[4122.7,733.8],[4122.7,788.3],[4106.6,794.3],[4116.7,796.3],[4116.7,1080.6],[4108.6,1082.6],[4108.6,1092.7],[4114.7,1145.1],[4122.7,1147.1],[4122.7,1205.6],[4096.5,1203.6],[4066.3,1179.4],[4058.2,1161.2],[4062.2,1139],[4056.2,1135],[4056.2,1126.9],[4044.1,1108.8],[4028,1137],[4019.9,1129],[3987.6,1155.2],[3987.6,1131],[3993.7,1129],[3993.7,1054.4],[4001.8,1040.3],[3999.7,911.2],[4034,909.2],[4001.8,907.2],[4001.8,887],[3993.7,874.9],[3993.7,796.3],[4017.9,796.3],[4021.9,792.3],[4017.9,788.3],[3993.7,788.3],[3993.7,512.1],[4026,512.1]] },
  { name: "ward-vestibule", golden: [[4023.9,1131],[4028,1135],[4026,1145.1],[4054.2,1145.1],[4054.2,1161.2],[4062.2,1179.4],[4084.4,1201.5],[4116.7,1209.6],[4116.7,1264],[4114.7,1260],[4100.5,1260],[4084.4,1268.1],[4068.3,1284.2],[4062.2,1306.4],[4060.2,1298.3],[3989.7,1298.3],[4003.8,1288.2],[4013.9,1288.2],[4015.9,1272.1],[4007.8,1243.9],[3991.7,1231.8],[3997.7,1219.7],[3995.7,1207.6],[3975.6,1195.5],[3967.5,1173.3]] },
  { name: "cloud-corridor", golden: [[778.2,512.1],[1116.9,512.1],[1116.9,1421.3],[1108.8,1421.3],[1106.8,1427.3],[961.6,1427.3],[959.6,1421.3],[941.5,1421.3],[939.5,1427.3],[921.3,1429.3],[923.3,1443.5],[937.4,1443.5],[937.4,1673.3],[1270.1,1675.3],[1272.1,1665.2],[1324.5,1665.2],[1276.1,1667.2],[1278.1,1671.3],[1324.5,1671.3],[1290.2,1705.5],[1292.3,1709.6],[1326.5,1675.3],[1647.1,1675.3],[1689.4,1715.6],[1691.4,1711.6],[1649.1,1665.2],[1711.6,1665.2],[1713.6,1675.3],[1939.4,1675.3],[1981.7,1715.6],[1983.7,1711.6],[1941.4,1665.2],[2003.9,1665.2],[2005.9,1675.3],[2040.2,1675.3],[2040.2,1828.5],[1897.1,1828.5],[1895,1836.6],[1832.5,1836.6],[1874.9,1792.2],[1872.9,1788.2],[1830.5,1828.5],[1705.5,1828.5],[1661.2,1782.1],[1443.5,1782.1],[1439.4,1792.2],[1481.8,1836.6],[1419.3,1836.6],[1417.2,1828.5],[1334.6,1828.5],[1292.3,1788.2],[1290.2,1792.2],[1332.6,1836.6],[1270.1,1836.6],[1268.1,1828.5],[891.1,1828.5],[889.1,1933.3],[883,1933.3],[842.7,1893],[838.7,1895],[881,1941.4],[818.5,1941.4],[816.5,1933.3],[764.1,1933.3],[764.1,1812.4],[778.2,1796.3],[774.1,1794.2],[756,1810.4],[756,1784.2],[764.1,1782.1],[764.1,1764],[804.4,1723.7],[800.4,1719.6],[756,1762],[756,1699.5],[764.1,1697.5],[764.1,1441.4],[778.2,1439.4],[778.2,1191.5],[818.5,1227.7],[778.2,1183.4]] },
  { name: "shaded-wing-office", golden: [[473.8,1447.5],[588.7,1447.5],[590.7,1485.8],[627,1483.8],[627,1447.5],[639.1,1447.5],[641.1,1473.7],[669.3,1473.7],[671.3,1447.5],[683.4,1447.5],[685.4,1473.7],[713.7,1473.7],[715.7,1447.5],[752,1447.5],[752,1536.2],[711.6,1578.5],[715.7,1580.5],[760,1538.2],[760,1596.7],[752,1600.7],[752,1608.8],[516.1,1608.8],[514.1,1731.7],[493.9,1731.7],[493.9,1725.7],[504,1715.6],[500,1709.6],[493.9,1711.6],[489.9,1723.7],[481.8,1725.7],[481.8,1731.7],[457.6,1731.7],[457.6,1538.2],[473.8,1536.2],[473.8,1487.8],[481.8,1487.8],[495.9,1473.7],[489.9,1467.6],[473.8,1475.7]] },
  { name: "open-margin" },
];

const AT_2EA5487: RepinProbeInput[] = [
  { name: "patient-room-137", golden: [[2564.4,707.6],[2759.9,707.6],[2741.8,733.8],[2669.2,733.8],[2667.2,721.7],[2645,721.7],[2643,733.8],[2576.4,735.8],[2643,737.9],[2645,747.9],[2667.2,747.9],[2669.2,737.9],[2741.8,737.9],[2745.8,741.9],[2743.8,933.4],[2733.7,935.4],[2733.7,957.6],[2743.8,959.6],[2743.8,1145.1],[2749.8,1153.2],[2745.8,1155.2],[2741.8,1151.1],[2693.4,1151.1],[2693.4,1129],[2707.5,1129],[2705.5,1106.8],[2693.4,1100.7],[2701.4,1098.7],[2701.4,997.9],[2693.4,995.9],[2717.6,993.9],[2715.6,969.7],[2693.4,969.7],[2691.4,981.8],[2584.5,981.8],[2570.4,995.9],[2576.4,979.8],[2576.4,836.6],[2586.5,834.6],[2586.5,812.4],[2576.4,810.4],[2576.4,747.9],[2542.2,709.6]] },
  { name: "patient-room-137-band", golden: [[2538.1,709.6],[2572.4,747.9],[2572.4,810.4],[2560.3,812.4],[2560.3,834.6],[2572.4,836.6],[2572.4,979.8],[2566.4,995.9],[2566.4,903.2],[2538.1,901.2]] },
  { name: "patient-toilet-137a", golden: [[2566.4,1016.1],[2612.7,1016.1],[2606.7,1036.2],[2612.7,1040.3],[2618.8,1068.5],[2681.3,1066.5],[2679.3,1120.9],[2665.2,1120.9],[2667.2,1131],[2679.3,1129],[2681.3,1175.3],[2600.6,1171.3],[2606.7,1157.2],[2604.7,1147.1],[2594.6,1147.1],[2602.7,1141.1],[2600.6,1131],[2590.6,1137],[2586.5,1131],[2576.4,1131],[2574.4,1143.1],[2580.5,1147.1],[2570.4,1149.1]] },
  { name: "elevator-e01", golden: [[2507.9,1518],[2511.9,1530.1],[2514,1518],[2538.1,1518],[2540.2,1550.3],[2564.4,1550.3],[2566.4,1540.2],[2723.6,1540.2],[2723.6,1661.2],[2566.4,1661.2],[2566.4,1628.9],[2538.1,1628.9],[2540.2,1673.3],[2628.9,1673.3],[2628.9,1772.1],[2566.4,1774.1],[2568.4,1780.1],[2628.9,1780.1],[2628.9,1828.5],[2514,1828.5],[2511.9,1822.5],[2507.9,1828.5]] },
  { name: "ward-room-294sf", golden: [[4028,485.9],[4082.4,485.9],[4084.4,512.1],[4116.7,512.1],[4116.7,731.8],[4122.7,733.8],[4122.7,788.3],[4106.6,794.3],[4116.7,796.3],[4116.7,1080.6],[4082.4,1090.7],[4062.2,1110.8],[4056.2,1129],[4044.1,1108.8],[4028,1137],[4019.9,1129],[3987.6,1155.2],[3987.6,1131],[3993.7,1129],[3993.7,1054.4],[4001.8,1040.3],[3999.7,911.2],[4034,909.2],[4001.8,907.2],[4001.8,887],[3993.7,874.9],[3993.7,796.3],[4017.9,796.3],[4021.9,792.3],[4017.9,788.3],[3993.7,788.3],[3993.7,512.1],[4026,512.1]] },
  { name: "ward-vestibule", golden: [[4023.9,1131],[4028,1135],[4026,1145.1],[4054.2,1145.1],[4054.2,1161.2],[4062.2,1179.4],[4084.4,1201.5],[4116.7,1209.6],[4116.7,1264],[4112.6,1260],[4106.6,1266],[4108.6,1306.4],[4064.3,1308.4],[4060.2,1298.3],[4015.9,1298.3],[4013.9,1306.4],[3969.5,1306.4],[3969.5,1290.2],[3953.4,1288.2],[4015.9,1286.2],[4013.9,1282.2],[3953.4,1282.2],[3953.4,1165.2],[3959.4,1161.2],[3985.6,1161.2]] },
  { name: "cloud-corridor", golden: [[778.2,512.1],[1116.9,512.1],[1116.9,1421.3],[1108.8,1421.3],[1106.8,1427.3],[961.6,1427.3],[959.6,1421.3],[941.5,1421.3],[939.5,1427.3],[921.3,1429.3],[923.3,1443.5],[937.4,1443.5],[937.4,1673.3],[1270.1,1675.3],[1272.1,1665.2],[1324.5,1665.2],[1324.5,1671.3],[1290.2,1705.5],[1292.3,1709.6],[1326.5,1675.3],[1647.1,1675.3],[1689.4,1715.6],[1691.4,1711.6],[1649.1,1665.2],[1711.6,1665.2],[1713.6,1675.3],[1939.4,1675.3],[1981.7,1715.6],[1983.7,1711.6],[1941.4,1665.2],[2003.9,1665.2],[2005.9,1675.3],[2040.2,1675.3],[2040.2,1828.5],[1897.1,1828.5],[1895,1836.6],[1832.5,1836.6],[1874.9,1792.2],[1872.9,1788.2],[1830.5,1828.5],[1705.5,1828.5],[1657.2,1782.1],[1443.5,1782.1],[1439.4,1792.2],[1481.8,1836.6],[1419.3,1836.6],[1417.2,1828.5],[1334.6,1828.5],[1292.3,1788.2],[1290.2,1792.2],[1332.6,1836.6],[1270.1,1836.6],[1268.1,1828.5],[891.1,1828.5],[889.1,1933.3],[883,1933.3],[842.7,1893],[838.7,1895],[881,1941.4],[818.5,1941.4],[816.5,1933.3],[764.1,1933.3],[764.1,1812.4],[778.2,1796.3],[774.1,1794.2],[756,1810.4],[756,1784.2],[764.1,1782.1],[764.1,1764],[804.4,1723.7],[800.4,1719.6],[756,1762],[756,1699.5],[764.1,1697.5],[764.1,1441.4],[778.2,1439.4],[778.2,1191.5],[818.5,1227.7],[778.2,1183.4]] },
  { name: "shaded-wing-office", golden: [[473.8,1447.5],[588.7,1447.5],[590.7,1485.8],[627,1483.8],[627,1447.5],[639.1,1447.5],[641.1,1473.7],[669.3,1473.7],[671.3,1447.5],[683.4,1447.5],[685.4,1473.7],[713.7,1473.7],[715.7,1447.5],[752,1447.5],[752,1536.2],[711.6,1578.5],[715.7,1580.5],[760,1538.2],[760,1596.7],[752,1600.7],[752,1608.8],[516.1,1608.8],[514.1,1731.7],[493.9,1731.7],[493.9,1725.7],[504,1715.6],[500,1709.6],[493.9,1711.6],[489.9,1723.7],[481.8,1725.7],[481.8,1731.7],[457.6,1731.7],[457.6,1538.2],[473.8,1536.2],[473.8,1487.8],[481.8,1487.8],[495.9,1473.7],[489.9,1467.6],[473.8,1475.7]] },
  { name: "open-margin" },
];

// ── the historical event ────────────────────────────────────────────────────

const replay = (oldProbes: RepinProbeInput[] | null, newProbes: RepinProbeInput[], adjudications?: Map<string, string>) =>
  diffRepin({ caseFile: "va-finish-plan.json", oldProbes, newProbes, pxPerFt: PT_PER_FT, adjudications });

// The two historical replays are ~1s of IoU rasterisation each and several
// tests need them, so compute each once. `diffRepin` is pure, so sharing the
// result between tests changes nothing about what is asserted.
let _regression: CaseRepinDiff | null = null, _control: CaseRepinDiff | null = null;
/** 2730050 → 92c1242 — the re-pin that shipped the −33% regression. */
const regression = () => (_regression ??= replay(AT_2730050, AT_92C1242));
/** 92c1242 → 2ea5487 — the negative control. */
const control = () => (_control ??= replay(AT_92C1242, AT_2EA5487));

test("fixtures reproduce the historical SF values (shoelace at ptPerFt 18)", () => {
  const sfOf = (probes: RepinProbeInput[], name: string) =>
    ringSF(probes.find((p) => p.name === name)!.golden as Point[], PT_PER_FT);
  near(sfOf(AT_2730050, "patient-room-137"), 240.77, 0.01, "patient-room-137 @2730050");
  near(sfOf(AT_92C1242, "patient-room-137"), 161.91, 0.01, "patient-room-137 @92c1242");
  near(sfOf(AT_2EA5487, "patient-room-137"), 161.37, 0.01, "patient-room-137 @2ea5487");
  near(sfOf(AT_92C1242, "patient-toilet-137a"), 41.15, 0.01, "the toilet probe added in 92c1242");
});

test("ACCEPTANCE: replaying 2730050 → 92c1242 flags patient-room-137 at −32.75%", () => {
  const d = regression();
  const r = row(d, "patient-room-137");

  near(r.oldSF!, 240.77, 0.01, "old SF");
  near(r.newSF!, 161.91, 0.01, "new SF");
  near(r.deltaPct! * 100, -32.75, 0.02, "Δ%");
  assert.equal(r.verdict, "moved");
  assert.equal(r.flagged, true, "a −32.75% move MUST flag");
  // area is not the whole story: a third of the room's floor is gone, and the
  // old and new rings only share two thirds of their union.
  assert.ok(r.iou! < 0.75, `IoU(old,new) should show the loss, got ${r.iou}`);

  assert.equal(d.ok, false, "the re-pin must be refused");
  const msg = failuresFor(d, "patient-room-137")[0];
  assert.ok(msg, `no failure names patient-room-137: ${JSON.stringify(d.failures)}`);
  assert.ok(msg.includes("-32.7"), `the failure must quote the move, got: ${msg}`);
  assert.ok(msg.includes("--adjudicate"), "the failure must say how to adjudicate");
});

test("that one commit moved FIVE probes past ±2.5% — none of it was reported at the time", () => {
  // Not decoration: it is the measure of how much a case-total-only check hides.
  // 2730050 → 92c1242 is remembered as "the patient room changed"; in fact every
  // number below moved, and the case total still read +0.5%.
  const d = regression();
  const moved = Object.fromEntries(d.probes.filter((p) => p.verdict === "moved").map((p) => [p.name, +(p.deltaPct! * 100).toFixed(2)]));
  assert.deepEqual(moved, {
    "patient-room-137": -32.75,
    "elevator-e01": 7.02,
    "ward-room-294sf": 7.69,
    "ward-vestibule": -13.36,
    "shaded-wing-office": 7.10,
  });
  // cloud-corridor (1684.77 → 1705.14 SF, +1.21%) is the only probe inside the
  // band — and it is 68% of the case total, which is why the total barely moved.
  assert.equal(row(d, "cloud-corridor").flagged, false);
  near(row(d, "cloud-corridor").deltaPct! * 100, 1.21, 0.02, "cloud-corridor Δ%");
  assert.ok(row(d, "cloud-corridor").newSF! / d.caseTotal.newSF > 0.6,
    "the corridor dominates the case total — a per-room failure is arithmetically invisible in it");
});

test("ACCEPTANCE: the whole-case invariants do NOT fire on that event — the per-probe rule is the guard", () => {
  const d = regression();

  // The exact numbers from the plan: the case total moved half a percent.
  near(d.caseTotal.oldSF, 2476.72, 0.05, "case total @2730050");
  near(d.caseTotal.newSF, 2489.50, 0.05, "case total @92c1242");
  near(d.caseTotal.deltaPct! * 100, +0.52, 0.05, "case-total Δ%");
  assert.equal(d.caseTotal.flagged, false,
    "the case total sat INSIDE ±2.5% — this is precisely why the regression shipped");

  // …and so did adjacency: no two probes claim the same floor.
  assert.ok(d.overlap.frac < REPIN_LIMITS.overlapFrac,
    `pairwise overlap ${(d.overlap.frac * 100).toFixed(3)}% should be inside the band`);
  assert.equal(d.overlap.flagged, false);

  // The counterfactual, stated as an assertion: a protocol built on the
  // whole-case checks alone — the obvious design — would have PASSED this.
  const wholeCaseOnlyWouldPass = !d.caseTotal.flagged && !d.overlap.flagged;
  assert.equal(wholeCaseOnlyWouldPass, true,
    "if this ever becomes false the fixtures drifted; the point of 0.9 is that whole-case checks miss bug #17");
  assert.equal(d.probes.some((p) => p.flagged), true, "…while the per-probe rule catches it");
});

test("ACCEPTANCE: the probe ADDED in the same commit is flagged too — that is the masking mechanism", () => {
  const d = regression();
  const toilet = row(d, "patient-toilet-137a");
  assert.equal(toilet.verdict, "added");
  assert.equal(toilet.oldSF, null);
  near(toilet.newSF!, 41.15, 0.01, "new toilet probe SF");
  assert.equal(toilet.flagged, true,
    "adding 41 SF of new probe in the commit that lost 79 SF is exactly what flattened the case total");
  assert.ok(d.failures.some((f) => f.includes("patient-toilet-137a") && f.includes("ADDED")));
});

test("NEGATIVE CONTROL: 92c1242 → 2ea5487 moves patient-room-137 −0.33% and must NOT flag", () => {
  const d = control();
  const r = row(d, "patient-room-137");

  near(r.oldSF!, 161.91, 0.01, "old SF");
  near(r.newSF!, 161.37, 0.01, "new SF");
  near(r.deltaPct! * 100, -0.33, 0.02, "Δ%");
  assert.equal(r.verdict, "unchanged");
  assert.equal(r.flagged, false, "−0.33% is inside the band and must pass silently");
  assert.ok(r.iou! > 0.95, `nearly the same ring, got IoU ${r.iou}`);
  assert.deepEqual(failuresFor(d, "patient-room-137"), [],
    `patient-room-137 must not appear in the failures: ${JSON.stringify(d.failures)}`);
});

test("NEGATIVE CONTROL is scoped: that same re-pin still fails on OTHER probes, as it should", () => {
  // Honesty about what the control does and does not say. 92c1242 → 2ea5487 was
  // itself a substantial re-pin: ward-vestibule +51%, ward-room-294sf −7%, the
  // toilet −4.7%, and a new `patient-room-137-band` probe. The control asserts
  // only that patient-room-137 is quiet; the rest SHOULD be loud.
  const d = control();
  assert.equal(d.ok, false);
  near(row(d, "ward-vestibule").deltaPct! * 100, +51.13, 0.1, "ward-vestibule Δ%");
  assert.equal(row(d, "ward-vestibule").flagged, true);
  assert.equal(row(d, "ward-room-294sf").flagged, true);
  assert.equal(row(d, "patient-toilet-137a").flagged, true);
  // the band probe was ADDED to an existing case — same shape as the toilet
  // probe one commit earlier, so it does not pass unexamined either
  assert.equal(row(d, "patient-room-137-band").verdict, "added");
  assert.equal(row(d, "patient-room-137-band").flagged, true);
  // refusal probes carry no golden and are not measurements
  assert.equal(row(d, "open-margin").verdict, "refusal");
  assert.equal(row(d, "open-margin").flagged, false);
});

test("a renamed probe reads as removed + added — a rename is a place to hide a regression", () => {
  const d = replay([{ name: "ward-room-294sf", golden: rect(100, 100) }],
    [{ name: "ward-room", golden: rect(70, 100) }]);
  assert.equal(row(d, "ward-room-294sf").verdict, "removed");
  assert.equal(row(d, "ward-room-294sf").flagged, true);
  assert.equal(row(d, "ward-room").verdict, "added");
  assert.equal(row(d, "ward-room").flagged, true);
  assert.equal(d.ok, false, "renaming a probe must not launder a −30% move into two clean rows");
});

// ── the escape hatch, and its locks ─────────────────────────────────────────

/** every 2730050 → 92c1242 row the protocol demands an answer for. Six probes —
 *  which is the honest price of that commit, and the point: the protocol makes
 *  you write six sentences instead of reading one +0.5% and moving on. */
const REASONS_92C1242 = new Map([
  ["patient-room-137", "arcs are recognised as arcs now, so the escalated fill no longer walks through the doorway and annexes the toilet — reviewed on screen"],
  ["patient-toilet-137a", "the toilet's PT tile is its own finish zone and now has its own probe rather than being absorbed by the patient room"],
  ["elevator-e01", "polyline-arc door recognition adds the entry swing wedge that the old classifier dropped, reviewed against the plan"],
  ["ward-room-294sf", "the ward's double doors unify as a recognised arc pair, so the click measures through the open pair as drawn"],
  ["ward-vestibule", "the vestibule keeps only the complementary side of the double door now that the ward room reaches its swing arc"],
  ["shaded-wing-office", "the shaded wing's hatch is classified by periodicity rather than stroke density, so the office reads to its own walls"],
]);

test("adjudication unblocks the re-pin, and only with a stated reason per probe", () => {
  const d = replay(AT_2730050, AT_92C1242, REASONS_92C1242);
  assert.equal(d.ok, true, `expected a clean re-pin, got: ${JSON.stringify(d.failures)}`);
  for (const [name, reason] of REASONS_92C1242) assert.equal(row(d, name).adjudication, reason, `${name} reason recorded`);
  // still flagged — adjudicated is not the same as unremarkable, and the flag is
  // what carries the reason into the corpus JSON.
  assert.equal(row(d, "patient-room-137").flagged, true);

  // adjudicating five of the six is not enough
  const partial = new Map(REASONS_92C1242);
  partial.delete("patient-toilet-137a");
  const p = replay(AT_2730050, AT_92C1242, partial);
  assert.equal(p.ok, false);
  assert.equal(failuresFor(p, "patient-toilet-137a").length, 1);
});

test("a one-word adjudication is not a reason", () => {
  const reasons = new Map(REASONS_92C1242);
  reasons.set("patient-room-137", "fixed");
  const d = replay(AT_2730050, AT_92C1242, reasons);
  assert.equal(d.ok, false);
  assert.ok(d.failures.some((f) => f.includes("patient-room-137") && f.includes("chars")),
    `expected a too-short-reason failure, got ${JSON.stringify(d.failures)}`);
  assert.equal(row(d, "patient-room-137").adjudication, undefined);
});

test("an adjudication that matches nothing fails — no blanket pre-authorisation", () => {
  const d = replay(AT_92C1242, AT_2EA5487, new Map([
    ["patient-room-137", "pre-authorising this probe to move by however much it likes, thanks"],
  ]));
  assert.ok(d.failures.some((f) => f.includes("matched nothing that moved")),
    `expected the unused-adjudication failure, got ${JSON.stringify(d.failures)}`);
});

test("a multi-case re-pin pools used adjudications instead of crying unused per case", () => {
  // Found by running the real script: the corpus has TWO case files, and an
  // adjudication naming a va-finish-plan probe was reported as matching nothing
  // while sample-plan was being checked — which failed every legitimate re-pin.
  const adj = new Map([
    ["b", "b moved for this perfectly good and adequately long reason"],
    [CASE_TOTAL_KEY, "case b is a single-probe case, so its total moves with b — same reason as above"],
  ]);
  const caseA = diffRepin({ caseFile: "a.json", oldProbes: [{ name: "a", golden: rect(100, 100) }], newProbes: [{ name: "a", golden: rect(100, 100) }], pxPerFt: PT_PER_FT, adjudications: adj, reportUnusedAdjudications: false });
  const caseB = diffRepin({ caseFile: "b.json", oldProbes: [{ name: "b", golden: rect(100, 100) }], newProbes: [{ name: "b", golden: rect(130, 100) }], pxPerFt: PT_PER_FT, adjudications: adj, reportUnusedAdjudications: false });
  assert.deepEqual(caseA.usedAdjudications, [], "case A consumed nothing");
  assert.deepEqual(caseB.usedAdjudications.sort(), ["@case-total", "b"], "case B consumed both");
  assert.deepEqual(caseA.failures, [], "…and case A must not complain about them");
  assert.equal(caseB.ok, true, JSON.stringify(caseB.failures));
  // with the pooling opt-out left at its default, a single-case diff still says so
  const alone = diffRepin({ caseFile: "a.json", oldProbes: [{ name: "a", golden: rect(100, 100) }], newProbes: [{ name: "a", golden: rect(100, 100) }], pxPerFt: PT_PER_FT, adjudications: adj });
  assert.ok(alone.failures.some((f) => f.includes("matched nothing that moved")));
});

test("parseRepinArgs: repeatable, both spellings, and loud on typos", () => {
  const a = parseRepinArgs(["--adjudicate", "p1=because the wall moved and this is why", "--adjudicate=p2=another perfectly good reason here", "--dry-run"]);
  assert.equal(a.dryRun, true);
  assert.equal(a.adjudications.get("p1"), "because the wall moved and this is why");
  assert.equal(a.adjudications.get("p2"), "another perfectly good reason here");
  assert.throws(() => parseRepinArgs(["--adjudicat", "p1=x"]), /unknown flag/);
  assert.throws(() => parseRepinArgs(["--adjudicate", "no-equals-sign"]), /malformed/);
  assert.throws(() => parseRepinArgs(["--adjudicate", "p1=aaa", "--adjudicate", "p1=bbb"]), /duplicate/);
  assert.equal(parseRepinArgs([]).adjudications.size, 0);
});

// ── the threshold itself ────────────────────────────────────────────────────

const rect = (w: number, h: number): Point[] => [[0, 0], [w, 0], [w, h], [0, h]];

test("the ±2.5% band is the band: 2.4% passes, 2.6% fails", () => {
  // Brackets REPIN_LIMITS.probeDelta from both sides, so widening the rule to
  // let a −32.75% move through, or narrowing it into uselessness, breaks here.
  const base = [{ name: "r", golden: rect(100, 100) }];
  const inside = replay(base, [{ name: "r", golden: rect(102.4, 100) }]);
  near(row(inside, "r").deltaPct! * 100, 2.4, 0.001, "+2.4%");
  assert.equal(row(inside, "r").flagged, false);
  assert.equal(inside.ok, true);

  const outside = replay(base, [{ name: "r", golden: rect(102.6, 100) }]);
  near(row(outside, "r").deltaPct! * 100, 2.6, 0.001, "+2.6%");
  assert.equal(row(outside, "r").flagged, true);
  assert.equal(outside.ok, false);

  // and symmetric on the shrink side — the direction the regression went
  const shrunk = replay(base, [{ name: "r", golden: rect(97.4, 100) }]);
  assert.equal(row(shrunk, "r").flagged, true);
  assert.equal(REPIN_LIMITS.probeDelta, 0.025, "the protocol's per-probe band");
});

test("a probe that keeps its area but moves elsewhere is visible in IoU", () => {
  // Δ% alone cannot see a trace that jumped to a different room. It does not
  // flag (the band is an SF band) but the diff must still show it.
  const d = replay([{ name: "r", golden: rect(100, 100) }],
    [{ name: "r", golden: [[500, 500], [600, 500], [600, 600], [500, 600]] as Point[] }]);
  assert.equal(row(d, "r").flagged, false, "same area — the SF rule cannot see this");
  assert.equal(row(d, "r").iou, 0, "…but IoU(old,new) reports it, which is why the diff prints it");
});

test("a NEW case may be pinned freely; additions to an EXISTING case may not", () => {
  const fresh = replay(null, AT_92C1242);
  assert.equal(fresh.newCase, true);
  assert.equal(fresh.ok, true, "there is no prior value to conceal when the file does not exist yet");
  assert.ok(fresh.probes.every((p) => p.verdict === "added" || p.verdict === "refusal"));
  assert.equal(fresh.caseTotal.flagged, false);
});

test("case total and adjacency still gate their own failure classes", () => {
  // They are not the guard for bug #17, but they are the guard for floor that
  // stops being measured at all, and for floor counted twice.
  const shrinkAll = replay(
    [{ name: "a", golden: rect(100, 100) }, { name: "b", golden: rect(100, 100) }],
    [{ name: "a", golden: rect(100, 100) }, { name: "b", golden: rect(50, 100) }],
    new Map([["b", "b really is half the size now, here is a sufficiently long reason"]]));
  assert.equal(row(shrinkAll, "b").adjudication !== undefined, true);
  assert.equal(shrinkAll.caseTotal.flagged, true, "−25% of the case total must still be adjudicated separately");
  assert.ok(shrinkAll.failures.some((f) => f.includes("case total") && f.includes(CASE_TOTAL_KEY)));

  const overlapping = replay(null, [
    { name: "a", golden: rect(200, 200) },
    { name: "b", golden: [[0, 0], [100, 0], [100, 100], [0, 100]] as Point[] },
  ]);
  assert.equal(overlapping.overlap.flagged, true, "b sits entirely inside a — 20% double-counted");
  assert.ok(overlapping.failures.some((f) => f.includes("double-counted") && f.includes(OVERLAP_KEY)));
});

test("the printed diff names the per-probe rule as the guard and cites the +0.5% fact", () => {
  const out = formatRepinDiff(regression());
  assert.ok(out.includes("patient-room-137"));
  assert.ok(/-32\.7\d%/.test(out), `the diff must print the move: ${out}`);
  assert.ok(out.includes("FAILS ±2.5%"));
  assert.ok(out.includes("case total") && out.includes("within band"),
    "the report must say out loud that the case total passed");
  assert.ok(out.includes("The per-probe rule is the guard; the case total is not."));
});
