# Fluxion

A browser interpretation of the rhythm synthesis page in the IOLabs Flux 1.07 manual. Built with TypeScript, React, Web Audio, and Web MIDI.

## Play

Press Play (or Space). Four independent channels each hold 16 parameter steps; the demo loops steps 1–4. A step contains a variable-length rhythm, not a single trigger. The twelve lanes display main/aux hits and gates. Playback plots use the exact seeded hit arrays sent to the scheduler, including humanize and probability. The lit step buttons show each channel's position. Use the channel selector beneath the roll, then select a step to edit it. The selected channel also controls the sample slots, VCA, and MIDI notes. The roll remains a separate playback view; Follow keeps the editor on the playing step. Edits during playback apply on the next visit to that step. All steps edits all 16 steps of the selected channel.

Each channel has Main, Aux 1, and Aux 2 sample slots. Click a name to load audio or headphones to audition. Samples are decoded locally, are limited to 30 MB each, and exist only for the lifetime of the page. There is no upload service or project persistence. The included kit is generated locally. Sample playback is one-shot, with 128-voice global polyphony; gate length controls the visual gates and MIDI note durations. Channel mute stops existing channel voices.

The free-running LFO applies continuous amplitude modulation to Main, Aux 1, Aux 2, both aux, or all sample players for a channel. Settings are per step. A sample keeps its originating step's LFO settings through its tail. Depth zero bypasses modulation. MIDI does not carry this audio modulation.

## MIDI

Export produces a type-1 .mid file at 960 PPQN: one tempo/time-signature track and twelve named note tracks. Choose 1–32 bars. Notes use MIDI channels 1–4 with separate editable note numbers for each lane, and fixed velocity 100. Export starts at each channel's loop start with the same deterministic probability/humanize seeds used when playback starts. Muted channels export empty tracks. MIDI file export does not require device permissions.

Connect MIDI requests browser Web MIDI permission without SysEx and lists available outputs. On macOS, enable an IAC bus in Audio MIDI Setup → MIDI Studio → IAC Driver. Select that output in the app and the bus as Ableton's input; enable Track and monitoring for the receiving track. Web MIDI requires a supporting browser and secure context (HTTPS or localhost). This version sends note events, not MIDI clock, and has not been verified against a physical device or Ableton. Keep the tab foreground for reliable scheduling.

## Interpretation boundaries

Reference: user-provided `flux 107 User Manual.pdf`, pages 4, 8–9, 21. The manual describes behavior but does not supply firmware formulas. This is not an exact recreation of the proprietary TM algorithm.

- Curve value is an exponential timing transform; zero is linear. Curve divisions divide normalized time equally. Differential alternates a curvature offset between divisions. These are app-defined interpretations.
- Length is 1–64 sixteenths; density is 0–64 hits. Phase is applied before compression. Out-of-step hits are clipped. Humanize and probability are reproducibly seeded per channel, step, and loop cycle.
- Aux supports off, copy, start-of-step, first/last, delayed copy, trigger-count division, PPQ clocks, and master clock division. DEL n is interpreted as n sixteenths and clipped at the step end. TL counts reset per step. Clock modes derive phase from the master timeline.
- Hardware Boolean logic, CV threshold aux, hardware CV outputs, modulation buses, Evolve, burst mode, and full hardware curve/mask catalogs are not implemented.
- LFO-to-VCA is the requested browser adaptation, not hardware CV emulation.

## Development

Requires Node 22.13+ for the app. Tests that directly run TypeScript use Node 26.

```sh
npm install
npm run dev
npm run build
node --experimental-strip-types --test tests/rhythm.test.ts
node --test tests/audio.test.mjs
./node_modules/.bin/tsc --noEmit
```

On a Mac with a globally installed libvips, use `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install` to use the packaged binary.

Validation: pure rhythm/MIDI tests parse exported track lengths and note pairing; audio scheduler tests use a simulated AudioContext to check scheduling, VCA envelopes, mute/stop, sample decoding error handling, and MIDI messages. These do not replace audio listening or end-to-end MIDI device testing. The page's WebMCP read/edit tools were exercised through the actual local browser registry with valid input, invalid input, readback, and restoration. Broad browser visual/interaction testing was not requested or performed.
