import { generateHits, seedFor, lfoValue, targets } from './rhythm.ts';
import type { Channel, Step, Hit } from './rhythm.ts';
export type Block = {
  channel: number;
  step: number;
  cycle: number;
  start: number;
  end: number;
  absolute: number;
  settings: Step;
  hits: Hit[];
  scheduled: number;
};
export type Frame = {
  playing: boolean;
  elapsed: number;
  blocks: (Block | null)[];
  positions: number[];
};
export type MidiPort = {
  id: string;
  name?: string | null;
  state?: string;
  send: (data: number[], timestamp?: number) => void;
  clear: () => void;
};
export const SOUNDS = [
  ['808 Kick', 'Rim click', 'Low tom'],
  ['Dust snare', 'Clap', 'Wood block'],
  ['Closed hat', 'Open hat', 'Shaker'],
  ['Low conga', 'Bell', 'High tom'],
];
export class AudioEngine {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  voices = new Set<AudioBufferSourceNode>();
  voiceChannels = new Map<AudioBufferSourceNode, number>();
  samples = new Map<string, AudioBuffer>();
  builtins = new Map<string, AudioBuffer>();
  playing = false;
  started = 0;
  timer: ReturnType<typeof setInterval> | null = null;
  frames: Block[][] = [[], [], [], []];
  next: { step: number; cycle: number; time: number; absolute: number }[] = [];
  midi: MidiPort | null = null;
  bpm = 120;
  constructor(
    public getChannels: () => Channel[],
    public report: (message: string) => void,
  ) {}
  async init() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.65;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.ratio.value = 8;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
    }
    await this.context.resume();
    return this.context;
  }
  async load(file: File, c: number, l: number) {
    if (file.size > 30 * 1024 * 1024)
      throw new Error('Please choose a sample smaller than 30 MB.');
    const ctx = await this.init();
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error(
        'This audio format could not be decoded. Try a WAV or MP3 file.',
      );
    }
    this.samples.set(`${c}:${l}`, buffer);
    return buffer.duration;
  }
  builtin(c: number, l: number) {
    const key = `${c}:${l}`;
    if (this.builtins.has(key)) return this.builtins.get(key)!;
    const ctx = this.context!;
    const name = SOUNDS[c][l];
    const len = name === 'Open hat' ? 0.5 : name.includes('Kick') ? 0.6 : 0.28;
    const buffer = ctx.createBuffer(
      1,
      Math.ceil(ctx.sampleRate * len),
      ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    let phase = 0,
      last = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate,
        noise = Math.random() * 2 - 1;
      let y = 0;
      if (name.includes('Kick')) {
        phase +=
          (2 * Math.PI * (45 + 100 * Math.exp(-t * 40))) / ctx.sampleRate;
        y = Math.sin(phase) * Math.exp(-t * 9);
      } else if (/hat|Shaker/.test(name)) {
        y =
          (noise - last) *
          0.35 *
          Math.exp(-t * (name === 'Open hat' ? 10 : 45));
        last = noise;
      } else if (/snare|Clap/.test(name)) {
        y =
          (noise * 0.7 + Math.sin(t * 2 * Math.PI * 180) * 0.25) *
          Math.exp(-t * 20) *
          (name === 'Clap' ? 0.5 + 0.5 * Math.cos(t * 190) : 1);
      } else if (name === 'Bell') {
        y =
          (Math.sin(t * 2 * Math.PI * 540) +
            Math.sin(t * 2 * Math.PI * 853) * 0.4) *
          Math.exp(-t * 13) *
          0.5;
      } else {
        const f = /Low/.test(name) ? 100 : name === 'High tom' ? 210 : 700;
        phase +=
          (2 * Math.PI * (f + f * 0.6 * Math.exp(-t * 40))) / ctx.sampleRate;
        y =
          Math.sin(phase) *
          Math.exp(-t * (name === 'Rim click' ? 95 : 23)) *
          0.7;
      }
      data[i] = y * 0.75;
    }
    this.builtins.set(key, buffer);
    return buffer;
  }
  playVoice(c: number, l: number, time: number, s: Step, elapsed: number) {
    const ctx = this.context!;
    const ch = this.getChannels()[c];
    if (ch.muted) return;
    if (this.voices.size >= 128) {
      const oldest = this.voices.values().next().value;
      if (oldest) {
        oldest.stop();
        this.voices.delete(oldest);
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = this.samples.get(`${c}:${l}`) || this.builtin(c, l);
    const gain = ctx.createGain();
    const duration = source.buffer.duration;
    const level = ch.volume;
    const mod = targets(s, l);
    const values = new Float32Array(
      Math.max(2, Math.min(8192, Math.ceil(duration * 200))),
    );
    for (let i = 0; i < values.length; i++) {
      const t = (i / (values.length - 1)) * duration;
      values[i] =
        level *
        (mod ? lfoValue(s, elapsed + t) : 1) *
        Math.min(1, t / 0.002, (duration - t) / 0.005);
    }
    gain.gain.setValueCurveAtTime(values, time, duration);
    source.connect(gain);
    gain.connect(this.master!);
    this.voices.add(source);
    this.voiceChannels.set(source, c);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(source);
      this.voiceChannels.delete(source);
    };
    source.start(time);
  }
  async audition(c: number, l: number) {
    const ctx = await this.init();
    const step = this.getChannels()[c].steps[this.getChannels()[c].loopStart];
    this.playVoice(c, l, ctx.currentTime + 0.01, step, 0);
  }
  async start(bpm: number) {
    await this.init();
    if (this.playing) return;
    this.bpm = bpm;
    this.started = this.context!.currentTime + 0.09;
    this.frames = [[], [], [], []];
    this.next = this.getChannels().map((ch) => ({
      step: ch.loopStart,
      cycle: 0,
      time: this.started,
      absolute: 0,
    }));
    this.playing = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), 20);
  }
  tick() {
    if (!this.playing) return;
    const now = this.context!.currentTime,
      horizon = now + 0.09,
      unit = 60 / this.bpm / 4;
    this.getChannels().forEach((ch, c) => {
      const next = this.next[c];
      let safety = 0;
      while (next.time < horizon && safety++ < 1000) {
        if (next.step < ch.loopStart || next.step > ch.loopEnd)
          next.step = ch.loopStart;
        const s = { ...ch.steps[next.step] };
        const b: Block = {
          channel: c,
          step: next.step,
          cycle: next.cycle,
          start: next.time,
          end: next.time + s.length * unit,
          absolute: next.absolute,
          settings: s,
          hits: generateHits(
            s,
            seedFor(c, next.step, next.cycle),
            next.absolute,
          ),
          scheduled: 0,
        };
        this.frames[c].push(b);
        next.time = b.end;
        next.absolute += s.length;
        next.step++;
        if (next.step > ch.loopEnd) {
          next.step = ch.loopStart;
          next.cycle++;
        }
      }
      if (safety >= 1000) {
        next.time = now + 0.1;
        this.report(
          'Playback fell behind. Keep this tab visible for reliable timing.',
        );
      }
      for (const b of this.frames[c]) {
        while (b.scheduled < b.hits.length) {
          const h = b.hits[b.scheduled];
          const at = b.start + h.at * unit;
          if (at >= horizon) break;
          b.scheduled++;
          if (at < now - 0.01 || ch.muted) continue;
          const time = Math.max(now + 0.002, at);
          this.playVoice(c, h.lane, time, b.settings, time - this.started);
          if (this.midi) {
            const following = b.hits
              .slice(b.scheduled)
              .find((q) => q.lane === h.lane);
            const duration = Math.max(
              0.001,
              Math.min(
                h.duration * unit,
                following
                  ? (following.at - h.at) * unit - 0.001
                  : b.end - time - 0.001,
              ),
            );
            const stamp = performance.now() + (time - now) * 1000;
            try {
              this.midi.send([0x90 + c, ch.notes[h.lane], 100], stamp);
              this.midi.send(
                [0x80 + c, ch.notes[h.lane], 0],
                stamp + duration * 1000,
              );
            } catch {
              this.midi = null;
              this.report(
                'MIDI output disconnected. Sample playback continues.',
              );
            }
          }
        }
      }
      this.frames[c] = this.frames[c].filter((b) => b.end > now - 0.15);
    });
  }
  frame(): Frame {
    const now = this.context?.currentTime || 0;
    const blocks = this.frames.map(
      (bs) => bs.find((b) => b.start <= now && b.end > now) || null,
    );
    return {
      playing: this.playing,
      elapsed: Math.max(0, now - this.started),
      blocks,
      positions: blocks.map((b) =>
        b ? Math.max(0, (now - b.start) / (b.end - b.start)) : 0,
      ),
    };
  }
  muteChannel(c: number) {
    for (const [source, channel] of this.voiceChannels) {
      if (channel === c) {
        try {
          source.stop();
        } catch {}
        this.voices.delete(source);
        this.voiceChannels.delete(source);
      }
    }
    if (this.midi) {
      try {
        this.midi.send([0xb0 + c, 123, 0]);
      } catch {}
    }
  }
  silenceMidi() {
    if (this.midi) {
      try {
        this.midi.clear();
        for (let c = 0; c < 4; c++) this.midi.send([0xb0 + c, 123, 0]);
      } catch {
        this.midi = null;
      }
    }
  }
  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.voices.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    });
    this.voices.clear();
    this.voiceChannels.clear();
    this.silenceMidi();
    this.frames = [[], [], [], []];
  }
}
