import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const compile = (source) =>
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  ).toString('base64');
const rhythmUrl = compile(readFileSync('lib/rhythm.ts', 'utf8'));
const { initialChannels } = await import(rhythmUrl);
const { AudioEngine } = await import(
  compile(
    readFileSync('lib/audio.ts', 'utf8').replaceAll(
      "'./rhythm.ts'",
      JSON.stringify(rhythmUrl),
    ),
  )
);
class Param {
  value = 0;
  curves = [];
  setValueCurveAtTime(v, t, d) {
    assert.ok(d > 0);
    assert.ok([...v].every(Number.isFinite));
    assert.ok([...v].every((x) => x >= 0 && x <= 1));
    this.curves.push({ values: v, time: t, duration: d });
  }
}
class Node {
  gain = new Param();
  threshold = new Param();
  ratio = new Param();
  connect() {}
  disconnect() {}
}
class Source extends Node {
  onended = null;
  buffer = null;
  started = null;
  stopped = false;
  start(t) {
    this.started = t;
  }
  stop() {
    this.stopped = true;
    this.onended?.();
  }
}
class Context {
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  destination = {};
  sources = [];
  gains = [];
  async resume() {}
  createGain() {
    const g = new Node();
    this.gains.push(g);
    return g;
  }
  createDynamicsCompressor() {
    return new Node();
  }
  createBufferSource() {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  createBuffer(c, n, r) {
    return { duration: n / r, getChannelData: () => new Float32Array(n) };
  }
  async decodeAudioData(bytes) {
    if (!bytes.byteLength) throw Error('invalid');
    return this.createBuffer(1, 800, 8000);
  }
}
globalThis.AudioContext = Context;
async function setup() {
  const channels = initialChannels(),
    messages = [];
  const engine = new AudioEngine(
    () => channels,
    (m) => messages.push(m),
  );
  await engine.start(120);
  clearInterval(engine.timer);
  engine.timer = null;
  return { engine, channels, messages, ctx: engine.context };
}
test('scheduler uses the exact plotted hits and switches step snapshots at boundaries', async () => {
  const { engine, channels, ctx } = await setup();
  try {
    ctx.currentTime = 0.02;
    engine.tick();
    assert.ok(ctx.sources.some((s) => s.started === 0.09));
    ctx.currentTime = 0.1;
    const before = engine.frame();
    assert.equal(before.blocks[0].step, 0);
    const oldDensity = before.blocks[0].settings.density;
    channels[0].steps[0].density = 17;
    assert.equal(engine.frame().blocks[0].settings.density, oldDensity);
    ctx.currentTime = 2.05;
    engine.tick();
    ctx.currentTime = 2.1;
    assert.equal(engine.frame().blocks[0].step, 1);
    assert.equal(
      engine.frame().blocks[0].settings.curve,
      channels[0].steps[1].curve,
    );
  } finally {
    engine.stop();
  }
});
test('VCA schedules continuous gain curves and mute/stop cancel voices', async () => {
  const { engine, channels, ctx } = await setup();
  try {
    channels[0].steps[0].lfoDepth = 100;
    engine.playVoice(0, 0, 0.2, channels[0].steps[0], 0);
    const curve = ctx.gains.at(-1).gain.curves[0];
    assert.ok(curve.values.length > 2);
    assert.equal(curve.values[0], 0);
    assert.ok(Math.max(...curve.values) > 0);
    engine.muteChannel(0);
    assert.ok([...engine.voiceChannels.values()].every((c) => c !== 0));
    engine.stop();
    assert.equal(engine.voices.size, 0);
    assert.equal(engine.playing, false);
    assert.ok(ctx.sources.every((s) => s.stopped));
  } finally {
    engine.stop();
  }
});
test('MIDI sends balanced timestamped notes and stop clears pending events', async () => {
  const { engine, ctx } = await setup();
  const messages = [];
  let cleared = false;
  engine.midi = {
    id: 'test',
    send: (data, t) => messages.push({ data, t }),
    clear: () => {
      cleared = true;
    },
  };
  ctx.currentTime = 0.02;
  engine.tick();
  const on = messages.filter((m) => (m.data[0] & 240) === 144),
    off = messages.filter((m) => (m.data[0] & 240) === 128);
  assert.ok(on.length > 0);
  assert.equal(on.length, off.length);
  assert.ok(off[0].t > on[0].t);
  engine.stop();
  assert.ok(cleared);
  assert.equal(messages.filter((m) => m.data[1] === 123).length, 4);
});
test('sample decoding replaces only chosen lane; malformed sample preserves old buffer', async () => {
  const { engine } = await setup();
  try {
    const file = { size: 3, arrayBuffer: async () => new ArrayBuffer(3) };
    await engine.load(file, 2, 1);
    const stored = engine.samples.get('2:1');
    assert.equal(engine.samples.size, 1);
    await assert.rejects(
      () =>
        engine.load(
          { size: 0, arrayBuffer: async () => new ArrayBuffer(0) },
          2,
          1,
        ),
      /could not be decoded/,
    );
    assert.equal(engine.samples.get('2:1'), stored);
    await assert.rejects(
      () => engine.load({ size: 31 * 1024 * 1024 }, 0, 0),
      /smaller than 30 MB/,
    );
  } finally {
    engine.stop();
  }
});
