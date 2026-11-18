import { clamp, makeCanvas } from './util';

/**
 * Pase de post-proceso en Canvas 2D, pensado para GPU y para iPad:
 *  - bloom suave: copia a baja resolución sumada en modo `lighter`
 *  - tilt-shift: la misma copia difuminada aparece arriba y abajo
 *  - aberración cromática sutil en los bordes (solo calidad alta)
 *  - grano de película animado
 *  - viñeta cálida horneada
 *
 * Todo se calcula a resolución de dispositivo, pero las copias auxiliares se
 * hacen a 1/4 para que el coste sea despreciable incluso en pantallas Retina.
 */
export class PostFX {
  private w = 1;
  private h = 1;
  private dpr = 1;
  private lowW = 1;
  private lowH = 1;
  private low: HTMLCanvasElement | null = null;
  private lowCtx: CanvasRenderingContext2D | null = null;
  private tintR: HTMLCanvasElement | null = null;
  private tintC: HTMLCanvasElement | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private grain: HTMLCanvasElement | null = null;
  private grainPattern: CanvasPattern | null = null;
  private lowScale = 0.3;

  resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    // En pantallas muy grandes bajamos aún más la resolución del pase suave.
    this.lowScale = w * h > 3_200_000 ? 0.22 : 0.3;
    this.lowW = Math.max(1, Math.round(w * this.lowScale));
    this.lowH = Math.max(1, Math.round(h * this.lowScale));
    this.low = makeCanvas(this.lowW, this.lowH);
    this.lowCtx = this.low.getContext('2d');
    this.tintR = makeCanvas(this.lowW, this.lowH);
    this.tintC = makeCanvas(this.lowW, this.lowH);
    this.vignette = this.buildVignette(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    if (!this.grain) this.grain = this.buildGrain();
  }

  /**
   * Se llama al final de cada frame. `level`: 0 alta, 1 media, 2 baja.
   */
  apply(
    ctx: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    cssW: number,
    cssH: number,
    dpr: number,
    level: number,
    now: number
  ) {
    this.resize(cssW, cssH, dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (!this.low || !this.lowCtx) return;

    if (level >= 2) {
      // Calidad baja: solo viñeta, sin copias ni desenfoques.
      if (this.vignette) ctx.drawImage(this.vignette, 0, 0, this.w, this.h);
      return;
    }

    const low = this.low;
    const lctx = this.lowCtx;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, low.width, low.height);
    lctx.imageSmoothingEnabled = true;
    lctx.drawImage(source, 0, 0, low.width, low.height);

    // Bloom: suma de la copia reducida. Muy bajo para no lavar la escena.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.07;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(low, 0, 0, this.w, this.h);
    ctx.restore();

    if (level === 0) {
      this.chromatic(ctx, low);
      this.bokehBands(ctx, low);
    }

    this.drawGrain(ctx, now, level === 0 ? 0.04 : 0.025);
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, this.w, this.h);
  }

  /** Aberración cromática: canales R y C desplazados, fundidos en `screen`. */
  private chromatic(ctx: CanvasRenderingContext2D, low: HTMLCanvasElement) {
    if (!this.tintR || !this.tintC) return;
    this.tintCopy(low, this.tintR, '#ff2a1e');
    this.tintCopy(low, this.tintC, '#22e8ff');
    const off = Math.max(0.6, this.dpr * 0.55);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tintR, off, 0, this.w, this.h);
    ctx.drawImage(this.tintC, -off, 0, this.w, this.h);
    ctx.restore();
  }

  private tintCopy(src: HTMLCanvasElement, dst: HTMLCanvasElement, color: string) {
    const ctx = dst.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, dst.width, dst.height);
    ctx.drawImage(src, 0, 0);
    // multiply conserva solo el canal del color indicado.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, dst.width, dst.height);
    // ...pero rellena también las zonas transparentes: recuperamos el alfa.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Tilt-shift: arriba y abajo se sustituyen por la copia difuminada. */
  private bokehBands(ctx: CanvasRenderingContext2D, low: HTMLCanvasElement) {
    const lctx = this.lowCtx;
    if (!lctx) return;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.save();
    lctx.globalCompositeOperation = 'destination-in';
    const g = lctx.createLinearGradient(0, 0, 0, low.height);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.08, 'rgba(0,0,0,0.45)');
    g.addColorStop(0.17, 'rgba(0,0,0,0)');
    g.addColorStop(0.83, 'rgba(0,0,0,0)');
    g.addColorStop(0.92, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0.9)');
    lctx.fillStyle = g;
    lctx.fillRect(0, 0, low.width, low.height);
    lctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(low, 0, 0, this.w, this.h);
    ctx.restore();
  }

  private drawGrain(ctx: CanvasRenderingContext2D, now: number, alpha: number) {
    if (!this.grain) return;
    if (!this.grainPattern) {
      try {
        this.grainPattern = ctx.createPattern(this.grain, 'repeat');
      } catch {
        return;
      }
    }
    if (!this.grainPattern) return;
    const size = this.grain.width;
    const ox = Math.floor(now * 0.07) % size;
    const oy = Math.floor(now * 0.11) % size;
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = alpha;
    ctx.translate(ox, oy);
    ctx.fillStyle = this.grainPattern;
    ctx.fillRect(-ox, -oy, this.w, this.h);
    ctx.restore();
  }

  private buildVignette(w: number, h: number): HTMLCanvasElement {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.max(w, h) * 0.74;
    const g = ctx.createRadialGradient(cx, cy, r * 0.38, cx, cy, r);
    g.addColorStop(0, 'rgba(35,33,28,0)');
    g.addColorStop(0.58, 'rgba(35,33,28,0.045)');
    g.addColorStop(1, 'rgba(35,33,28,0.24)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Un poco de penumbra inferior: asienta la escena como un diorama.
    const b = ctx.createLinearGradient(0, h * 0.72, 0, h);
    b.addColorStop(0, 'rgba(35,33,28,0)');
    b.addColorStop(1, 'rgba(35,33,28,0.09)');
    ctx.fillStyle = b;
    ctx.fillRect(0, h * 0.72, w, h * 0.28);

    // Luz cálida de estudio arriba a la izquierda.
    const l = ctx.createRadialGradient(w * 0.16, h * 0.06, 0, w * 0.16, h * 0.06, Math.max(w, h) * 0.62);
    l.addColorStop(0, 'rgba(255,252,240,0.1)');
    l.addColorStop(1, 'rgba(255,252,240,0)');
    ctx.fillStyle = l;
    ctx.fillRect(0, 0, w, h);
    return c;
  }

  private buildGrain(): HTMLCanvasElement {
    const size = 160;
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    let seed = 0x9e3779b9;
    for (let i = 0; i < img.data.length; i += 4) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const v = 128 + (((seed >>> 0) / 4294967295 - 0.5) * 46) | 0;
      img.data[i] = clamp(v, 0, 255);
      img.data[i + 1] = clamp(v, 0, 255);
      img.data[i + 2] = clamp(v, 0, 255);
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
