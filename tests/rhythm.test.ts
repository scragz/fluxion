import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STEP as D,
  generateHits,
  initialChannels,
  lfoValue,
  targets,
  midiFile,
  renderSequence,
  warp,
} from '../lib/rhythm.ts';
test('linear timing and gate lengths, including tail gate', () => {
  const h = generateHits({ ...D, gate: 50 });
  assert.deepEqual(
    h.map((h) => h.at),
    [0, 4, 8, 12],
  );
  assert.deepEqual(
    h.map((h) => h.duration),
    [2, 2, 2, 2],
  );
});
test('zero density and chance mute main and derived aux but retain utility SOS', () => {
  assert.equal(generateHits({ ...D, density: 0 }).length, 0);
  assert.deepEqual(
    generateHits({ ...D, probability: 0, aux1: 'COPY', aux2: 'SOS' }).map(
      (h) => h.lane,
    ),
    [2],
  );
});
test('curvature, phase before compression, out-of-bounds clipping', () => {
  assert.ok(warp(0.5, 3) < 0.5);
  assert.ok(warp(0.5, -3) > 0.5);
  assert.deepEqual(
    generateHits({ ...D, phase: 180, compress: 50 }).map((h) => h.at),
    [4, 6, 8, 10],
  );
  assert.deepEqual(
    generateHits({ ...D, compress: -100 }).map((h) => h.at),
    [0, 8],
  );
});
test('per-trigger masking with a shifted start', () => {
  assert.deepEqual(
    generateHits({ ...D, mask: 2 }).map((h) => h.at),
    [4, 12],
  );
  assert.deepEqual(
    generateHits({ ...D, mask: 2, maskShift: 1 }).map((h) => h.at),
    [0, 8],
  );
});
test('aux delay, division, first/last, and clock modes', () => {
  const aux = (mode: string) =>
    generateHits({ ...D, aux1: mode })
      .filter((h) => h.lane === 1)
      .map((h) => h.at);
  assert.deepEqual(aux('DEL 2'), [2, 6, 10, 14]);
  assert.deepEqual(aux('TL 2'), [0, 8]);
  assert.deepEqual(aux('FIRST'), [0]);
  assert.deepEqual(aux('LAST'), [12]);
  assert.deepEqual(aux('PPQ 2'), [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.deepEqual(
    generateHits({ ...D, length: 5, aux1: '/2' }, 1, 5)
      .filter((h) => h.lane === 1)
      .map((h) => h.at),
    [3],
  );
});
test('humanize and probability replay deterministically and stay inside step', () => {
  const s = { ...D, density: 64, humanize: 127, probability: 60 };
  assert.deepEqual(generateHits(s, 42), generateHits(s, 42));
  assert.notDeepEqual(generateHits(s, 42), generateHits(s, 43));
  assert.ok(
    generateHits(s, 42).every(
      (h) => h.at >= 0 && h.at < s.length && h.duration > 0,
    ),
  );
});
test('step probability is all-or-nothing', () => {
  for (let i = 0; i < 100; i++)
    assert.ok(
      [0, 4].includes(
        generateHits({ ...D, probabilityMode: 'Step', probability: 50 }, i)
          .length,
      ),
    );
});
test('independent loops advance through correct parameter sets', () => {
  const channels = initialChannels();
  channels.forEach((ch) => {
    ch.loopStart = 1;
    ch.loopEnd = 2;
    ch.steps[1] = { ...D, length: 4, density: 1 };
    ch.steps[2] = { ...D, length: 8, density: 2 };
  });
  const e = renderSequence(channels, 24).filter(
    (h) => h.channel === 0 && h.lane === 0,
  );
  assert.deepEqual(
    e.map((h) => [h.step, h.absolute]),
    [
      [1, 0],
      [2, 4],
      [2, 8],
      [1, 12],
      [2, 16],
      [2, 20],
    ],
  );
});
test('VCA stays in gain bounds and routes only to selected output', () => {
  for (const shape of ['Sine', 'Triangle', 'Square', 'Saw']) {
    const s = { ...D, lfoDepth: 70, lfoShape: shape, lfoTarget: 'Both aux' };
    for (let t = 0; t < 3; t += 0.01)
      assert.ok(lfoValue(s, t) >= 0.3 - 1e-9 && lfoValue(s, t) <= 1);
    assert.equal(targets(s, 0), false);
    assert.equal(targets(s, 1), true);
    assert.equal(targets(s, 2), true);
  }
});
function parseMidi(data: Uint8Array) {
  const v = new DataView(data.buffer);
  assert.equal(Buffer.from(data.slice(0, 4)).toString(), 'MThd');
  assert.equal(v.getUint16(8), 1);
  assert.equal(v.getUint16(10), 13);
  assert.equal(v.getUint16(12), 960);
  let pos = 14;
  const tracks: any[] = [];
  while (pos < data.length) {
    assert.equal(Buffer.from(data.slice(pos, pos + 4)).toString(), 'MTrk');
    const len = v.getUint32(pos + 4),
      end = pos + 8 + len;
    pos += 8;
    let ticks = 0,
      notes = 0,
      offs = 0;
    const active = new Map<number, number>();
    const readVar = () => {
      let n = 0,
        b = 0;
      do {
        b = data[pos++];
        n = (n << 7) | (b & 127);
      } while (b & 128);
      return n;
    };
    while (pos < end) {
      ticks += readVar();
      const status = data[pos++];
      if (status === 255) {
        const type = data[pos++],
          size = readVar();
        if (type === 47) assert.equal(pos + size, end);
        pos += size;
      } else {
        const note = data[pos++],
          velocity = data[pos++];
        assert.ok(note <= 127 && velocity <= 127);
        if ((status & 240) === 144) {
          notes++;
          active.set(note, (active.get(note) || 0) + 1);
        } else {
          offs++;
          assert.ok((active.get(note) || 0) > 0);
          active.set(note, active.get(note)! - 1);
        }
      }
    }
    assert.ok([...active.values()].every((n) => n === 0));
    tracks.push({ ticks, notes, offs });
  }
  return tracks;
}
test('MIDI has 12 balanced note tracks plus tempo, exact duration and muted tracks', () => {
  const c = initialChannels();
  c[1].muted = true;
  const ts = parseMidi(midiFile(c, 123, 4));
  assert.equal(ts.length, 13);
  assert.ok(ts.every((t) => t.ticks === 16 * 4 * 240));
  assert.ok(ts.every((t) => t.notes === t.offs));
  assert.equal(ts[4].notes, 0);
  assert.ok(ts[1].notes > 0);
});
test('dense MIDI export stays practical and parseable', () => {
  const c = initialChannels();
  c.forEach((ch) =>
    ch.steps.forEach((s) =>
      Object.assign(s, { density: 64, length: 1, aux1: 'COPY', aux2: 'COPY' }),
    ),
  );
  const start = performance.now();
  const bytes = midiFile(c, 300, 4);
  assert.ok(performance.now() - start < 3000);
  const ts = parseMidi(bytes);
  assert.equal(ts[1].notes, 4096);
});
