import { noteFrequency } from './pieces';
import { clamp } from './util';

type Ctx = AudioContext;

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private chimes = new Map<number, AudioBuffer>();
  private level: 0 | 1 | 2 = 2;
  private active = 0;
  private voiceLimit = 14;
  private lastUi = -Infinity;
  private lastChime = -Infinity;

  get ready() {
    return !!this.ctx;
  }

  get context() {
    return this.ctx;
  }

  async unlock() {
    if (this.level === 0) return;
    const ctx = this.ensure();
    if (ctx && ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* noop */
      }
    }
  }

  private ensure(): Ctx | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    let ctx: Ctx;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;

    const master = ctx.createGain();
    master.gain.value = this.level === 0 ? 0 : this.level === 1 ? 0.28 : 0.65;

    const bus = ctx.createGain();
    bus.gain.value = 1;

    bus.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);

    this.master = master;
    this.bus = bus;
    this.noise = this.makeNoise(ctx, 0.5);
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
      const v = level === 0 ? 0 : level === 1 ? 0.28 : 0.65;
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    }
  }

  setVoiceLimit(limit: number) {
    this.voiceLimit = limit;
  }

  getLevel() {
    return this.level;
  }

  suspend() {
    if (!this.ctx) return;
    try {
      void this.ctx.suspend().catch(() => {});
    } catch {
      /* noop */
    }
  }

  resume() {
    if (!this.ctx) return;
    try {
      void this.ctx.resume().catch(() => {});
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

  private connectVoice(source: AudioScheduledSourceNode, gain: GainNode, panX: number) {
    const ctx = this.ctx!;
    const pan = typeof ctx.createStereoPanner === 'function' && Math.abs(panX) > 0.04 ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = clamp(panX * 0.8, -1, 1);
      gain.connect(pan);
      pan.connect(this.bus!);
    } else {
      gain.connect(this.bus!);
    }
    this.active++;
    source.onended = () => {
      this.active--;
      gain.disconnect();
      pan?.disconnect();
    };
  }

  private canPlay(priority = false): boolean {
    return this.level > 0 && this.ctx?.state === 'running' && this.active < this.voiceLimit - (priority ? 0 : 2);
  }

  private chimeBuffer(ctx: Ctx, note: number): AudioBuffer {
    const cached = this.chimes.get(note);
    if (cached) return cached;
    const rate = 22050;
    const duration = 1.18 - note * 0.055;
    const buffer = ctx.createBuffer(1, Math.round(rate * duration), rate);
    const data = buffer.getChannelData(0);
    const base = noteFrequency(note);
    // Cuatro modos de vibración de una lámina, calculados una sola vez por nota.
    for (const [ratio, volume, decay] of [[1, 0.77, 5], [2.76, 0.26, 13], [5.4, 0.09, 23], [8.92, 0.035, 45]]) {
      const angle = 2 * Math.PI * base * ratio / rate;
      const wave = 2 * Math.cos(angle);
      const falloff = Math.exp(-decay / rate);
      let previous = 0;
      let sample = Math.sin(angle);
      let envelope = volume;
      for (let i = 0; i < data.length; i++) {
        data[i] += sample * envelope;
        envelope *= falloff;
        const next = wave * sample - previous;
        previous = sample;
        sample = next;
      }
    }
    for (let i = 0; i < data.length; i++) {
      data[i] *= Math.min(1, i / 135, (data.length - i - 1) / 1600);
    }
    this.chimes.set(note, buffer);
    return buffer;
  }

  playChime(note: number, impact: number, panX: number, delay = 0) {
    if (!this.canPlay(true)) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (delay === 0) {
      if (now - this.lastChime < 0.025) return;
      this.lastChime = now;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.chimeBuffer(ctx, clamp(note, 0, 7));
    const gain = ctx.createGain();
    gain.gain.value = 0.18 * Math.sqrt(clamp(impact / 1000, 0.08, 1));
    source.connect(gain);
    this.connectVoice(source, gain, panX);
    source.start(now + delay);
  }

  private noiseBurst(duration: number, freq: number, gain: number, panX: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.canPlay()) return;
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
    src.connect(f);
    f.connect(g);
    this.connectVoice(src, g, panX);
    src.start(now);
    src.stop(now + duration + 0.03);
  }

  private tone(
    freq: number,
    duration: number,
    gain: number,
    panX: number,
    type: OscillatorType = 'sine',
    slideTo?: number,
    delay = 0
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.canPlay()) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration * 0.85);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    this.connectVoice(osc, g, panX);
    osc.start(now);
    osc.stop(now + duration + 0.04);
  }

  impact(material: string, impact: number, panX: number) {
    const v = clamp(impact / 850, 0.08, 1);
    if (material === 'rubber') {
      this.tone(170, 0.18, 0.1 * v, panX, 'sine', 300);
      return;
    }
    if (material === 'metal' || material === 'conveyor') {
      this.tone(710 + Math.random() * 100, 0.09, 0.054 * v, panX, 'sine', 488);
      return;
    }
    this.tone(320 + Math.random() * 28, 0.072, 0.085 * v, panX, 'sine', 180);
    this.noiseBurst(0.024, 1150, 0.045 * v, panX);
  }

  bumper(panX: number) {
    this.tone(420, 0.09, 0.09, panX, 'triangle', 640);
    this.tone(840, 0.07, 0.04, panX, 'sine');
  }

  cannon(panX: number) {
    this.noiseBurst(0.16, 500, 0.09, panX);
    this.tone(80, 0.16, 0.11, panX, 'sine', 48);
  }

  boost(panX: number) {
    this.noiseBurst(0.22, 1400, 0.045, panX);
    this.tone(380, 0.18, 0.025, panX, 'sine', 720);
  }

  portal(panX: number) {
    this.noiseBurst(0.34, 1700, 0.05, panX, 'bandpass');
    this.tone(260, 0.3, 0.04, panX, 'sine', 880);
    this.tone(780, 0.26, 0.022, panX, 'triangle', 1400);
  }

  bubble(panX: number) {
    this.noiseBurst(0.1, 1400, 0.07, panX, 'bandpass');
    this.tone(260, 0.2, 0.08, panX, 'sine', 760);
    this.tone(620, 0.16, 0.035, panX, 'triangle', 980);
  }

  clack(panX: number, seated = true) {
    this.tone(seated ? 520 : 430, 0.065, seated ? 0.095 : 0.022, panX, 'triangle', 260);
    if (seated) this.tone(660, 0.12, 0.033, panX, 'sine', undefined, 0.026);
  }

  air(panX: number) {
    this.noiseBurst(0.26, 980, 0.032, panX);
    this.tone(196, 0.29, 0.037, panX, 'sine', 466);
  }

  firework(panX: number) {
    this.noiseBurst(0.14, 1800, 0.08, panX);
    this.tone(180, 0.24, 0.05, panX, 'sine', 420);
    this.tone(880, 0.18, 0.03, panX, 'sine', 1600);
  }

  pop(panX: number) {
    this.noiseBurst(0.045, 2600, 0.08, panX, 'highpass');
    this.tone(760, 0.12, 0.05, panX, 'sine', 1500);
  }

  goal(panX: number) {
    this.playChime(2, 290, panX);
    this.playChime(5, 420, panX, 0.076);
  }

  star(panX: number) {
    this.tone(1046, 0.16, 0.055, panX, 'sine');
    this.tone(1568, 0.13, 0.03, panX, 'sine');
  }

  ui() {
    if (!this.canPlay()) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastUi < 0.035) return;
    this.lastUi = now;
    this.noiseBurst(0.014, 1600, 0.027, 0, 'bandpass');
  }

  error() {
    this.tone(180, 0.12, 0.04, 0, 'triangle', 140);
    this.tone(130, 0.16, 0.035, 0, 'triangle', 100, 0.08);
  }

  dispose() {
    this.suspend();
    this.ctx = null;
  }
}
