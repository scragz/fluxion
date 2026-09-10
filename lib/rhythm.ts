export type Step = {
  density: number;
  length: number;
  curve: number;
  divisions: number;
  differential: number;
  phase: number;
  compress: number;
  humanize: number;
  probability: number;
  probabilityMode: string;
  gate: number;
  mask: number;
  maskShift: number;
  aux1: string;
  aux2: string;
  lfoRate: number;
  lfoDepth: number;
  lfoTarget: string;
  lfoShape: string;
};
export type Channel = {
  name: string;
  color: string;
  muted: boolean;
  volume: number;
  loopStart: number;
  loopEnd: number;
  notes: number[];
  steps: Step[];
};
export type Hit = { at: number; duration: number; lane: number; index: number };
export const LANES = ['Main', 'Aux 1', 'Aux 2'];
export const AUX_MODES = [
  'OFF',
  'COPY',
  'SOS',
  'FIRST',
  'LAST',
  ...Array.from({ length: 8 }, (_, i) => `DEL ${i + 1}`),
  ...Array.from({ length: 16 }, (_, i) => `TL ${i + 1}`),
  'PPQ 1',
  'PPQ 2',
  'PPQ 4',
  'PPQ 8',
  'PPQ 16',
  '/2',
  '/4',
  '/8',
  '/16',
];
export const DEFAULT_STEP: Step = {
  density: 4,
  length: 16,
  curve: 0,
  divisions: 1,
  differential: 0,
  phase: 0,
  compress: 0,
  humanize: 0,
  probability: 100,
  probabilityMode: 'Trigger',
  gate: 30,
  mask: 0,
  maskShift: 0,
  aux1: 'OFF',
  aux2: 'OFF',
  lfoRate: 1,
  lfoDepth: 0,
  lfoTarget: 'Main',
  lfoShape: 'Sine',
};
export function initialChannels(): Channel[] {
  return ['Ember', 'Moss', 'Cobalt', 'Rose'].map((name, c) => ({
    name,
    color: ['#efae63', '#b2d493', '#85bff0', '#e994a4'][c],
    muted: false,
    volume: 0.7,
    loopStart: 0,
    loopEnd: 3,
    notes: [
      [36, 43, 45],
      [38, 39, 40],
      [42, 44, 46],
      [50, 56, 70],
    ][c],
    steps: Array.from({ length: 16 }, (_, i) => ({
      ...DEFAULT_STEP,
      density: [4, 3, 8, 5][c] + (i % 4 === 3 ? 2 : 0),
      curve: i % 4 === 1 ? [1.5, -1.1, 0.8, -0.8][c] : i % 4 === 3 ? -1 : 0,
      aux1: c === 0 ? 'TL 2' : c === 1 ? 'LAST' : c === 2 ? 'TL 3' : 'DEL 2',
      aux2: 'OFF',
      lfoDepth: c === 2 ? 28 : 0,
      lfoRate: c === 2 ? 2 : 1,
    })),
  }));
}
export function random(seed: number) {
  let a = seed | 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function warp(x: number, amount: number) {
  return Math.abs(amount) < 0.0001
    ? x
    : Math.expm1(amount * x) / Math.expm1(amount);
}
export function curvePosition(x: number, s: Step) {
  const parts = s.divisions;
  const segment = Math.min(parts - 1, Math.floor(x * parts));
  const local = x * parts - segment;
  return (
    (segment + warp(local, s.curve + (segment % 2 ? 1 : -1) * s.differential)) /
    parts
  );
}
export function generateHits(s: Step, seed = 1, stepStart = 0): Hit[] {
  const rng = random(seed),
    main: Hit[] = [];
  const passStep = s.probabilityMode !== 'Step' || rng() * 100 < s.probability;
  const raw = Array.from({ length: s.density }, (_, i) => {
    const x = curvePosition(i / s.density, s);
    const jitter =
      ((((rng() - 0.5) * s.humanize) / 127) * (s.humanize > 100 ? 2 : 0.5)) /
      Math.max(1, s.density);
    return {
      at: ((x + s.phase / 360) * (1 - s.compress / 100) + jitter) * s.length,
      index: i,
    };
  })
    .filter((h) => h.at >= 0 && h.at < s.length)
    .sort((a, b) => a.at - b.at);
  raw.forEach((h, i) => {
    if (
      passStep &&
      (!s.mask || (h.index + s.maskShift) % s.mask !== 0) &&
      (s.probabilityMode === 'Step' || rng() * 100 < s.probability)
    )
      main.push({
        ...h,
        lane: 0,
        duration: Math.max(
          0.001,
          (((raw[i + 1]?.at ?? s.length) - h.at) * s.gate) / 100,
        ),
      });
  });
  const hits = [...main];
  [s.aux1, s.aux2].forEach((mode, k) => {
    const lane = k + 1;
    let out: Hit[] = [];
    const n = Number(mode.split(' ')[1] || mode.slice(1));
    if (mode === 'COPY') out = main;
    else if (mode === 'FIRST') out = main.slice(0, 1);
    else if (mode === 'LAST') out = main.slice(-1);
    else if (mode === 'SOS')
      out = [
        {
          at: 0,
          duration: Math.max(0.01, (s.length * s.gate) / 100),
          index: 0,
          lane,
        },
      ];
    else if (mode.startsWith('TL ')) out = main.filter((_, i) => i % n === 0);
    else if (mode.startsWith('DEL '))
      out = main
        .map((h) => ({ ...h, at: h.at + n }))
        .filter((h) => h.at < s.length);
    else if (mode.startsWith('PPQ ') || mode.startsWith('/')) {
      const interval = mode.startsWith('PPQ ') ? 4 / n : n * 4;
      const first = (interval - (stepStart % interval)) % interval;
      for (let at = first; at < s.length; at += interval)
        out.push({ at, duration: interval * 0.3, index: out.length, lane });
    }
    hits.push(
      ...out.map((h) => ({
        ...h,
        lane,
        duration: Math.min(h.duration, s.length - h.at),
      })),
    );
  });
  return hits.sort((a, b) => a.at - b.at || a.lane - b.lane);
}
export function seedFor(c: number, step: number, cycle: number) {
  return 107 + c * 99991 + step * 719 + cycle * 1009;
}
export function lfoValue(s: Step, seconds: number) {
  const p = (((seconds * s.lfoRate) % 1) + 1) % 1;
  const wave =
    s.lfoShape === 'Triangle'
      ? 1 - Math.abs(p * 2 - 1)
      : s.lfoShape === 'Square'
        ? p < 0.5
          ? 0
          : 1
        : s.lfoShape === 'Saw'
          ? p
          : (1 - Math.cos(p * Math.PI * 2)) / 2;
  return 1 - s.lfoDepth / 100 + (wave * s.lfoDepth) / 100;
}
export function targets(s: Step, lane: number) {
  return (
    s.lfoTarget === 'All' ||
    s.lfoTarget === LANES[lane] ||
    (s.lfoTarget === 'Both aux' && lane > 0)
  );
}
export function renderSequence(channels: Channel[], length: number) {
  return channels.flatMap((ch, c) => {
    let at = 0,
      st = ch.loopStart,
      cycle = 0;
    const hits: (Hit & { channel: number; step: number; absolute: number })[] =
      [];
    while (at < length) {
      const s = ch.steps[st];
      if (!ch.muted)
        hits.push(
          ...generateHits(s, seedFor(c, st, cycle), at)
            .filter((h) => at + h.at < length)
            .map((h) => ({ ...h, channel: c, step: st, absolute: at + h.at })),
        );
      at += s.length;
      st++;
      if (st > ch.loopEnd) {
        st = ch.loopStart;
        cycle++;
      }
    }
    return hits;
  });
}
const vlq = (n: number) => {
  const b = [n & 127];
  while ((n >>= 7)) b.unshift((n & 127) | 128);
  return b;
};
const bytes = (n: number, len: number) =>
  Array.from({ length: len }, (_, i) => (n >> ((len - i - 1) * 8)) & 255);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
export function midiFile(
  channels: Channel[],
  bpm: number,
  bars: number,
): Uint8Array {
  const end = bars * 16,
    ppq = 960,
    ticks = ppq / 4;
  const tempo = Math.round(60000000 / bpm);
  const track = (data: number[]) => [
    ...ascii('MTrk'),
    ...bytes(data.length, 4),
    ...data,
  ];
  const conductor = track([
    0,
    255,
    81,
    3,
    ...bytes(tempo, 3),
    0,
    255,
    88,
    4,
    4,
    2,
    24,
    8,
    ...vlq(end * ticks),
    255,
    47,
    0,
  ]);
  const events = renderSequence(channels, end);
  const tracks = channels.flatMap((ch, c) =>
    LANES.map((lane, l) => {
      const name = ascii(`CH ${c + 1} ${lane}`),
        data = [0, 255, 3, name.length, ...name];
      const laneHits = events
        .filter((h) => h.channel === c && h.lane === l)
        .sort((a, b) => a.absolute - b.absolute);
      const ev = laneHits
        .flatMap((h, i) => {
          const t = Math.round(h.absolute * ticks);
          const next = laneHits[i + 1]?.absolute ?? end;
          const off = Math.max(
            t + 1,
            Math.min(
              Math.round((h.absolute + h.duration) * ticks),
              Math.round(next * ticks) - 1,
              end * ticks,
            ),
          );
          return [
            { t, b: [0x90 + c, ch.notes[l], 100] },
            { t: off, b: [0x80 + c, ch.notes[l], 0] },
          ];
        })
        .sort((a, b) => a.t - b.t || (a.b[0] & 0xf0) - (b.b[0] & 0xf0));
      let prev = 0;
      ev.forEach((e) => {
        data.push(...vlq(e.t - prev), ...e.b);
        prev = e.t;
      });
      data.push(...vlq(Math.max(0, end * ticks - prev)), 255, 47, 0);
      return track(data);
    }),
  );
  return new Uint8Array([
    ...ascii('MThd'),
    0,
    0,
    0,
    6,
    0,
    1,
    0,
    13,
    ...bytes(ppq, 2),
    ...conductor,
    ...tracks.flat(),
  ]);
}
