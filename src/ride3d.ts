import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AudioEngine } from './audio';

type CamMode = 'cine' | 'chase' | 'fp';
type MarbleKind = 'crystal' | 'rubber' | 'steel' | 'comet' | 'plasma';

interface RideOptions {
  audio: AudioEngine;
  onClose: () => void;
  reduceMotion?: boolean;
}

interface Marble3D {
  mesh: THREE.Mesh;
  kind: MarbleKind;
  /** parámetro sobre la curva, 0..1 */
  u: number;
  speed: number;
  seed: number;
}

interface NoteRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  u: number;
  note: number;
  pulse: number;
  last: number;
}

interface FloatStar {
  group: THREE.Group;
  u: number;
  active: boolean;
  respawnAt: number;
}

interface BoostGate {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  pulse: number;
  u: number;
  speed: number;
}

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 20;
const MARBLE_R = 0.23;
const TUBE_R = 0.63;
const MIN_SPEED = 4.6;
const MAX_SPEED = 27;

const COLORS: Record<MarbleKind, number> = {
  crystal: 0xbfe9ff,
  rubber: 0xe8735a,
  steel: 0xd7e2ec,
  comet: 0xffb347,
  plasma: 0xb45ae8
};

const NOTE_HEX = ['#E9B44C', '#E6A447', '#E49045', '#D95D39', '#D26D8C', '#7D5BA6', '#3D7EA6', '#2E9E97'];
const NOTE_US = [0.145, 0.26, 0.38, 0.52, 0.64, 0.74, 0.86, 0.95];

let ride: Ride3D | null = null;

export function openRide3D(opts: RideOptions): void {
  if (ride) return;
  let r: Ride3D | null = null;
  try {
    r = new Ride3D(opts);
    r.init();
    ride = r;
    r.start();
    const w = window as unknown as { marblelous?: Record<string, unknown> };
    if (w.marblelous) w.marblelous.ride3d = r;
  } catch (err) {
    r?.abort();
    ride = null;
    throw err;
  }
}

/** Viaje 3D de canicas sobre un raíl de spline con gravedad real. */
class Ride3D {
  private opts: RideOptions;
  private reduced: boolean;
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;

