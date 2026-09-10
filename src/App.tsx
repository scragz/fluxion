import { useState, useRef, useEffect, useCallback, CSSProperties } from 'react';
import {
  initialChannels,
  generateHits,
  seedFor,
  LANES,
  AUX_MODES,
  Step,
  Channel,
  curvePosition,
  lfoValue,
  midiFile,
} from '@/lib/rhythm';
import { AudioEngine, SOUNDS, Frame, MidiPort } from '@/lib/audio';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Play,
  Square,
  Download,
  AudioLines,
  Upload,
  Volume2,
  VolumeX,
  RotateCcw,
  Cable,
  ChevronRight,
  Info,
  X,
  Headphones,
} from 'lucide-react';
const EMPTY: Frame = {
  playing: false,
  elapsed: 0,
  blocks: [null, null, null, null],
  positions: [0, 0, 0, 0],
};
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
    >
      <SelectTrigger aria-label={label} className="choice">
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((v) => (
          <SelectItem key={v} value={v}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Range({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="parameter" title={hint}>
      <div className="parameter-label">
        <span>{label}</span>
        <span className="parameter-number">
          <input
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
            }}
          />
          {unit}
        </span>
      </div>
      <Slider
        aria-label={label + ' slider'}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}
export default function App() {
  const [channels, setChannels] = useState(initialChannels),
    [selected, setSelected] = useState(0),
    [editSteps, setEditSteps] = useState([0, 0, 0, 0]),
    [playing, setPlaying] = useState(false),
    [bpm, setBpm] = useState(120),
    [frame, setFrame] = useState<Frame>(EMPTY),
    [follow, setFollow] = useState(true),
    [all, setAll] = useState(false),
    [message, setMessage] = useState(''),
    [rollSteps, setRollSteps] = useState([0, 0, 0, 0]),
    [help, setHelp] = useState(false),
    [bars, setBars] = useState('4'),
    [sampleNames, setSampleNames] = useState(SOUNDS.map((a) => [...a])),
    [loading, setLoading] = useState(''),
    [ports, setPorts] = useState<MidiPort[]>([]),
    [midiId, setMidiId] = useState('off'),
    [midiBusy, setMidiBusy] = useState(false);
  const followRef = useRef(follow);
  followRef.current = follow;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const engine = useRef<AudioEngine | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const target = useRef<[number, number]>([0, 0]);
  const accessRef = useRef<{
    outputs: Map<string, MidiPort>;
    onstatechange: (() => void) | null;
  } | null>(null);
  const getEngine = useCallback(() => {
    if (!engine.current)
      engine.current = new AudioEngine(() => channelsRef.current, setMessage);
    return engine.current;
  }, []);
  const stop = useCallback(() => {
    const stoppedFrame = engine.current?.frame();
    if (stoppedFrame?.playing) {
      setRollSteps((prev) =>
        prev.map((s, c) => stoppedFrame.blocks[c]?.step ?? s),
      );
      if (followRef.current)
        setEditSteps((prev) =>
          prev.map((s, c) => stoppedFrame.blocks[c]?.step ?? s),
        );
    }
    engine.current?.stop();
    setPlaying(false);
    setFrame(EMPTY);
  }, []);
  const toggle = useCallback(async () => {
    if (engine.current?.playing) {
      stop();
      setMessage('');
    } else {
      try {
        await getEngine().start(bpm);
        setPlaying(true);
        setMessage('');
      } catch {
        setMessage(
          'Audio could not start. Enable audio for this page and try again.',
        );
      }
    }
  }, [bpm, getEngine, stop]);
  useEffect(() => {
    let raf = 0,
      last = 0;
    const draw = (time: number) => {
      if (time - last > 30) {
        if (engine.current?.playing) {
          setFrame(engine.current.frame());
          if (engine.current.context?.state === 'suspended') {
            stop();
            setMessage('Audio was suspended. Press play to resume.');
          }
        }
        last = time;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      engine.current?.stop();
      if (accessRef.current) accessRef.current.onstatechange = null;
    };
  }, [stop]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.code === 'Space' &&
        !['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].includes(el.tagName) &&
        !el.closest(
          '[role="slider"],[role="combobox"],[role="option"],[contenteditable]',
        )
      ) {
        e.preventDefault();
        void toggle();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [toggle]);
  const activeStep =
    follow && playing && frame.blocks[selected]
      ? frame.blocks[selected]!.step
      : editSteps[selected];
  const ch = channels[selected],
    step = ch.steps[activeStep];
  const edit = (patch: Partial<Step>) =>
    setChannels((prev) =>
      prev.map((c, i) =>
        i === selected
          ? {
              ...c,
              steps: c.steps.map((s, j) =>
                all || j === activeStep ? { ...s, ...patch } : s,
              ),
            }
          : c,
      ),
    );
  const changeChannel = (c: number, patch: Partial<Channel>) =>
    setChannels((prev) =>
      prev.map((ch, i) => (i === c ? { ...ch, ...patch } : ch)),
    );
  const chooseStep = (c: number, s: number) => {
    setSelected(c);
    setEditSteps((prev) => prev.map((v, i) => (i === c ? s : v)));
    setFollow(false);
  };
  async function loadSample(file?: File) {
    if (!file) return;
    const [c, l] = target.current;
    setLoading(`${c}:${l}`);
    try {
      const duration = await getEngine().load(file, c, l);
      setSampleNames((prev) =>
        prev.map((a, i) =>
          i === c ? a.map((n, j) => (j === l ? file.name : n)) : a,
        ),
      );
      setMessage(
        `${file.name} loaded · ${duration.toFixed(2)} seconds · CH ${c + 1} ${LANES[l]}`,
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Sample could not be loaded.',
      );
    } finally {
      setLoading('');
      if (upload.current) upload.current.value = '';
    }
  }
  async function enableMidi() {
    const nav = navigator as unknown as {
      requestMIDIAccess?: (options: { sysex: boolean }) => Promise<{
        outputs: Map<string, MidiPort>;
        onstatechange: (() => void) | null;
      }>;
    };
    if (!nav.requestMIDIAccess) {
      setMessage(
        'Live MIDI is unavailable in this browser. Open this site in Chrome or Edge, or use Export MIDI.',
      );
      return;
    }
    setMidiBusy(true);
    try {
      const access = await nav.requestMIDIAccess({ sysex: false });
      accessRef.current = access;
      const refresh = () => {
        const outputs = Array.from(access.outputs.values()).filter(
          (p) => p.state !== 'disconnected',
        );
        setPorts(outputs);
        if (
          engine.current?.midi &&
          !outputs.some((p) => p.id === engine.current?.midi?.id)
        ) {
          engine.current.silenceMidi();
          engine.current.midi = null;
          setMidiId('off');
          setMessage('MIDI output disconnected. Choose another output.');
        }
      };
      refresh();
      access.onstatechange = refresh;
      setMessage(
        access.outputs.size
          ? 'Choose a MIDI output below. Channels 1–4 send Main / Aux 1 / Aux 2 notes.'
          : 'No MIDI outputs found. Enable an IAC bus in Audio MIDI Setup, then return here.',
      );
    } catch {
      setMessage(
        'MIDI access was denied or is unavailable. You can still export a MIDI file.',
      );
    } finally {
      setMidiBusy(false);
    }
  }
  function selectMidi(id: string) {
    const e = getEngine();
    e.silenceMidi();
    e.midi = ports.find((p) => p.id === id) || null;
    setMidiId(id);
    setMessage(
      id === 'off'
        ? 'Live MIDI disconnected.'
        : `Sending notes to ${e.midi?.name || 'MIDI output'} on channels 1–4. MIDI clock is not sent.`,
    );
  }
  function exportMidi() {
    const data = midiFile(channels, bpm, Number(bars));
    const url = URL.createObjectURL(
      new Blob([data as BlobPart], { type: 'audio/midi' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `fluxion-${bpm}bpm-${bars}bars.mid`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(
      `Exported ${bars} bars, 12 MIDI tracks, ${bpm} BPM. VCA modulation affects audio only; the file contains notes.`,
    );
  }
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const life = new AbortController();
    const register = (tool: unknown) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: life.signal }),
        ).catch(() => {});
      } catch {
        /* optional browser capability */
      }
    };
    register({
      name: 'read_rhythm_pattern',
      description:
        'Read the four channel rhythm settings, sample names excluded.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({ channels: channelsRef.current }),
    });
    register({
      name: 'set_step_density',
      description:
        'Set trigger density for one step and show that step in the editor. Does not start playback.',
      inputSchema: {
        type: 'object',
        properties: {
          channel: { type: 'integer', minimum: 1, maximum: 4 },
          step: { type: 'integer', minimum: 1, maximum: 16 },
          density: { type: 'integer', minimum: 0, maximum: 64 },
        },
        required: ['channel', 'step', 'density'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input: unknown) => {
        const p = input as { channel: number; step: number; density: number };
        if (
          !p ||
          !Number.isInteger(p.channel) ||
          p.channel < 1 ||
          p.channel > 4 ||
          !Number.isInteger(p.step) ||
          p.step < 1 ||
          p.step > 16 ||
          !Number.isInteger(p.density) ||
          p.density < 0 ||
          p.density > 64
        )
          throw new Error('Expected channel 1–4, step 1–16, and density 0–64.');
        setChannels((prev) =>
          prev.map((c, i) =>
            i === p.channel - 1
              ? {
                  ...c,
                  steps: c.steps.map((s, j) =>
                    j === p.step - 1 ? { ...s, density: p.density } : s,
                  ),
                }
              : c,
          ),
        );
        chooseStep(p.channel - 1, p.step - 1);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {
          channel: p.channel,
          step: p.step,
          density: channelsRef.current[p.channel - 1].steps[p.step - 1].density,
        };
      },
    });
    return () => life.abort();
  }, []);
  return (
    <main className="instrument">
      <header className="masthead">
        <div className="brand">FLUXION</div>
        <div className="transport">
          <button
            className="primary"
            onClick={() => void toggle()}
            aria-label={playing ? 'Stop playback' : 'Start playback'}
          >
            {playing ? (
              <Square size={16} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
            {playing ? 'Stop' : 'Play'}
          </button>
          <button
            className="icon-button"
            aria-label="Restart sequence"
            onClick={async () => {
              stop();
              try {
                await getEngine().start(bpm);
                setPlaying(true);
              } catch {
                setMessage('Audio could not start.');
              }
            }}
          >
            <RotateCcw size={16} />
          </button>
          <label className="tempo">
            <input
              aria-label="Tempo in BPM"
              title={playing ? 'Stop playback to change tempo' : 'Tempo'}
              disabled={playing}
              type="number"
              value={bpm}
              min="30"
              max="300"
              onChange={(e) =>
                setBpm(
                  Math.max(30, Math.min(300, Number(e.target.value) || 120)),
                )
              }
            />
            <small>BPM</small>
          </label>
          <span className="timecode">
            {String(Math.floor(frame.elapsed / 60)).padStart(2, '0')}:
            {String(Math.floor(frame.elapsed % 60)).padStart(2, '0')}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="How to use Fluxion"
            aria-expanded={help}
            onClick={() => setHelp(!help)}
          >
            <Info size={17} />
          </button>
        </div>
      </header>
      {help && (
        <aside className="help">
          <button
            className="help-close icon-button"
            aria-label="Close help"
            onClick={() => setHelp(false)}
          >
            <X size={16} />
          </button>
          <h2>A step is a rhythm, not a single hit.</h2>
          <p>
            Each channel loops independently through up to 16 steps. Select a
            numbered step to edit it. Density places hits inside its length;
            curve value bends their timing. Follow keeps the editor on the
            playing step. All steps applies edits to all 16 steps of the
            selected channel.
          </p>
          <p>
            Three sample players per channel follow Main, Aux 1, and Aux 2.
            Click a sample name to load audio; the headphone button auditions
            it. Samples stay in this page and are cleared on reload. Built-in
            sounds are synthesized locally. Samples play as one-shots; gate
            length controls the plotted gates and MIDI note length. Up to 128
            sample voices can overlap.
          </p>
          <p>
            VCA depth controls continuous amplitude modulation of the selected
            audio outputs, with a free-running LFO from transport start. Each
            sample uses the step’s VCA settings for its whole voice. MIDI sends
            fixed-velocity notes; it does not carry samples or VCA automation.
            To route live MIDI on Mac: Audio MIDI Setup → MIDI Studio → IAC
            Driver → Device is online. Select that bus here and as a MIDI input
            in Ableton. Enable Track and monitor the receiving track. Live MIDI
            requires a supporting browser and permission. No MIDI clock is sent.
          </p>
          <p className="muted">
            Interpretation of the Flux 1.07 rhythm page, not a firmware
            emulation. The manual does not specify curve equations or delay
            units: this app uses exponential curves, equal curve divisions,
            alternate differential curvature, and DEL n = n sixteenths clipped
            at the step end. TL counts within each step. Utility clocks follow
            the global timeline. Hardware modulation buses, Boolean aux logic,
            and CV-threshold modes are outside this version.
          </p>
        </aside>
      )}
      <input
        ref={upload}
        type="file"
        accept="audio/*,.wav,.aif,.aiff,.mp3,.ogg,.flac"
        className="sr-only"
        aria-label="Load audio sample"
        onChange={(e) => void loadSample(e.target.files?.[0])}
      />
      <section className="rhythm-field" aria-label="Live rhythm plots">
        {channels.map((ch, c) => {
          const b = playing ? frame.blocks[c] : null;
          const st = b?.step ?? rollSteps[c],
            s = b?.settings ?? ch.steps[st],
            hits = b?.hits ?? generateHits(s, seedFor(c, st, 0)),
            pos = frame.positions[c];
          return (
            <div
              className={`channel-row ${ch.muted ? 'muted-channel' : ''}`}
              key={c}
              style={{ '--channel': ch.color } as CSSProperties}
            >
              <div className="row-heading">
                <div className="row-name">
                  <span>0{c + 1}</span>
                  <strong>{ch.name}</strong>
                </div>
                <span className="roll-step">
                  Step {String(st + 1).padStart(2, '0')}
                </span>
                <span className="step-readout">
                  {hits.filter((h) => h.lane === 0).length} HITS <span>/</span>{' '}
                  {s.length} × 1/16
                </span>
              </div>
              <div className="plot-wrap">
                <div className="lane-labels">
                  {LANES.map((l, i) => {
                    const flash =
                      !!b &&
                      !ch.muted &&
                      hits.some(
                        (h) =>
                          h.lane === i &&
                          pos * s.length >= h.at &&
                          ((pos * s.length - h.at) * 60) / bpm / 4 < 0.08,
                      );
                    return (
                      <span key={l} className={flash ? 'firing' : ''}>
                        <i />
                        {l}
                      </span>
                    );
                  })}
                </div>
                <div className="plot-area">
                  <svg
                    viewBox="0 0 1000 110"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`Channel ${c + 1}, step ${st + 1}, ${hits.length} triggers across ${s.length} sixteenths`}
                  >
                    {Array.from({ length: s.length + 1 }, (_, i) => (
                      <line
                        key={i}
                        x1={(i / s.length) * 1000}
                        x2={(i / s.length) * 1000}
                        y1="0"
                        y2="110"
                        className={i % 4 ? 'grid-line' : 'grid-line major'}
                      />
                    ))}
                    {[34, 68, 102].map((y) => (
                      <line
                        key={y}
                        x1="0"
                        x2="1000"
                        y1={y}
                        y2={y}
                        className="lane-line"
                      />
                    ))}
                    {hits.map((h, i) => {
                      const flash =
                        !!b &&
                        pos * s.length >= h.at &&
                        ((pos * s.length - h.at) * 60) / bpm / 4 < 0.08;
                      return (
                        <g
                          key={i}
                          className={flash && !ch.muted ? 'hit firing' : 'hit'}
                        >
                          <rect
                            x={(h.at / s.length) * 1000}
                            y={h.lane * 34 + 12}
                            width={Math.max(2, (h.duration / s.length) * 1000)}
                            height="16"
                            fill="currentColor"
                            opacity={h.lane === 0 ? '.20' : '.11'}
                          />
                          <line
                            x1={(h.at / s.length) * 1000 + 1}
                            x2={(h.at / s.length) * 1000 + 1}
                            y1={h.lane * 34 + 7}
                            y2={h.lane * 34 + 31}
                            stroke="currentColor"
                            strokeWidth={h.lane === 0 ? '2.4' : '1.8'}
                          />
                          <circle
                            cx={(h.at / s.length) * 1000 + 1}
                            cy={h.lane * 34 + 7}
                            r="2.5"
                            fill="currentColor"
                          />
                        </g>
                      );
                    })}
                    {b && (
                      <g>
                        <rect
                          x="0"
                          y="0"
                          width={pos * 1000}
                          height="110"
                          fill="currentColor"
                          opacity=".035"
                        />
                        <line
                          x1={pos * 1000}
                          x2={pos * 1000}
                          y1="0"
                          y2="110"
                          stroke="#f6efd8"
                          strokeWidth="1.5"
                        />
                      </g>
                    )}
                  </svg>
                  <div className="ruler">
                    {Array.from({ length: Math.min(s.length, 16) }, (_, i) => (
                      <span key={i}>
                        {s.length <= 16
                          ? i + 1
                          : Math.round((i * s.length) / 16) + 1}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </section>
      <section
        className="edit-selection"
        aria-label="Channel and step selection"
        style={
          { '--channel': ch.color, '--primary': ch.color } as CSSProperties
        }
      >
        <RadioGroup
          className="channel-picker"
          aria-label="Select channel"
          value={String(selected)}
          onValueChange={(value) => setSelected(Number(value))}
        >
          {channels.map((channel, c) => (
            <label
              key={c}
              className={`channel-option ${selected === c ? 'is-selected' : ''}`}
              style={
                {
                  '--channel': channel.color,
                  '--primary': channel.color,
                } as CSSProperties
              }
            >
              <RadioGroupItem
                value={String(c)}
                aria-label={`Channel ${c + 1}: ${channel.name}`}
              />
              <span className="channel-option-number">CH {c + 1}</span>
              <strong>{channel.name}</strong>
            </label>
          ))}
        </RadioGroup>
        <div className="step-picker">
          <div className="step-picker-heading">
            <span>Step</span>
            <div className="loop-control">
              <span>Loop</span>
              <Choice
                label="Loop start"
                value={String(ch.loopStart + 1)}
                options={Array.from({ length: 16 }, (_, i) => String(i + 1))}
                onChange={(v) =>
                  changeChannel(selected, {
                    loopStart: Number(v) - 1,
                    loopEnd: Math.max(ch.loopEnd, Number(v) - 1),
                  })
                }
              />
              <span>→</span>
              <Choice
                label="Loop end"
                value={String(ch.loopEnd + 1)}
                options={Array.from({ length: 16 - ch.loopStart }, (_, i) =>
                  String(ch.loopStart + i + 1),
                )}
                onChange={(v) =>
                  changeChannel(selected, { loopEnd: Number(v) - 1 })
                }
              />
            </div>
            <label className="follow-control">
              Follow{' '}
              <Switch
                aria-label="Follow playback"
                checked={follow}
                onCheckedChange={(value) => {
                  if (!value && frame.blocks[selected])
                    setEditSteps((prev) =>
                      prev.map((s, c) =>
                        c === selected ? frame.blocks[selected]!.step : s,
                      ),
                    );
                  setFollow(value);
                }}
              />
            </label>
          </div>
          <div
            className="step-strip editor-step-strip"
            aria-label={`Channel ${selected + 1} steps`}
          >
            {ch.steps.map((_, i) => (
              <button
                key={i}
                aria-label={`Channel ${selected + 1} step ${i + 1}`}
                aria-pressed={activeStep === i}
                className={`${i < ch.loopStart || i > ch.loopEnd ? 'outside-loop ' : ''}${activeStep === i ? 'current-step ' : ''}${playing && frame.blocks[selected]?.step === i ? 'playing-step' : ''}`}
                onClick={() => chooseStep(selected, i)}
              >
                {String(i + 1).padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section
        className="editor"
        style={
          { '--channel': ch.color, '--primary': ch.color } as CSSProperties
        }
        aria-label="Step editor"
      >
        <div className="editor-heading">
          <h2>
            <span>0{selected + 1}</span> {ch.name} <ChevronRight size={15} />{' '}
            Step {String(activeStep + 1).padStart(2, '0')}
          </h2>
          <div className="editor-options">
            <label>
              All steps{' '}
              <Switch
                aria-label="Edit all steps"
                checked={all}
                onCheckedChange={setAll}
              />
            </label>
          </div>
        </div>
        <div
          className="editor-samples"
          aria-label={`Channel ${selected + 1} samples`}
        >
          {LANES.map((lane, i) => (
            <div className="sample-slot" key={lane}>
              <span className="lane-tag">{lane}</span>
              <button
                className="sample-load"
                disabled={!!loading}
                title={`Load CH ${selected + 1} ${lane} sample`}
                onClick={() => {
                  target.current = [selected, i];
                  upload.current?.click();
                }}
              >
                {loading === `${selected}:${i}`
                  ? 'Loading…'
                  : sampleNames[selected][i]}
                <Upload size={14} />
              </button>
              <button
                className="audition"
                aria-label={`Audition channel ${selected + 1} ${lane}`}
                onClick={() =>
                  void getEngine()
                    .audition(selected, i)
                    .catch(() => setMessage('Sample could not be played.'))
                }
              >
                <Headphones size={15} />
              </button>
            </div>
          ))}
          <button
            className="sample-mute"
            aria-label={`${ch.muted ? 'Unmute' : 'Mute'} channel ${selected + 1}`}
            aria-pressed={ch.muted}
            onClick={() => {
              if (!ch.muted) engine.current?.muteChannel(selected);
              changeChannel(selected, { muted: !ch.muted });
            }}
          >
            {ch.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
        <div className="editor-body">
          <div className="curve-panel">
            <div className="panel-label">
              TEMPORAL CURVE{' '}
              <span>
                {step.curve === 0
                  ? 'LINEAR'
                  : step.curve > 0
                    ? 'EXPONENTIAL'
                    : 'LOGARITHMIC'}
              </span>
            </div>
            <svg
              viewBox="0 0 240 135"
              role="img"
              aria-label="Temporal distribution curve"
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <g key={i}>
                  <line
                    x1={i * 60}
                    x2={i * 60}
                    y1="0"
                    y2="135"
                    className="grid-line major"
                  />
                  <line
                    x1="0"
                    x2="240"
                    y1={i * 33.75}
                    y2={i * 33.75}
                    className="grid-line major"
                  />
                </g>
              ))}
              <path
                d={Array.from(
                  { length: 121 },
                  (_, i) =>
                    `${i ? 'L' : 'M'}${i * 2},${133 - curvePosition(i / 120, step) * 131}`,
                ).join(' ')}
                stroke="currentColor"
                strokeWidth="2.4"
                fill="none"
              />
              {generateHits(step, seedFor(selected, activeStep, 0))
                .filter((h) => h.lane === 0)
                .map((h, i) => (
                  <circle
                    key={i}
                    cx={(h.at / step.length) * 240}
                    cy="131"
                    r="2"
                    fill="currentColor"
                  />
                ))}
            </svg>
            <div className="curve-caption">
              <span>START</span>
              <span>{step.length} SIXTEENTHS</span>
              <span>END</span>
            </div>
          </div>
          <div className="parameters">
            <Range
              label="Density"
              value={step.density}
              max={64}
              onChange={(v) => edit({ density: Math.round(v) })}
              hint="Number of triggers distributed inside this step"
            />
            <Range
              label="Length"
              value={step.length}
              min={1}
              max={64}
              unit="/16"
              onChange={(v) => edit({ length: Math.round(v) })}
            />
            <Range
              label="Curve value"
              value={step.curve}
              min={-5}
              max={5}
              step={0.05}
              onChange={(v) => edit({ curve: v })}
            />
            <Range
              label="Curve divisions"
              value={step.divisions}
              min={1}
              max={8}
              onChange={(v) => edit({ divisions: Math.round(v) })}
            />
            <Range
              label="Differential"
              value={step.differential}
              min={-3}
              max={3}
              step={0.05}
              onChange={(v) => edit({ differential: v })}
            />
            <Range
              label="Phase"
              value={step.phase}
              min={-360}
              max={360}
              unit="°"
              onChange={(v) => edit({ phase: v })}
            />
            <Range
              label="Compress"
              value={step.compress}
              min={-100}
              max={95}
              unit="%"
              onChange={(v) => edit({ compress: v })}
            />
            <Range
              label="Humanize"
              value={step.humanize}
              max={127}
              onChange={(v) => edit({ humanize: v })}
            />
            <Range
              label="Gate length"
              value={step.gate}
              min={1}
              max={100}
              unit="%"
              onChange={(v) => edit({ gate: v })}
            />
          </div>
          <div className="routing">
            <div className="panel-label">TRIGGER ROUTING</div>
            <div className="route-line">
              <label>Aux 1</label>
              <Choice
                label="Aux 1 mode"
                value={step.aux1}
                options={AUX_MODES}
                onChange={(v) => edit({ aux1: v })}
              />
            </div>
            <div className="route-line">
              <label>Aux 2</label>
              <Choice
                label="Aux 2 mode"
                value={step.aux2}
                options={AUX_MODES}
                onChange={(v) => edit({ aux2: v })}
              />
            </div>
            <div className="route-line">
              <label>Mute mask</label>
              <Choice
                label="Mute mask"
                value={step.mask ? `1 in ${step.mask}` : 'Off'}
                options={[
                  'Off',
                  ...Array.from({ length: 15 }, (_, i) => `1 in ${i + 2}`),
                ]}
                onChange={(v) =>
                  edit({ mask: v === 'Off' ? 0 : Number(v.split(' ')[2]) })
                }
              />
            </div>
            <Range
              label="Mask shift"
              value={step.maskShift}
              max={15}
              onChange={(v) => edit({ maskShift: Math.round(v) })}
            />
            <div className="route-line">
              <label>Probability</label>
              <Choice
                label="Probability mode"
                value={step.probabilityMode}
                options={['Trigger', 'Step']}
                onChange={(v) => edit({ probabilityMode: v })}
              />
            </div>
            <Range
              label="Chance"
              value={step.probability}
              unit="%"
              onChange={(v) => edit({ probability: v })}
            />
          </div>
        </div>
        <div className="vca-panel">
          <div className="vca-title">
            <AudioLines size={23} />
            <div>
              <h3>LFO → VCA</h3>
            </div>
          </div>
          <div className="vca-wave">
            <svg
              viewBox="0 0 180 42"
              preserveAspectRatio="none"
              role="img"
              aria-label="VCA waveform"
            >
              <path
                d={Array.from(
                  { length: 91 },
                  (_, i) =>
                    `${i ? 'L' : 'M'}${i * 2},${40 - lfoValue(step, ((i / 90) * 2) / step.lfoRate) * 36}`,
                ).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              {playing && (
                <circle
                  cx="90"
                  cy={40 - lfoValue(step, frame.elapsed) * 36}
                  r="3"
                  fill="currentColor"
                />
              )}
            </svg>
          </div>
          <div>
            <label className="control-label">Target</label>
            <Choice
              label="VCA target"
              value={step.lfoTarget}
              options={['Main', 'Aux 1', 'Aux 2', 'Both aux', 'All']}
              onChange={(v) => edit({ lfoTarget: v })}
            />
          </div>
          <div>
            <label className="control-label">Shape</label>
            <Choice
              label="LFO shape"
              value={step.lfoShape}
              options={['Sine', 'Triangle', 'Square', 'Saw']}
              onChange={(v) => edit({ lfoShape: v })}
            />
          </div>
          <Range
            label="Rate"
            value={step.lfoRate}
            min={0.05}
            max={12}
            step={0.05}
            unit="Hz"
            onChange={(v) => edit({ lfoRate: v })}
          />
          <Range
            label="Depth"
            value={step.lfoDepth}
            unit="%"
            onChange={(v) => edit({ lfoDepth: v })}
          />
          <Range
            label="Channel level"
            value={Math.round(ch.volume * 100)}
            unit="%"
            onChange={(v) => changeChannel(selected, { volume: v / 100 })}
          />
        </div>
      </section>
      <section className="midi-panel" aria-label="MIDI controls">
        <div className="midi-title">
          <Cable size={18} />
          <strong>MIDI</strong>
          <span>CH {selected + 1}</span>
        </div>
        <div className="midi-notes">
          {LANES.map((l, i) => (
            <label key={l}>
              {l}
              <input
                aria-label={`${l} MIDI note`}
                type="number"
                min="0"
                max="127"
                value={ch.notes[i]}
                onChange={(e) => {
                  const v = Math.max(
                    0,
                    Math.min(127, Math.round(Number(e.target.value))),
                  );
                  changeChannel(selected, {
                    notes: ch.notes.map((n, j) => (j === i ? v : n)),
                  });
                }}
              />
            </label>
          ))}
        </div>
        <div className="midi-connect">
          <button disabled={midiBusy} onClick={() => void enableMidi()}>
            <Cable size={15} />
            {midiBusy ? 'Connecting…' : 'Connect MIDI'}
          </button>
          {ports.length > 0 && (
            <Choice
              label="MIDI output"
              value={
                midiId === 'off'
                  ? 'Off'
                  : ports.find((p) => p.id === midiId)?.name || 'Output'
              }
              options={['Off', ...ports.map((p) => p.name || p.id)]}
              onChange={(v) =>
                selectMidi(
                  v === 'Off'
                    ? 'off'
                    : ports.find((p) => (p.name || p.id) === v)!.id,
                )
              }
            />
          )}
        </div>
      </section>
      <section className="export-panel" aria-label="MIDI export">
        <div className="export-length">
          <Choice
            label="Export length in bars"
            value={bars + (bars === '1' ? ' bar' : ' bars')}
            options={[
              '1 bar',
              '2 bars',
              '4 bars',
              '8 bars',
              '16 bars',
              '32 bars',
            ]}
            onChange={(v) => setBars(v.split(' ')[0])}
          />
        </div>
        <button onClick={exportMidi}>
          <Download size={16} />
          <span>Export MIDI</span>
        </button>
      </section>
      {message && (
        <div className="feedback" role="status" aria-live="polite">
          <span>{message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setMessage('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </main>
  );
}
