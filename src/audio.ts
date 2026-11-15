import { noteFrequency } from './pieces';
import { clamp } from './util';

type Ctx = AudioContext;

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private rollingGain: GainNode | null = null;
  private rollingFilter: BiquadFilterNode | null = null;
  private rollingPan: StereoPannerNode | null = null;
  private rollingSource: AudioBufferSourceNode | null = null;
  private level: 0 | 1 | 2 = 2;
  private active = 0;
  private lastUi = 0;
  private lastChime = 0;

  get ready() {
    return !!this.ctx;
  }

  get context() {
    return this.ctx;
  }

  async unlock() {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* noop */
      }
    }
    this.startRolling();
  }

  private ensure(): Ctx | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;

    const master = ctx.createGain();
    master.gain.value = this.level === 0 ? 0 : this.level === 1 ? 0.38 : 0.78;

    const bus = ctx.createGain();
    bus.gain.value = 1;

    bus.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);

    this.comp = comp;
    this.master = master;
    this.bus = bus;
    this.noise = this.makeNoise(ctx, 2);
    this.startRolling();
    // iOS unlock
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* noop */
    }
    return ctx;
  }

  setLevel(level: 0 | 1 | 2) {
    this.level = level;
    if (this.ctx && this.master) {
      const v = level === 0 ? 0 : level === 1 ? 0.38 : 0.78;
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    }
    if (this.ctx && this.rollingGain && level === 0) {
      this.rollingGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  getLevel() {
    return this.level;
  }

  suspend() {
    if (!this.ctx) return;
    this.rollingGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    try {
      void this.ctx.suspend();
    } catch {
      /* noop */
    }
  }

  resume() {
    if (!this.ctx) return;
    try {
      void this.ctx.resume();
    } catch {
      /* noop */
    }
  }

  private makeNoise(ctx: Ctx, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  private startRolling() {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.bus || this.rollingSource) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 720;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.bus);
    source.start(0);
    this.rollingSource = source;
    this.rollingFilter = filter;
    this.rollingGain = gain;
    this.rollingPan = pan;
  }

  updateRolling(energy: number, panX: number) {
    const ctx = this.ctx;
    if (!ctx || !this.rollingGain || !this.rollingFilter || !this.rollingPan) return;
    const t = ctx.currentTime;
    const target = this.level === 0 ? 0 : clamp(energy * 0.035, 0, 0.12);
    this.rollingGain.gain.setTargetAtTime(target, t, 0.09);
    this.rollingFilter.frequency.setTargetAtTime(520 + clamp(energy, 0, 1) * 900, t, 0.14);
    this.rollingPan.pan.setTargetAtTime(clamp(panX, -1, 1), t, 0.12);
  }

  private pan(value: number) {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = clamp(value, -1, 1);
    return p;
  }

  private beginVoice() {
    if (!this.ctx) return false;
    if (this.active >= 16) return false;
    this.active++;
    return true;
  }

  private endVoiceSoon(fundamental: OscillatorNode | AudioBufferSourceNode) {
    fundamental.onended = () => {
      this.active = Math.max(0, this.active - 1);
    };
  }

  playChime(note: number, impact: number, panX: number) {
    const ctx = this.ensure();
    if (!ctx || !this.bus || this.level === 0) return;
    const now = ctx.currentTime;
    if (now - this.lastChime < 0.035) return;
    if (this.active >= 16 && now - this.lastChime > 3) this.active = 0;
    this.lastChime = now;
    if (!this.beginVoice()) return;
    const base = noteFrequency(note);
    const vel = clamp(impact / 900, 0.12, 1);
    const panner = this.pan(panX);
    panner.connect(this.bus);
    const dur = 1.7 - note * 0.1;
    const partials = [
      { r: 1, a: 1, d: dur },
      { r: 2.756, a: 0.34, d: dur * 0.62 },
      { r: 5.404, a: 0.17, d: dur * 0.36 },
      { r: 8.933, a: 0.075, d: dur * 0.22 }
    ];
    let fundamental: OscillatorNode | null = null;
    for (const part of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = note < 3 ? 'triangle' : 'sine';
      osc.frequency.value = base * part.r;
      osc.detune.value = (Math.random() - 0.5) * 5;
      const amp = 0.16 * part.a * vel;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + part.d);
      osc.connect(g);
      g.connect(panner);
      osc.start(now);
      osc.stop(now + part.d + 0.03);
      if (!fundamental) fundamental = osc;
    }
    // mallet transient
    this.noiseBurst(0.018, 2400, 0.06 * vel, panX, 'highpass');
    if (fundamental) this.endVoiceSoon(fundamental);
    window.setTimeout(() => panner.disconnect(), 2400);
  }

  private noiseBurst(duration: number, freq: number, gain: number, panX: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.bus || this.level === 0) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const p = this.pan(panX);
    src.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(this.bus);
    src.start(now);
    src.stop(now + duration + 0.03);
    src.onended = () => {
      try {
        p.disconnect();
      } catch {
        /* noop */
      }
    };
  }

  private tone(
    freq: number,
    duration: number,
    gain: number,
    panX: number,
    type: OscillatorType = 'sine',
    slideTo?: number
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.bus || this.level === 0) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration * 0.85);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const p = this.pan(panX);
    osc.connect(g);
    g.connect(p);
    p.connect(this.bus);
    osc.start(now);
    osc.stop(now + duration + 0.04);
    osc.onended = () => {
      try {
        p.disconnect();
      } catch {
        /* noop */
      }
    };
  }

  impact(material: string, impact: number, panX: number) {
    if (this.level === 0) return;
    this.ensure();
    const v = clamp(impact / 1200, 0.08, 1);
    if (material === 'rubber') {
      this.tone(170, 0.18, 0.1 * v, panX, 'sine', 300);
      return;
    }
    if (material === 'metal') {
      this.tone(1500 + Math.random() * 200, 0.09, 0.06 * v, panX, 'sine');
      this.noiseBurst(0.03, 3200, 0.04 * v, panX, 'highpass');
      return;
    }
    if (material === 'loop') {
      this.tone(240, 0.06, 0.05 * v, panX, 'triangle');
      return;
    }
    this.tone(135 + Math.random() * 35, 0.07, 0.09 * v, panX, 'sine');
    this.noiseBurst(0.028, 900, 0.035 * v, panX);
  }

  trampoline(impact: number, panX: number) {
    if (this.level === 0) return;
    this.ensure();
    const v = clamp(impact / 1000, 0.2, 1);
    this.tone(155, 0.24, 0.13 * v, panX, 'sine', 310);
    this.tone(310, 0.16, 0.04 * v, panX, 'triangle', 460);
  }

  bumper(panX: number) {
    if (this.level === 0) return;
    this.ensure();
    this.tone(420, 0.09, 0.09, panX, 'triangle', 640);
    this.tone(840, 0.07, 0.04, panX, 'sine');
  }

  cannon(panX: number) {
    if (this.level === 0) return;
    this.ensure();
    this.noiseBurst(0.16, 500, 0.09, panX);
    this.tone(80, 0.16, 0.11, panX, 'sine', 48);
  }

  boost(panX: number) {
    if (this.level === 0) return;
    this.ensure();
    this.noiseBurst(0.22, 1400, 0.045, panX);
    this.tone(380, 0.18, 0.025, panX, 'sine', 720);
  }

  loop(panX: number) {
    if (this.level === 0) return;
    this.ensure();
    this.noiseBurst(0.32, 1200, 0.05, panX);
    this.tone(330, 0.28, 0.04, panX, 'sine', 660);
    this.tone(495, 0.24, 0.028, panX, 'sine', 990);
  }

  goal(panX: number) {
    if (this.level === 0) return;
    this.ensure();
    const notes = [5, 7, 5, 4];
    notes.forEach((n, i) => {
      window.setTimeout(() => {
        if (this.level > 0) this.playChime(n, 760, panX);
      }, i * 55);
    });
    this.tone(261.6, 0.4, 0.035, panX, 'sine');
  }

  star(panX: number) {
    if (this.level === 0) return;
    this.ensure();
    this.tone(1046, 0.16, 0.055, panX, 'sine');
    this.tone(1568, 0.13, 0.03, panX, 'sine');
  }

  purchase() {
    if (this.level === 0) return;
    this.ensure();
    this.tone(523, 0.1, 0.07, 0, 'sine');
    window.setTimeout(() => this.tone(783, 0.18, 0.06, 0, 'sine'), 70);
  }

  medal() {
    if (this.level === 0) return;
    this.ensure();
    [523, 659, 783, 1046].forEach((f, i) => {
      window.setTimeout(() => this.tone(f, 0.32, 0.045, 0, 'sine'), i * 70);
    });
  }

  ui() {
    const ctx = this.ensure();
    if (!ctx || this.level === 0) return;
    const now = ctx.currentTime;
    if (now - this.lastUi < 0.035) return;
    this.lastUi = now;
    this.noiseBurst(0.014, 1600, 0.027, 0, 'bandpass');
  }

  error() {
    if (this.level === 0) return;
    this.ensure();
    this.tone(180, 0.12, 0.04, 0, 'triangle', 140);
    window.setTimeout(() => this.tone(130, 0.16, 0.035, 0, 'triangle', 100), 80);
  }

  record() {
    if (this.level === 0) return;
    this.ensure();
    [392, 523, 659, 783].forEach((f, i) => {
      window.setTimeout(() => this.tone(f, 0.55, 0.04, 0, 'sine'), i * 60);
    });
  }

  dispose() {
    this.suspend();
    this.ctx = null;
  }
}
