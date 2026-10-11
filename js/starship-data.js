'use strict';
// Starship mission catalog: vehicles, pads and flights, as plain data. js/starship.js turns an
// entry into a flown trajectory (3-DOF physics: Raptor thrust vs. ambient pressure, US76 drag,
// J2 gravity, Earth's rotation), so adding a flight is mostly a matter of adding an entry below.
//
// Mission entry
//   id, name [zh, en], date (ISO UTC liftoff; the panel can also launch "now"), vehicle (key of
//   STARSHIP_VEHICLES), serials [booster, ship], pad (key of STARSHIP_PADS), azimuth (° from north)
//   payload  { type: 'sim' | 'v2mini' | 'v3', count, mass (kg each) }
//   booster  { recovery: 'catch' | 'gulf', gulf: [east, north] km from the pad for a splashdown }
//   ship     { profile: 'suborbital' | 'orbital', seco: { alt, apo, peri } km, oib (orbital: insertion
//              burn end, s), deorbit (orbital: s), splash: [zh, en] }
//   timeline (seconds after liftoff; ship/booster programmes follow these exactly)
//     meco, stage, bb0, bb1 (boostback), hsj (hot-stage jettison, Block 2 only), lb0, land (booster
//     landing burn start / touchdown or catch), seco, deploy [first, last], relight [t, s] (optional)
//   facts [zh, en] lines shown in the panel; real: what actually happened, for the record
// Times come from SpaceX's published flight timelines; physics fills in everything between them
// (max-Q, transonic, entry, splashdown point are computed, not scripted).
const STARSHIP_VEHICLES = {
  block2: {
    name: ['星舰 V2（Block 2）', 'Starship V2 (Block 2)'], staging: [66, 5700], // km, km/h at hot staging (webcast telemetry)
    booster: { h: 71, dry: 205e3, prop: 3400e3, engine: 'r2', n: 33, fins: 4, hsr: 'jettison' },
    ship: { h: 52, dry: 115e3, prop: 1500e3, rsl: 'r2', rvac: 'r2vac', door: 'pez' },
  },
  block3: {
    name: ['星舰 V3（Block 3）', 'Starship V3 (Block 3)'], staging: [70, 6200],
    booster: { h: 72.3, dry: 230e3, prop: 3650e3, engine: 'r3', n: 33, fins: 3, hsr: 'integrated' },
    ship: { h: 52.1, dry: 125e3, prop: 1600e3, rsl: 'r3', rvac: 'r3vac', door: 'pez' },
  },
};
// fvac N, isp (vacuum) s, ae nozzle exit m² (thrust at pressure p is fvac − p·ae)
const RAPTORS = {
  r2: { fvac: 2.394e6, isp: 347, ae: 1.36, name: 'Raptor 2' },
  r2vac: { fvac: 2.53e6, isp: 380, ae: 4.15, name: 'Raptor 2 Vacuum' },
  r3: { fvac: 2.848e6, isp: 363, ae: 1.0, name: 'Raptor 3' },
  r3vac: { fvac: 3.0e6, isp: 380, ae: 4.15, name: 'Raptor 3 Vacuum' },
};
const STARSHIP_PADS = {
  // Starbase, Boca Chica, Texas. Orbital Launch Pad 1 (Pad A) and Pad 2 (Pad B), ~400 m apart
  olp1: biProp({ lat: 25.99690, lon: -97.15720, tower: 146 }, 'name', '星港 1 号发射台', 'Starbase Pad 1'),
  olp2: biProp({ lat: 25.99330, lon: -97.15610, tower: 146 }, 'name', '星港 2 号发射台', 'Starbase Pad 2'),
};
const STARSHIP_MISSIONS = [
  {
    id: 'flight10', name: ['第十次试飞', 'Flight 10'], date: '2025-08-26T23:30:00Z',
    vehicle: 'block2', serials: ['B16', 'S37'], pad: 'olp1', azimuth: 97,
    payload: { type: 'sim', count: 8, mass: 2000 },
    booster: { recovery: 'gulf', gulf: [9, 1.5] },
    ship: { profile: 'suborbital', seco: { alt: 185, apo: 242, peri: 4 }, ld: 0.45, splash: ['印度洋', 'Indian Ocean'] },
    timeline: { meco: 156, stage: 158, bb0: 168, bb1: 218, hsj: 225, lb0: 380, land: 400, seco: 537, deploy: [1107, 1532], relight: [2268, 2] },
    facts: [
      ['8 颗星链模拟星从“Pez”舱门依次弹出', '8 Starlink simulators pushed out one by one through the "Pez" door'],
      ['在太空中重新点燃一台猛禽发动机，为将来的离轨点火铺路', 'Relit a Raptor in space, a key step towards deorbit burns'],
      ['飞船在印度洋目标点 3 米内溅落', 'The ship splashed down within 3 m of its target in the Indian Ocean'],
    ],
    real: ['助推器 B16 在墨西哥湾受控溅落（悬停测试）；可在面板里改成塔架捕获。', 'Booster 16 made a controlled splashdown in the Gulf (with a hover test); switch to a tower catch in the panel.'],
  },
  {
    id: 'flight8catch', name: ['第八次试飞 · 筷子夹箭', 'Flight 8 · tower catch'], date: '2025-03-06T23:30:00Z',
    vehicle: 'block2', serials: ['B15', 'S34'], pad: 'olp1', azimuth: 97,
    payload: { type: 'sim', count: 4, mass: 2000 },
    booster: { recovery: 'catch' },
    ship: { profile: 'suborbital', seco: { alt: 185, apo: 242, peri: 4 }, ld: 0.45, splash: ['印度洋', 'Indian Ocean'] },
    timeline: { meco: 156, stage: 159, bb0: 165, bb1: 246, hsj: 248, lb0: 394, land: 422, seco: 537, deploy: [1107, 1350] },
    facts: [
      ['助推器 B15 返回发射场，被发射塔的“筷子”机械臂在空中夹住', 'Booster 15 flew back to the launch site and was caught in mid-air by the tower\'s "chopsticks"'],
      ['返航点火 T+2:45 起，着陆点火 T+6:34，T+7:02 被夹住', 'Boostback from T+2:45, landing burn at T+6:34, caught at T+7:02'],
      ['这里的飞船按标称剖面飞完：部署 4 颗模拟星后再入、溅落', 'The ship here flies the nominal profile: deploys 4 simulators, re-enters and splashes down'],
    ],
    real: ['真实的第 8 次飞行中，飞船 S34 在上升段多台发动机熄火后失联；助推器捕获成功。', 'On the real Flight 8, Ship 34 was lost during ascent after several engines shut down; the booster catch succeeded.'],
  },
  {
    id: 'flight14', name: ['第十四次试飞 · 首次入轨', 'Flight 14 · first orbit'], date: '2026-09-28T12:48:00Z',
    vehicle: 'block3', serials: ['B21', 'S41'], pad: 'olp2', azimuth: 73.5,
    payload: { type: 'v3', count: 26, mass: 1700 },
    booster: { recovery: 'gulf', gulf: [10, 3] },
    ship: { profile: 'orbital', seco: { alt: 190, apo: 270, peri: -20 }, oib: 1536, orbit: { apo: 275, peri: 262 }, deorbit: 8940, splash: ['北太平洋', 'North Pacific'] },
    timeline: { meco: 160, stage: 163, bb0: 172, bb1: 228, lb0: 382, land: 404, seco: 520, deploy: [2047, 3879] },
    facts: [
      ['V3 星舰：33 台猛禽 3 发动机，起飞推力约 9,240 吨力', 'Starship V3: 33 Raptor 3 engines, about 9,240 tf at liftoff'],
      ['首次进入轨道（约 262 × 275 km，倾角 30.5°），部署 26 颗 V3 星链卫星', 'First orbit (about 262 × 275 km, 30.5°), deploying 26 Starlink V3 satellites'],
      ['约两圈后离轨点火，在北太平洋受控溅落', 'Deorbit burn after about two orbits, controlled splashdown in the North Pacific'],
    ],
    real: ['公开报道中部分时间（入轨点火、离轨点火）有出入，这里取估计值。', 'Public reports differ on some times (orbit insertion, deorbit); estimated values are used here.'],
  },
];