  private curve!: THREE.CatmullRomCurve3;
  private pathLength = 1;
  private tubeMesh: THREE.Mesh | null = null;
  private wireMesh: THREE.Mesh | null = null;
  private marbles: Marble3D[] = [];
  private noteRings: NoteRing[] = [];
  private decoRings: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; seed: number }[] = [];
  private boosts: BoostGate[] = [];
  private stars: FloatStar[] = [];
  private spinners: { mesh: THREE.Object3D; speed: number; axis: THREE.Vector3 }[] = [];
  private bell: THREE.Group | null = null;

  private sparks: Spark[] = [];
  private sparkGeo = new THREE.BufferGeometry();
  private sparkPos = new Float32Array(420 * 3);
  private sparkCol = new Float32Array(420 * 3);
  private sparkPoints!: THREE.Points;
  private speedCloud!: THREE.Points;

  private mode: CamMode = 'chase';
  private follow: Marble3D | null = null;
  private orbit = { theta: 0.62, phi: 1.12, radius: 20 };
  private center = new THREE.Vector3(0, 5.2, 2.3);
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private camFov = 58;
  private targetPos = new THREE.Vector3();
  private targetQuat = new THREE.Quaternion();
  private lookHelper = new THREE.PerspectiveCamera();
  private side = new THREE.Vector3(1, 0, 0);
  private lastDir = new THREE.Vector3(1, 0, 0);
  private last = 0;
  private raf = 0;
  private running = false;
  private disposed = false;
  private dragging = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private pinchRadius = 0;
  private lastInteract = 0;
  private dropCount = 0;
  private goals = 0;
  private starsTaken = 0;
  private respawnAt: number[] = [];
  private startedAt = 0;
  private hintTimer = 0;

  private elSpeed: HTMLElement;
  private elMarbles: HTMLElement;
  private elGoals: HTMLElement;
  private elToast: HTMLElement;
  private elHint: HTMLElement;
  private toastTimer = 0;

  constructor(opts: RideOptions) {
    this.opts = opts;
    this.reduced = !!opts.reduceMotion;
    this.root = document.createElement('div');
    this.root.id = 'ride3d';
    this.root.className = 'is-hidden';
    this.root.innerHTML = `
      <canvas aria-label="Viaje 3D de canicas"></canvas>
      <div class="r3d-vignette"></div>
      <div class="r3d-fp"></div>
      <div class="r3d-top">
        <div class="r3d-brand"><b>MARBLELOUS</b><span>VIAJE 3D</span></div>
        <div class="r3d-spacer"></div>
        <button class="r3d-close" data-action="close" aria-label="Salir del modo 3D">
          <svg class="ic"><use href="#i-close"></use></svg><em>Salir</em>
        </button>
      </div>
      <div class="r3d-hint">Arrastra en Cine para orbitar · elige cámara abajo</div>
      <div class="r3d-toast" role="status"></div>
      <div class="r3d-meta">
        <div class="r3d-stat"><span>Velocidad</span><b><i data-speed>0</i><small>m/s</small></b></div>
        <div class="r3d-stat"><span>Canicas</span><b data-marbles>0</b></div>
        <div class="r3d-stat"><span>Dianas</span><b data-goals>0</b></div>
      </div>
      <div class="r3d-dock" role="toolbar" aria-label="Cámara y canicas">
        <button class="r3d-btn" data-mode="cine"><svg class="ic"><use href="#i-eye"></use></svg><em>Cine</em></button>
        <button class="r3d-btn is-active" data-mode="chase"><svg class="ic"><use href="#i-target"></use></svg><em>Persecución</em></button>
        <button class="r3d-btn" data-mode="fp"><svg class="ic"><use href="#i-marble"></use></svg><em>1ª persona</em></button>
        <button class="r3d-btn r3d-btn-accent" data-action="drop"><svg class="ic"><use href="#i-plus"></use></svg><em>Soltar canica</em></button>
        <button class="r3d-btn" data-action="reset"><svg class="ic"><use href="#i-reset"></use></svg><em>Reiniciar</em></button>
      </div>
    `;
    document.body.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas') as HTMLCanvasElement;
    this.elSpeed = this.root.querySelector('[data-speed]') as HTMLElement;
    this.elMarbles = this.root.querySelector('[data-marbles]') as HTMLElement;
    this.elGoals = this.root.querySelector('[data-goals]') as HTMLElement;
    this.elToast = this.root.querySelector('.r3d-toast') as HTMLElement;
    this.elHint = this.root.querySelector('.r3d-hint') as HTMLElement;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.76;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.045, 140);
    document.body.appendChild(this.root);
  }

  /** Cierre de emergencia si la inicialización falla. */
  abort() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.root.remove();
    this.renderer.dispose();
  }

  init() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;

    this.scene.fog = new THREE.Fog(0x0a0d14, 40, 88);
    this.buildSky();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.5;
    this.pmrem = pmrem;
    this.envRT = env;

    this.buildLights();
    this.buildTable();
    this.buildCourse();
    this.buildRings();
    this.buildStars();
    this.buildBell();
    this.buildSparks();
    this.buildPost(w, h);
    this.bindInput();

    this.root.classList.remove('is-hidden');
    this.last = performance.now();
    this.startedAt = this.last;
    this.spawnMarble('crystal', 0.004, 6);
    this.spawnMarble('comet', 0.018, 6);
    this.spawnMarble('steel', 0.032, 6);
    this.setMode('chase', true);
    this.showHint();
    this.marbleHud();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    this.updateMarbles(dt);
    this.updateRespawns(now);
    this.updateRingPulse(now);
    this.updateStars(now);
    this.updateSparks(dt);
    this.updateCamera(dt, now);
    this.updateSpeedCloud(dt);
    this.updateHud(now);

    if (this.grade) {
      this.grade.uniforms.time.value = now * 0.001;
      this.grade.uniforms.resolution.value.set(this.canvas.width, this.canvas.height);
    }
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };

  // ------------------------------------------------------------------ escena

  private buildSky() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#243449');
    g.addColorStop(0.4, '#121a28');
    g.addColorStop(0.72, '#0c111a');
    g.addColorStop(1, '#07090e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(70, 32, 20),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    this.scene.add(sky);

    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 46;
      pos[i * 3 + 1] = Math.random() * 18 - 1;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffe2b0,
        size: 0.055,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: dotTexture(),
        alphaTest: 0.02
      })
    );
    this.scene.add(motes);
    this.spinners.push({ mesh: motes, speed: 0.006, axis: new THREE.Vector3(0, 1, 0) });
  }

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0xfff0d8, 0x121a2a, 0.26);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff0d6, 1.6);
    key.position.set(9, 16, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -20;
    key.shadow.camera.right = 20;
    key.shadow.camera.top = 20;
    key.shadow.camera.bottom = -20;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 50;
    key.shadow.bias = -0.0007;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x7fc8ff, 0.55);
    rim.position.set(-12, 7, -10);
    this.scene.add(rim);

    const cyan = new THREE.PointLight(0x5fe8ff, 3.5, 9, 1.8);
    cyan.position.set(2.4, 4.6, 1.4);
    this.scene.add(cyan);

    const gold = new THREE.PointLight(0xffb454, 4.5, 12, 1.7);
    gold.position.set(-3.6, 2.4, 7.3);
    this.scene.add(gold);
  }

  private buildTable() {
    const wood = new THREE.MeshPhysicalMaterial({
      map: woodTexture(),
      color: 0x6a4528,
      roughness: 0.74,
      metalness: 0.05,
      clearcoat: 0.15,
      clearcoatRoughness: 0.55,
      envMapIntensity: 0.3
    });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(16.2, 16.6, 0.85, 96), wood);
    table.position.y = -0.46;
    table.receiveShadow = true;
    this.scene.add(table);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(16.28, 0.075, 10, 128),
      new THREE.MeshStandardMaterial({ color: 0xc9963f, metalness: 1, roughness: 0.3, envMapIntensity: 1.4 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.04;
    this.scene.add(rim);

    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 1.15),
      new THREE.MeshBasicMaterial({ map: plaqueTexture(), transparent: true, depthWrite: false })
    );
    plaque.rotation.x = -Math.PI / 2;
    plaque.position.set(0, 0.015, 11.6);
    this.scene.add(plaque);
  }

  private buildCourse() {
    this.curve = makeCourse();
    this.pathLength = this.curve.getLength();
    const geo = new THREE.TubeGeometry(this.curve, 760, TUBE_R, 14, false);

    const glass = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x9fdcff) } },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
          float a = 0.012 + f * 0.62;
          vec3 col = mix(uColor * 0.45, uColor * 1.7, f);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const tube = new THREE.Mesh(geo, glass);
    tube.renderOrder = 3;
    this.scene.add(tube);
    this.tubeMesh = tube;

    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(this.curve, 190, TUBE_R * 1.008, 6, false),
      new THREE.MeshBasicMaterial({
        color: 0x9fe8ff,
        wireframe: true,
        transparent: true,
        opacity: 0.02,
        depthWrite: false,
        fog: false
      })
    );
    wire.renderOrder = 4;
    this.scene.add(wire);
    this.wireMesh = wire;

    const legMat = new THREE.MeshStandardMaterial({ color: 0x3f4a58, metalness: 0.9, roughness: 0.35 });
    const clampMat = new THREE.MeshStandardMaterial({
      color: 0xc9963f,
      metalness: 1,
      roughness: 0.3,
      emissive: 0x2a1a05,
      emissiveIntensity: 0.4
    });
    for (const t of [0.035, 0.09, 0.16, 0.225, 0.62, 0.72, 0.84, 0.97]) {
      const p = this.curve.getPointAt(t);
      if (p.y < 1.1) continue;
      const h = p.y;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, h, 8), legMat);
      leg.position.set(p.x, h / 2, p.z);
      leg.castShadow = true;
      this.scene.add(leg);
      const clamp = new THREE.Mesh(new THREE.TorusGeometry(TUBE_R + 0.035, 0.035, 8, 24), clampMat);
      clamp.position.copy(p);
      clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.curve.getTangentAt(t));
      this.scene.add(clamp);
    }

    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(TUBE_R + 0.12, 0.075, 10, 40),
      new THREE.MeshStandardMaterial({
        color: 0xe9b44c,
        metalness: 1,
        roughness: 0.25,
        emissive: 0x6b3f06,
        emissiveIntensity: 0.6
      })
    );
    gate.position.copy(this.curve.getPointAt(0.002));
    gate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.curve.getTangentAt(0.002));
    this.scene.add(gate);

    const start = this.curve.getPointAt(0.0005);
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, TUBE_R, 0.85, 32, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: 0xbfe9ff,
        transparent: true,
        opacity: 0.14,
        roughness: 0.05,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        envMapIntensity: 1.6
      })
    );
    cone.position.set(start.x - 0.1, start.y + 0.5, start.z);
    this.scene.add(cone);
  }

  private buildRings() {
    for (let i = 0; i < 10; i++) {
      const t = 0.03 + (i / 10) * 0.93;
      const p = this.curve.getPointAt(t);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0d2b33,
        emissive: 0x4fe6ff,
        emissiveIntensity: 0.7,
        metalness: 0.4,
        roughness: 0.35
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(TUBE_R + 0.03, 0.02, 8, 32), mat);
      ring.position.copy(p);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.curve.getTangentAt(t));
      this.scene.add(ring);
      this.decoRings.push({ mesh: ring, mat, seed: i * 0.7 });
    }

    for (let i = 0; i < NOTE_US.length; i++) {
      const u = NOTE_US[i];
      const p = this.curve.getPointAt(u);
      const color = new THREE.Color(NOTE_HEX[i % NOTE_HEX.length]);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x160f08,
        emissive: color,
        emissiveIntensity: 1.5,
        metalness: 0.5,
        roughness: 0.3
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(TUBE_R + 0.1, 0.045, 10, 40), mat);
      ring.position.copy(p);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.curve.getTangentAt(u));
      this.scene.add(ring);
      this.noteRings.push({ mesh: ring, mat, u, note: i, pulse: 0, last: 0 });
    }

    this.buildBoost(0.185, 16, 0x5fe8ff);
    this.buildBoost(0.42, 15, 0x5fe8ff);
    this.buildBoost(0.62, 14, 0xe9b44c);
    this.buildBoost(0.82, 14, 0xe9b44c);
  }

  private buildBoost(u: number, speed: number, color: number) {
    const p = this.curve.getPointAt(u);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a1014,
      emissive: color,
      emissiveIntensity: 2.4,
      metalness: 0.7,
      roughness: 0.25
    });    const ring = new THREE.Mesh(new THREE.TorusGeometry(TUBE_R + 0.18, 0.065, 10, 48), mat);
    ring.position.copy(p);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.curve.getTangentAt(u));
    this.scene.add(ring);
    this.boosts.push({ mesh: ring, mat, pulse: 0, u, speed });
  }

  private buildStars() {
    for (const u of [0.31, 0.55, 0.78]) {
      const p = this.curve.getPointAt(u);
      const tan = this.curve.getTangentAt(u);
      const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
      const group = new THREE.Group();
      group.position.copy(p).addScaledVector(side, 0.22).addScaledVector(UP, 0.14);
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.15, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffe6a4,
          emissive: 0xffb83c,
          emissiveIntensity: 2.6,
          metalness: 0.6,
          roughness: 0.2
        })
      );
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.28, 0.02, 6, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd77a, transparent: true, opacity: 0.8 })
      );
      halo.rotation.x = Math.PI / 2;
      group.add(core, halo);
      this.scene.add(group);
      this.stars.push({ group, u, active: true, respawnAt: 0 });
      this.spinners.push({ mesh: group, speed: 1.4, axis: new THREE.Vector3(0, 1, 0) });
    }
  }

  private buildBell() {
    const g = new THREE.Group();
    g.position.set(-3.6, 0.02, 7.25);
    const profile: THREE.Vector2[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const r = 0.34 + 0.72 * Math.pow(t, 1.7);
      profile.push(new THREE.Vector2(r, t * 1.18));
    }
    const brass = new THREE.MeshPhysicalMaterial({
      color: 0xd9a53c,
      metalness: 1,
      roughness: 0.24,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.8,
      side: THREE.DoubleSide
    });
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), brass);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.06, 0.055, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0xf2cf87, metalness: 1, roughness: 0.2 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.18;
    g.add(rim);

    const clapper = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x3b2a12, metalness: 0.7, roughness: 0.4 })
    );
    clapper.position.y = 0.62;
    g.add(clapper);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.5, 0.16, 48),
      new THREE.MeshPhysicalMaterial({ color: 0x53331d, roughness: 0.5, clearcoat: 0.4 })
    );
    base.position.y = 0.02;
    base.receiveShadow = true;
    g.add(base);
    this.scene.add(g);
    this.bell = g;
  }

  private buildSparks() {
    const geo = this.sparkGeo;
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 0.14,
      map: dotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    this.sparkPoints = new THREE.Points(geo, mat);
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);

    // Polvo de velocidad: puntos locales a la cámara que se reciclan al pasar.
    const n = 180;
    const sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      sp[i * 3] = (Math.random() - 0.5) * 9;
      sp[i * 3 + 1] = (Math.random() - 0.5) * 6;
      sp[i * 3 + 2] = -2 - Math.random() * 14;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.speedCloud = new THREE.Points(
      sgeo,
      new THREE.PointsMaterial({
        color: 0xbfe9ff,
        size: 0.045,
        map: dotTexture(),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      })
    );
    this.speedCloud.frustumCulled = false;
    this.speedCloud.visible = false;
    this.scene.add(this.speedCloud);
  }

  private buildPost(w: number, h: number) {
    const composer = new EffectComposer(this.renderer);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.18, 0.65, 0.95);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        resolution: { value: new THREE.Vector2(w, h) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform vec2 resolution;
        varying vec2 vUv;
        float hash(vec2 p){
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        void main(){
          vec2 uv = vUv;
          vec2 d = uv - 0.5;
          float r2 = dot(d, d);
          float ab = 0.0016 * (0.35 + r2 * 2.2);
          vec3 c;
          c.r = texture2D(tDiffuse, uv + d * ab).r;
          c.g = texture2D(tDiffuse, uv).g;
          c.b = texture2D(tDiffuse, uv - d * ab).b;
          float vig = smoothstep(0.92, 0.18, length(d) * 1.28);
          c *= mix(0.68, 1.0, vig);
          float grain = (hash(uv * resolution + time * 37.0) - 0.5) * 0.05;
          c += grain;
          c = mix(c, c * vec3(1.035, 1.0, 0.955), 0.55);
          gl_FragColor = vec4(c, 1.0);
        }
      `
    });
    composer.addPass(grade);
    this.composer = composer;
    this.bloom = bloom;
    this.grade = grade;
  }

  // ---------------------------------------------------------------- canicas

  private spawnMarble(kind: MarbleKind = 'crystal', u = 0.004, speed = 6) {
    if (this.marbles.length >= 9) return;
    const p = this.curve.getPointAt(Math.min(0.99, u));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(MARBLE_R, 36, 26), marbleMaterial(kind));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(p);
    this.scene.add(mesh);

    const m: Marble3D = { mesh, kind, u, speed, seed: Math.random() * 10 };
    this.marbles.push(m);
    if (this.mode !== 'cine' || !this.follow) this.follow = m;
    this.dropCount++;
    this.marbleHud();
  }

  private removeMarble(m: Marble3D) {
    m.mesh.geometry.dispose();
    (m.mesh.material as THREE.Material).dispose();
    this.scene.remove(m.mesh);
    const i = this.marbles.indexOf(m);
    if (i >= 0) this.marbles.splice(i, 1);
    if (this.follow === m) {
      this.follow = this.pickFollow();
      if (!this.follow && this.mode !== 'cine') this.setMode('cine');
    }
    this.marbleHud();
  }

  private pickFollow(): Marble3D | null {
    let best: Marble3D | null = null;
    for (const m of this.marbles) {
      if (!best || m.u > best.u) best = m;
    }
    return best ?? this.marbles[0] ?? null;
  }

  private updateMarbles(dt: number) {
    for (let i = this.marbles.length - 1; i >= 0; i--) {
      const m = this.marbles[i];
      const u = Math.min(0.999, m.u);
      const tan = this.curve.getTangentAt(u);
      // Gravedad proyectada sobre la tangente + algo de resistencia.
      const accel = GRAVITY * -tan.y * 0.95;
      m.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, m.speed + (accel - m.speed * 0.035) * dt));

      const prev = m.u;
      m.u += (m.speed * dt) / this.pathLength;
      if (m.u >= 0.995) {
        this.goal(m);
        continue;
      }

      const p = this.curve.getPointAt(m.u);
      const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      const sway = Math.sin(m.u * 46 + m.seed) * 0.06;
      m.mesh.position.copy(p).addScaledVector(side, sway);
      const nearCam = m.mesh.position.distanceTo(this.camera.position) < 1.2;
      m.mesh.visible = !(this.mode === 'fp' && (m === this.follow || nearCam));
      m.mesh.rotateOnWorldAxis(side, (m.speed * dt) / MARBLE_R);
      m.mesh.rotateOnWorldAxis(tan, dt * 0.35);

      for (const ring of this.noteRings) {
        if (prev < ring.u && m.u >= ring.u) this.hitRing(ring, m);
      }
      for (const b of this.boosts) {
        if (prev < b.u && m.u >= b.u) this.applyBoost(m, b);
      }
      for (const s of this.stars) {
        if (s.active && prev < s.u && m.u >= s.u) this.takeStar(s);
      }
    }
  }

  private updateRespawns(now: number) {
    if (!this.respawnAt.length) return;
    while (this.respawnAt.length && now >= this.respawnAt[0]) {
      this.respawnAt.shift();
      if (this.marbles.length < 6) this.spawnMarble(this.cycleKind(), 0.004, 6);
    }
  }

  private cycleKind(): MarbleKind {
    const kinds: MarbleKind[] = ['crystal', 'comet', 'steel', 'rubber', 'plasma'];
    return kinds[this.dropCount % kinds.length];
  }

  private hitRing(ring: NoteRing, marble?: Marble3D) {
    const now = performance.now();
    if (now - ring.last < 220) return;
    ring.last = now;
    ring.pulse = 1;
    const pan = marble ? Math.max(-1, Math.min(1, marble.mesh.position.x / 14)) : 0;
    this.opts.audio.playChime(ring.note, 780, pan);
    const c = new THREE.Color(NOTE_HEX[ring.note % NOTE_HEX.length]);
    this.burst(ring.mesh.position, c.getHex(), 14, 2.6);
  }

  private applyBoost(m: Marble3D, boost: BoostGate) {
    m.speed = Math.max(m.speed, boost.speed);
    boost.pulse = 1;
    const pan = Math.max(-1, Math.min(1, m.mesh.position.x / 14));
    this.opts.audio.portal(pan);
    this.burst(m.mesh.position, 0x5fe8ff, 16, 3.2);
  }

  private takeStar(star: FloatStar) {
    if (!star.active) return;
    star.active = false;
    star.group.visible = false;
    this.starsTaken++;
    star.respawnAt = performance.now() + 6500;
    this.opts.audio.star(0);
    this.burst(star.group.position, 0xffd166, 22, 3.2);
    this.toast('Estrella +1');
  }

  private goal(m: Marble3D) {
    this.goals++;
    this.opts.audio.goal(0);
    const p = new THREE.Vector3(-3.6, 1.55, 7.25);
    this.burst(p, 0xffd166, 46, 5.5);
    this.burst(p, 0xd26d8c, 22, 4);
    this.toast(this.goals === 1 ? '¡Primera diana!' : `¡Diana! · ${this.goals}`);
    if (this.bell) this.bell.userData.hit = performance.now();
    this.removeMarble(m);
    this.respawnAt.push(performance.now() + 1100);
    this.marbleHud();
  }

  private burst(pos: THREE.Vector3, color: number, count: number, speed: number) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= 420) this.sparks.shift();
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.35 + Math.random() * 0.8);
      this.sparks.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: Math.cos(a) * Math.cos(b) * s,
        vy: Math.sin(b) * s + 1.4,
        vz: Math.sin(a) * Math.cos(b) * s,
        life: 0.7 + Math.random() * 0.7,
        max: 1.4,
        r: c.r,
        g: c.g,
        b: c.b
      });
    }
  }

  private updateSparks(dt: number) {
    const n = Math.min(this.sparks.length, 420);
    for (let i = 0; i < n; i++) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparkPos[i * 3 + 1] = -999;
        this.sparkCol[i * 3] = 0;
        this.sparkCol[i * 3 + 1] = 0;
        this.sparkCol[i * 3 + 2] = 0;
        continue;
      }
      s.vy -= 7 * dt;
      s.vx *= 1 - dt * 1.4;
      s.vz *= 1 - dt * 1.4;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const f = Math.min(1, s.life / 0.5);
      this.sparkPos[i * 3] = s.x;
      this.sparkPos[i * 3 + 1] = s.y;
      this.sparkPos[i * 3 + 2] = s.z;
      this.sparkCol[i * 3] = s.r * f;
      this.sparkCol[i * 3 + 1] = s.g * f;
      this.sparkCol[i * 3 + 2] = s.b * f;
    }
    this.sparkGeo.setDrawRange(0, n);
    (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    if (this.sparks.length) this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  private updateSpeedCloud(dt: number) {
    const speed = this.follow?.speed ?? 0;
    const active = !this.reduced && this.mode !== 'cine' && speed > 4.5;
    this.speedCloud.visible = active;
    if (!active) return;
    const attr = this.speedCloud.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const step = speed * dt * 1.15;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 2] += step;
      if (arr[i + 2] > 2) {
        arr[i + 2] -= 16;
        arr[i] = (Math.random() - 0.5) * 9;
        arr[i + 1] = (Math.random() - 0.5) * 6;
      }
    }
    attr.needsUpdate = true;
    this.speedCloud.position.copy(this.camera.position);
    this.speedCloud.quaternion.copy(this.camera.quaternion);
  }

  private updateRingPulse(now: number) {
    const cam = this.camera.position;
    const near = 2.0;
    for (let i = 0; i < this.decoRings.length; i++) {
      const r = this.decoRings[i];
      const wave = 0.55 + 0.45 * Math.sin(now * 0.0016 - r.seed);
      r.mat.emissiveIntensity = 0.2 + wave * 0.35;
      r.mesh.visible = r.mesh.position.distanceTo(cam) > near;
    }
    for (const r of this.noteRings) {
      r.pulse = Math.max(0, r.pulse - 0.02);
      r.mesh.scale.setScalar(1 + r.pulse * 0.16);
      r.mat.emissiveIntensity = 0.55 + r.pulse * 3;
      r.mesh.visible = r.mesh.position.distanceTo(cam) > near;
    }
    for (const b of this.boosts) {
      b.pulse = Math.max(0, b.pulse - 0.03);
      b.mat.emissiveIntensity = 1.1 + b.pulse * 5;
      b.mesh.visible = b.mesh.position.distanceTo(cam) > near;
    }
    for (const s of this.spinners) s.mesh.rotateOnAxis(s.axis, s.speed * 0.016);
    if (this.bell?.userData.hit) {
      const age = (performance.now() - (this.bell.userData.hit as number)) / 1000;
      this.bell.rotation.z = age < 1 ? Math.sin(age * 26) * 0.05 * Math.exp(-age * 3) : 0;
    }
  }

  private updateStars(now: number) {
    for (const s of this.stars) {
      if (!s.active) {
        if (now >= s.respawnAt) {
          s.active = true;
          s.group.visible = true;
          s.group.scale.setScalar(0.2);
        }
      } else if (s.group.scale.x < 1) {
        s.group.scale.setScalar(Math.min(1, s.group.scale.x + 0.06));
      }
      s.group.visible = s.active && s.group.position.distanceTo(this.camera.position) > 1.1;
    }
  }

  // ---------------------------------------------------------------- cámara

  setMode(mode: CamMode, instant = false) {
    this.mode = mode;
    this.root.classList.toggle('is-fp', mode === 'fp');
    if (this.tubeMesh) this.tubeMesh.visible = true;
    if (this.wireMesh) {
      this.wireMesh.visible = true;
      (this.wireMesh.material as THREE.MeshBasicMaterial).opacity = mode === 'fp' ? 0.09 : 0.02;
    }
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-mode]')) {
      b.classList.toggle('is-active', b.dataset.mode === mode);
    }
    if (mode !== 'cine') {
      if (!this.follow) this.follow = this.pickFollow();
      this.lastInteract = 0;
    }
    if (instant) {
      this.computeCamera(0.016, performance.now());
      this.camPos.copy(this.targetPos);
      this.camQuat.copy(this.targetQuat);
      this.camera.position.copy(this.camPos);
      this.camera.quaternion.copy(this.camQuat);
    }
  }

  private updateCamera(dt: number, now: number) {
    const idle = (now - this.lastInteract) / 1000;
    if (this.mode === 'cine' && !this.dragging && idle > 3.5) {
      this.orbit.theta += dt * 0.075;
    }
    this.computeCamera(dt, now);
    const k = 1 - Math.exp(-dt * (this.mode === 'fp' ? 40 : this.mode === 'chase' ? 26 : 10));
    this.camPos.lerp(this.targetPos, k);
    this.camQuat.slerp(this.targetQuat, 1 - Math.exp(-dt * (this.mode === 'cine' ? 8 : 18)));
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);

    const speed = this.follow?.speed ?? 0;
    const base = this.mode === 'fp' ? 74 : this.mode === 'chase' ? 60 : 44;
    const target = base + (this.reduced || this.mode === 'cine' ? 0 : Math.min(1, speed / 20) * 9);
    this.camFov += (target - this.camFov) * (1 - Math.exp(-dt * 3.5));
    if (Math.abs(this.camera.fov - this.camFov) > 0.02) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }
    if (this.mode !== 'cine' && !this.follow) this.setMode('cine');
  }

  private computeCamera(dt: number, _now: number) {
    if (this.mode === 'cine' || !this.follow) {
      const { theta, phi, radius } = this.orbit;
      this.targetPos.set(
        this.center.x + radius * Math.sin(phi) * Math.sin(theta),
        this.center.y + radius * Math.cos(phi),
        this.center.z + radius * Math.sin(phi) * Math.cos(theta)
      );
      this.lookHelper.position.copy(this.targetPos);
      this.lookHelper.lookAt(this.center.x, this.center.y + 0.2, this.center.z);
      this.targetQuat.copy(this.lookHelper.quaternion);
      return;
    }

    const m = this.follow;
    const u = Math.min(0.999, m.u);
    const tan = this.curve.getTangentAt(u);
    this.lastDir.lerp(tan, 1 - Math.exp(-dt * 5)).normalize();
    const tr = m.mesh.position;
    const dir = this.lastDir;

    if (this.mode === 'fp') {
      this.targetPos.set(tr.x + dir.x * 0.03, tr.y + 0.05, tr.z + dir.z * 0.03);
      this.lookHelper.position.copy(this.targetPos);
      this.lookHelper.lookAt(
        tr.x + dir.x * 4,
        tr.y + dir.y * 3 + 1.0,
        tr.z + dir.z * 4
      );
      this.targetQuat.copy(this.lookHelper.quaternion);
    } else {
      const sideTarget = new THREE.Vector3().crossVectors(dir, UP);
      if (sideTarget.lengthSq() < 0.001) sideTarget.set(1, 0, 0);
      else sideTarget.normalize();
      this.side.lerp(sideTarget, 1 - Math.exp(-dt * 2.4)).normalize();
      const back = 1.4 + Math.min(0.8, m.speed * 0.02);
      this.targetPos.set(
        tr.x - dir.x * back + this.side.x * 2.6,
        tr.y - dir.y * back + 1.4,
        tr.z - dir.z * back + this.side.z * 2.6
      );
      if (this.targetPos.y < 1.0) this.targetPos.y = 1.0;
      this.lookHelper.position.copy(this.targetPos);
      this.lookHelper.lookAt(tr.x + dir.x * 0.7, tr.y + 0.1, tr.z + dir.z * 0.7);
      this.targetQuat.copy(this.lookHelper.quaternion);
    }
  }

  // ---------------------------------------------------------------- entrada

  private bindInput() {
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.root.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
  }

  private onDown = (e: PointerEvent) => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchRadius = this.orbit.radius;
    }
    if (this.pointers.size === 1 && this.mode === 'cine') this.dragging = true;
    this.lastInteract = performance.now();
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.lastInteract = performance.now();
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinchDist > 1) {
        this.orbit.radius = Math.max(9, Math.min(34, (this.pinchRadius * this.pinchDist) / Math.max(1, d)));
      }
      return;
    }
    if (!this.dragging) return;
    this.orbit.theta -= (e.clientX - prev.x) * 0.006;
    this.orbit.phi = Math.max(0.3, Math.min(1.42, this.orbit.phi + (e.clientY - prev.y) * 0.005));
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.pointers.size === 0) this.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (this.mode !== 'cine') return;
    e.preventDefault();
    this.orbit.radius = Math.max(9, Math.min(34, this.orbit.radius * Math.exp(e.deltaY * 0.0011)));
    this.lastInteract = performance.now();
  };

  private onClick = (e: Event) => {
    const el = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!el) return;
    const mode = el.dataset.mode as CamMode | undefined;
    if (mode) {
      this.opts.audio.ui();
      this.setMode(mode);
      this.hideHint();
      return;
    }
    const action = el.dataset.action;
    if (action === 'close') this.close();
    else if (action === 'drop') {
      this.opts.audio.ui();
      this.spawnMarble(this.cycleKind(), 0.004, 6);
      if (this.mode === 'cine') this.setMode('chase');
      this.hideHint();
    } else if (action === 'reset') {
      this.resetRide();
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.close();
      return;
    }
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === '1') this.setMode('cine');
    else if (e.key === '2') this.setMode('chase');
    else if (e.key === '3') this.setMode('fp');
    else if (e.code === 'Space') {
      e.preventDefault();
      this.spawnMarble(this.cycleKind(), 0.004, 6);
    }
  };

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
  };

  private resetRide() {
    for (const m of [...this.marbles]) this.removeMarble(m);
    this.respawnAt = [];
    this.goals = 0;
    this.starsTaken = 0;
    this.follow = null;
    for (const s of this.stars) {
      s.active = true;
      s.group.visible = true;
      s.group.scale.setScalar(1);
    }
    this.toast('Viaje reiniciado');
    this.spawnMarble('crystal', 0.004, 6);
    this.spawnMarble('comet', 0.018, 6);
    this.setMode('chase');
    this.marbleHud();
  }

  // ---------------------------------------------------------------- HUD

  private showHint() {
    this.elHint.classList.add('is-show');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hideHint(), 7000);
  }

  private hideHint() {
    this.elHint.classList.remove('is-show');
  }

  private toast(text: string) {
    this.elToast.textContent = text;
    this.elToast.classList.add('is-show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.elToast.classList.remove('is-show'), 2100);
  }

  private marbleHud() {
    this.elMarbles.textContent = `${this.marbles.length}`;
    this.elGoals.textContent = `${this.goals}`;
  }

  private updateHud(now: number) {
    this.elSpeed.textContent = (this.follow?.speed ?? 0).toFixed(1);
    if (now - this.startedAt > 14000 && this.elHint.classList.contains('is-show')) this.hideHint();
  }

  // ---------------------------------------------------------------- ciclo

  close() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.root.removeEventListener('click', this.onClick);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.hintTimer);
    this.pmrem?.dispose();
    this.envRT?.dispose();
    this.composer?.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => disposeMaterial(m));
      else if (mat) disposeMaterial(mat);
    });
    this.renderer.dispose();
    this.root.remove();
    ride = null;
    this.opts.onClose();
  }
}

// ------------------------------------------------------------------ utilidades

function makeCourse(): THREE.CatmullRomCurve3 {
  const p: THREE.Vector3[] = [];
  const add = (x: number, y: number, z: number) => p.push(new THREE.Vector3(x, y, z));

  add(-11.6, 10.8, -4.6);
  add(-10.2, 10.2, -4.5);
  add(-8.6, 9.4, -4.2);
  add(-7.0, 8.5, -3.6);
  add(-5.6, 7.6, -2.6);
  add(-4.6, 6.9, -1.2);
  add(-4.0, 6.3, 0.4);
  add(-3.6, 5.7, 1.9);
  add(-2.8, 4.9, 2.6);
  add(-2.2, 4.4, 2.2);
  add(-1.8, 4.2, 1.2);
  add(-1.2, 4.05, 0.2);
  add(-0.2, 4.0, -0.7);
  add(1.0, 4.0, -1.2);

  // Sacacorchos descendente (1,25 vueltas). Cada vuelta baja más que el
  // diámetro del tubo, así que las espiras no se tocan.
  const sx = 3.0;
  const sz = 1.0;
  const sr = 2.2;
  for (let a = 270; a <= 720; a += 15) {
    const t = (a * Math.PI) / 180;
    const f = (a - 270) / 450;
    add(sx + Math.cos(t) * sr, 4.0 - 2.6 * f, sz + Math.sin(t) * sr);
  }

  add(5.6, 1.45, 2.6);
  add(5.9, 1.6, 3.2);

  const hx = 6.9;
  const hz = 4.6;
  const hr = 1.55;
  for (let a = -90; a <= 630; a += 15) {
    const t = (a * Math.PI) / 180;
    const f = (a + 90) / 720;
    add(hx + Math.cos(t) * hr, 2.1 - 1.55 * f, hz + Math.sin(t) * hr);
  }

  add(9.0, 0.58, 3.2);
  add(9.6, 0.6, 4.3);
  add(9.1, 0.66, 5.8);
  add(7.0, 0.72, 7.0);
  add(4.0, 0.78, 7.8);
  add(0.6, 0.86, 8.1);
  add(-2.0, 1.0, 8.0);
  add(-3.4, 1.45, 7.5);
  add(-3.6, 1.95, 7.25);

  return new THREE.CatmullRomCurve3(p, false, 'centripetal', 0.5);
}

function marbleMaterial(kind: MarbleKind): THREE.Material {
  if (kind === 'steel') {
    return new THREE.MeshPhysicalMaterial({
      color: 0xdbe6f0,
      metalness: 1,
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 2.2
    });
  }
  if (kind === 'rubber') {
    return new THREE.MeshPhysicalMaterial({
      color: COLORS.rubber,
      roughness: 0.88,
      metalness: 0,
      clearcoat: 0.12,
      envMapIntensity: 0.7
    });
  }
  if (kind === 'comet') {
    return new THREE.MeshPhysicalMaterial({
      color: COLORS.comet,
      roughness: 0.18,
      metalness: 0.15,
      clearcoat: 1,
      emissive: 0xff7a12,
      emissiveIntensity: 1.1,
      envMapIntensity: 1.6
    });
  }
  if (kind === 'plasma') {
    return new THREE.MeshPhysicalMaterial({
      color: COLORS.plasma,
      roughness: 0.1,
      metalness: 0.35,
      clearcoat: 1,
      iridescence: 1,
      iridescenceIOR: 1.6,
      emissive: 0x2fd8c8,
      emissiveIntensity: 1.2,
      envMapIntensity: 2.2
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: COLORS.crystal,
    roughness: 0.04,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.82,
    envMapIntensity: 2.6,
    iridescence: 0.25
  });
}

let dot: THREE.CanvasTexture | null = null;

function dotTexture(): THREE.CanvasTexture {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dot = new THREE.CanvasTexture(c);
  return dot;
}

function woodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4a2f1d';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 190; i++) {
    const y = Math.random() * 512;
    const w = 20 + Math.random() * 260;
    const a = 0.03 + Math.random() * 0.09;
    ctx.strokeStyle = `rgba(${20 + Math.random() * 50}, ${12 + Math.random() * 24}, ${6 + Math.random() * 12}, ${a})`;
    ctx.lineWidth = 0.6 + Math.random() * 2.6;
    ctx.beginPath();
    ctx.moveTo(Math.random() * 512, y);
    ctx.bezierCurveTo(140, y + 8, 330, y - 10, Math.random() * 512 + w * 0.2, y + 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function plaqueTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 226;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(12,10,8,0.55)';
  roundRect(ctx, 8, 8, 1008, 210, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(233,180,76,0.75)';
  ctx.lineWidth = 3;
  roundRect(ctx, 20, 20, 984, 186, 20);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0cd86';
  ctx.font = '800 62px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
  ctx.fillText('MARBLELOUS', 512, 86);
  ctx.fillStyle = 'rgba(240,205,134,0.78)';
  ctx.font = '700 26px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
  ctx.fillText('V I A J E   3 D', 512, 154);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

function disposeMaterial(m: THREE.Material) {
  const anyMat = m as THREE.Material & {
    map?: THREE.Texture | null;
    envMap?: THREE.Texture | null;
    emissiveMap?: THREE.Texture | null;
  };
  anyMat.map?.dispose();
  anyMat.envMap?.dispose();
  anyMat.emissiveMap?.dispose();
  m.dispose();
}
