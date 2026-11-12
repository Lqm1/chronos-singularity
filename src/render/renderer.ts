import { computeBinaryCenters, getCameraPosition } from '../core/physics.ts';
import type { CameraState, QualityMode, RogueStar, ShockwaveEvent, SimParams, Vec3 } from '../core/types.ts';
import {
  compileShader,
  createProgram,
  createRenderTarget,
  destroyRenderTarget,
  getUniformLocations,
  type RenderTarget,
  type TextureSpec,
} from './glUtils.ts';
import { BLACKHOLE_FRAG } from './shaders/blackhole.glsl.ts';
import { FULLSCREEN_VERT } from './shaders/common.glsl.ts';
import { GRID_FRAG, GRID_VERT, PARTICLE_FRAG, PARTICLE_VERT } from './shaders/overlay3d.glsl.ts';
import { BLUR_FRAG, BRIGHT_PASS_FRAG, COMPOSITE_FRAG } from './shaders/post.glsl.ts';

const FOV_DEG = 52;
const TAN_HALF_FOV = Math.tan((FOV_DEG * Math.PI) / 360);
const MAX_PARTICLES = 1800;
const AMBIENT_SPARKS = 540;
const PARTICLE_FLOATS = 8;

interface AmbientSpark {
  radius: number;
  angle: number;
  speed: number;
  inclination: number;
  phase: number;
  size: number;
  alpha: number;
  warmth: number;
}

function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function buildSpacetimeGridGeometry(): { data: Float32Array; vertexCount: number } {
  const vertices: number[] = [];

  // Concentric spacetime curvature rings
  const ringRadii: number[] = [];
  for (let i = 0; i < 22; i++) {
    const t = i / 21;
    ringRadii.push(1.35 + Math.pow(t, 1.35) * 14.5);
  }
  const segs = 96;
  for (let rIdx = 0; rIdx < ringRadii.length; rIdx++) {
    const r = ringRadii[rIdx];
    const weight = rIdx % 3 === 0 ? 1.0 : 0.45;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1) / segs) * Math.PI * 2;
      vertices.push(
        Math.cos(a0) * r,
        Math.sin(a0) * r,
        weight,
        Math.cos(a1) * r,
        Math.sin(a1) * r,
        weight
      );
    }
  }

  // Radial geodesic spokes
  const spokes = 24;
  const radialSteps = 34;
  for (let k = 0; k < spokes; k++) {
    const ang = (k / spokes) * Math.PI * 2;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const weight = k % 3 === 0 ? 0.95 : 0.42;
    for (let j = 0; j < radialSteps; j++) {
      const r0 = 1.35 + Math.pow(j / radialSteps, 1.3) * 14.5;
      const r1 = 1.35 + Math.pow((j + 1) / radialSteps, 1.3) * 14.5;
      vertices.push(c * r0, s * r0, weight, c * r1, s * r1, weight);
    }
  }

  return {
    data: new Float32Array(vertices),
    vertexCount: vertices.length / 3,
  };
}

function createAmbientSparks(): AmbientSpark[] {
  const sparks: AmbientSpark[] = [];
  for (let i = 0; i < AMBIENT_SPARKS; i++) {
    const r = 1.85 + Math.pow(Math.random(), 1.35) * 8.4;
    sparks.push({
      radius: r,
      angle: Math.random() * Math.PI * 2,
      speed: (1.25 / Math.pow(r, 1.4)) * (0.85 + Math.random() * 0.3),
      inclination: (Math.random() - 0.5) * 0.16,
      phase: Math.random() * Math.PI * 2,
      size: 0.045 + Math.random() * 0.065,
      alpha: 0.25 + Math.random() * 0.65,
      warmth: Math.random(),
    });
  }
  return sparks;
}

export class BlackHoleRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly supportsFloatFbo: boolean;

  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly gridVao: WebGLVertexArrayObject;
  private readonly gridVbo: WebGLBuffer;
  private readonly gridVertexCount: number;

  private readonly particleVao: WebGLVertexArrayObject;
  private readonly particleVbo: WebGLBuffer;
  private readonly particleData = new Float32Array(MAX_PARTICLES * PARTICLE_FLOATS);
  private readonly ambientSparks: AmbientSpark[] = createAmbientSparks();

  private readonly blackholeProgram: WebGLProgram;
  private readonly gridProgram: WebGLProgram;
  private readonly particleProgram: WebGLProgram;
  private readonly brightProgram: WebGLProgram;
  private readonly blurProgram: WebGLProgram;
  private readonly compositeProgram: WebGLProgram;

  private readonly bhUniforms: ReturnType<typeof getUniformLocations<readonly [
    'uResolution', 'uTime', 'uAspect', 'uTanHalfFov',
    'uCamPos', 'uCamForward', 'uCamRight', 'uCamUp',
    'uMass', 'uSpin', 'uLensingStrength', 'uDiskDensity',
    'uDiskTurbulence', 'uDiskTemperature', 'uDopplerStrength',
    'uJetPower', 'uBinaryMix', 'uBinarySeparation', 'uNebulaIntensity',
    'uPrimaryHue', 'uSecondaryHue', 'uJetHue',
    'uBinPosA', 'uBinPosB', 'uMaxSteps',
    'uActiveComets', 'uCometPos[0]', 'uCometCol[0]',
    'uActiveShockwaves', 'uShockwaveData[0]', 'uShockwaveCol[0]'
  ]>>;

  private readonly gridUniforms: ReturnType<typeof getUniformLocations<readonly [
    'uCamPos', 'uCamForward', 'uCamRight', 'uCamUp', 'uAspect', 'uTanHalfFov',
    'uTime', 'uMass', 'uLensingStrength', 'uBinaryMix', 'uBinPosA', 'uBinPosB',
    'uSceneDepth', 'uResolution', 'uGridOpacity', 'uPrimaryHue', 'uJetHue'
  ]>>;

  private readonly particleUniforms: ReturnType<typeof getUniformLocations<readonly [
    'uCamPos', 'uCamForward', 'uCamRight', 'uCamUp', 'uAspect', 'uTanHalfFov',
    'uResolutionY', 'uSceneDepth', 'uResolution'
  ]>>;

  private readonly brightUniforms: ReturnType<typeof getUniformLocations<readonly [
    'uSourceTex', 'uOverlayTex', 'uThreshold'
  ]>>;

  private readonly blurUniforms: ReturnType<typeof getUniformLocations<readonly [
    'uSourceTex', 'uTexelSize', 'uDirection'
  ]>>;

  private readonly compositeUniforms: ReturnType<typeof getUniformLocations<readonly [
    'uSceneTex', 'uOverlayTex', 'uBloomTightTex', 'uBloomWideTex', 'uBloomIntensity', 'uTime'
  ]>>;

  private sceneRT: RenderTarget | null = null;
  private overlayRT: RenderTarget | null = null;
  private bloomTightA: RenderTarget | null = null;
  private bloomTightB: RenderTarget | null = null;
  private bloomWideA: RenderTarget | null = null;
  private bloomWideB: RenderTarget | null = null;

  private canvasWidth = 1;
  private canvasHeight = 1;
  private renderScale = 0.8;
  private qualityMode: QualityMode = 'auto';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 is not supported in this browser.');
    }
    this.gl = gl;

    this.supportsFloatFbo = Boolean(
      gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')
    );

    // Compile shader programs
    this.blackholeProgram = createProgram(gl, FULLSCREEN_VERT, BLACKHOLE_FRAG);
    this.gridProgram = createProgram(gl, GRID_VERT, GRID_FRAG);
    this.particleProgram = createProgram(gl, PARTICLE_VERT, PARTICLE_FRAG);
    this.brightProgram = createProgram(gl, FULLSCREEN_VERT, BRIGHT_PASS_FRAG);
    this.blurProgram = createProgram(gl, FULLSCREEN_VERT, BLUR_FRAG);
    this.compositeProgram = createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);

    // Unused helper reference guard kept clean via direct compileShader check inside createProgram
    void compileShader;

    this.bhUniforms = getUniformLocations(gl, this.blackholeProgram, [
      'uResolution', 'uTime', 'uAspect', 'uTanHalfFov',
      'uCamPos', 'uCamForward', 'uCamRight', 'uCamUp',
      'uMass', 'uSpin', 'uLensingStrength', 'uDiskDensity',
      'uDiskTurbulence', 'uDiskTemperature', 'uDopplerStrength',
      'uJetPower', 'uBinaryMix', 'uBinarySeparation', 'uNebulaIntensity',
      'uPrimaryHue', 'uSecondaryHue', 'uJetHue',
      'uBinPosA', 'uBinPosB', 'uMaxSteps',
      'uActiveComets', 'uCometPos[0]', 'uCometCol[0]',
      'uActiveShockwaves', 'uShockwaveData[0]', 'uShockwaveCol[0]',
    ] as const);

    this.gridUniforms = getUniformLocations(gl, this.gridProgram, [
      'uCamPos', 'uCamForward', 'uCamRight', 'uCamUp', 'uAspect', 'uTanHalfFov',
      'uTime', 'uMass', 'uLensingStrength', 'uBinaryMix', 'uBinPosA', 'uBinPosB',
      'uSceneDepth', 'uResolution', 'uGridOpacity', 'uPrimaryHue', 'uJetHue',
    ] as const);

    this.particleUniforms = getUniformLocations(gl, this.particleProgram, [
      'uCamPos', 'uCamForward', 'uCamRight', 'uCamUp', 'uAspect', 'uTanHalfFov',
      'uResolutionY', 'uSceneDepth', 'uResolution',
    ] as const);

    this.brightUniforms = getUniformLocations(gl, this.brightProgram, [
      'uSourceTex', 'uOverlayTex', 'uThreshold',
    ] as const);

    this.blurUniforms = getUniformLocations(gl, this.blurProgram, [
      'uSourceTex', 'uTexelSize', 'uDirection',
    ] as const);

    this.compositeUniforms = getUniformLocations(gl, this.compositeProgram, [
      'uSceneTex', 'uOverlayTex', 'uBloomTightTex', 'uBloomWideTex', 'uBloomIntensity', 'uTime',
    ] as const);

    const emptyVao = gl.createVertexArray();
    if (!emptyVao) throw new Error('Failed to create VAO');
    this.emptyVao = emptyVao;

    // Spacetime curvature grid VAO/VBO
    const grid = buildSpacetimeGridGeometry();
    this.gridVertexCount = grid.vertexCount;
    const gridVao = gl.createVertexArray();
    const gridVbo = gl.createBuffer();
    if (!gridVao || !gridVbo) throw new Error('Failed to create grid buffers');
    this.gridVao = gridVao;
    this.gridVbo = gridVbo;

    gl.bindVertexArray(this.gridVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVbo);
    gl.bufferData(gl.ARRAY_BUFFER, grid.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);

    // Dynamic particles VAO/VBO
    const pVao = gl.createVertexArray();
    const pVbo = gl.createBuffer();
    if (!pVao || !pVbo) throw new Error('Failed to create particle buffers');
    this.particleVao = pVao;
    this.particleVbo = pVbo;

    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);
    const stride = PARTICLE_FLOATS * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 28);

    gl.bindVertexArray(null);
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  public getSupportsFloatFbo(): boolean {
    return this.supportsFloatFbo;
  }

  public getRenderScale(): number {
    return this.renderScale;
  }

  public getQualityMode(): QualityMode {
    return this.qualityMode;
  }

  public setQualityMode(mode: QualityMode): void {
    this.qualityMode = mode;
    if (mode === 'ultra') this.renderScale = 1.0;
    else if (mode === 'high') this.renderScale = 0.8;
    else if (mode === 'balanced') this.renderScale = 0.58;
    this.rebuildTargets();
  }

  public adaptScale(avgFrameMs: number): void {
    if (this.qualityMode !== 'auto') return;
    let next = this.renderScale;
    if (avgFrameMs > 28 && this.renderScale > 0.52) {
      next = Math.max(0.52, this.renderScale - 0.06);
    } else if (avgFrameMs < 15.5 && this.renderScale < 0.86) {
      next = Math.min(0.86, this.renderScale + 0.04);
    }
    if (Math.abs(next - this.renderScale) >= 0.03) {
      this.renderScale = Number(next.toFixed(2));
      this.rebuildTargets();
    }
  }

  public resize(cssWidth: number, cssHeight: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    const w = Math.max(2, Math.floor(cssWidth * dpr));
    const h = Math.max(2, Math.floor(cssHeight * dpr));
    if (w === this.canvasWidth && h === this.canvasHeight && this.sceneRT) return;

    this.canvasWidth = w;
    this.canvasHeight = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.rebuildTargets();
  }

  private rebuildTargets(): void {
    const gl = this.gl;
    destroyRenderTarget(gl, this.sceneRT);
    destroyRenderTarget(gl, this.overlayRT);
    destroyRenderTarget(gl, this.bloomTightA);
    destroyRenderTarget(gl, this.bloomTightB);
    destroyRenderTarget(gl, this.bloomWideA);
    destroyRenderTarget(gl, this.bloomWideB);

    const hdrSpec: TextureSpec = this.supportsFloatFbo
      ? {
          internalFormat: gl.RGBA16F,
          format: gl.RGBA,
          type: gl.HALF_FLOAT,
          filter: gl.LINEAR,
        }
      : {
          internalFormat: gl.RGBA8,
          format: gl.RGBA,
          type: gl.UNSIGNED_BYTE,
          filter: gl.LINEAR,
        };

    const depthSpec: TextureSpec = this.supportsFloatFbo
      ? {
          internalFormat: gl.RGBA16F,
          format: gl.RGBA,
          type: gl.HALF_FLOAT,
          filter: gl.NEAREST,
        }
      : {
          internalFormat: gl.RGBA8,
          format: gl.RGBA,
          type: gl.UNSIGNED_BYTE,
          filter: gl.NEAREST,
        };

    const sceneW = Math.max(2, Math.floor(this.canvasWidth * this.renderScale));
    const sceneH = Math.max(2, Math.floor(this.canvasHeight * this.renderScale));

    this.sceneRT = createRenderTarget(gl, sceneW, sceneH, [hdrSpec, depthSpec]);
    this.overlayRT = createRenderTarget(gl, this.canvasWidth, this.canvasHeight, [hdrSpec]);

    const tightW = Math.max(2, Math.floor(this.canvasWidth * 0.5));
    const tightH = Math.max(2, Math.floor(this.canvasHeight * 0.5));
    this.bloomTightA = createRenderTarget(gl, tightW, tightH, [hdrSpec]);
    this.bloomTightB = createRenderTarget(gl, tightW, tightH, [hdrSpec]);

    const wideW = Math.max(2, Math.floor(this.canvasWidth * 0.25));
    const wideH = Math.max(2, Math.floor(this.canvasHeight * 0.25));
    this.bloomWideA = createRenderTarget(gl, wideW, wideH, [hdrSpec]);
    this.bloomWideB = createRenderTarget(gl, wideW, wideH, [hdrSpec]);
  }

  private buildParticles(simTime: number, params: SimParams, rogueStars: RogueStar[]): number {
    let count = 0;
    const rs = Math.max(0.25, params.mass);
    const spinSign = params.spin < -0.15 ? -1 : 1;

    // 1. Ambient Keplerian accretion embers
    for (let i = 0; i < this.ambientSparks.length && count < MAX_PARTICLES; i++) {
      const sp = this.ambientSparks[i];
      const r = sp.radius * rs;
      const ang = sp.angle + simTime * sp.speed * spinSign;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const y = Math.sin(ang + sp.phase) * r * sp.inclination;

      const mixT = sp.warmth;
      const colR = params.primaryHue[0] * (1 - mixT) + params.secondaryHue[0] * mixT;
      const colG = params.primaryHue[1] * (1 - mixT) + params.secondaryHue[1] * mixT;
      const colB = params.primaryHue[2] * (1 - mixT) + params.secondaryHue[2] * mixT;

      const idx = count * PARTICLE_FLOATS;
      this.particleData[idx] = x;
      this.particleData[idx + 1] = y;
      this.particleData[idx + 2] = z;
      this.particleData[idx + 3] = colR;
      this.particleData[idx + 4] = colG;
      this.particleData[idx + 5] = colB;
      this.particleData[idx + 6] = sp.size;
      this.particleData[idx + 7] = sp.alpha * Math.min(1.2, 0.35 + params.diskDensity * 0.6);
      count++;
    }

    // 2. Rogue star tidal trails
    for (const star of rogueStars) {
      if (!star.alive) continue;
      for (let tIdx = 0; tIdx < star.trail.length && count < MAX_PARTICLES; tIdx++) {
        const pt = star.trail[tIdx];
        const frac = 1 - tIdx / star.trail.length;
        const idx = count * PARTICLE_FLOATS;
        this.particleData[idx] = pt[0];
        this.particleData[idx + 1] = pt[1];
        this.particleData[idx + 2] = pt[2];
        this.particleData[idx + 3] = star.color[0] * (0.7 + 0.6 * frac);
        this.particleData[idx + 4] = star.color[1] * (0.7 + 0.6 * frac);
        this.particleData[idx + 5] = star.color[2] * (0.7 + 0.6 * frac);
        this.particleData[idx + 6] = Math.max(0.055, star.radius * 1.9) * (0.35 + 1.35 * frac) * (1 + star.tidalStretch * 0.08);
        this.particleData[idx + 7] = frac * frac * 0.95;
        count++;
      }
    }

    return count;
  }

  public render(
    simTime: number,
    camera: CameraState,
    params: SimParams,
    rogueStars: RogueStar[],
    shockwaves: ShockwaveEvent[],
    gridOpacity: number
  ): void {
    const gl = this.gl;
    if (!this.sceneRT || !this.overlayRT || !this.bloomTightA || !this.bloomTightB || !this.bloomWideA || !this.bloomWideB) {
      return;
    }

    const aspect = this.canvasWidth / Math.max(1, this.canvasHeight);
    const camPos = getCameraPosition(camera);
    const camForward = normalize3([-camPos[0], -camPos[1], -camPos[2]]);
    const camRight = normalize3(cross3(camForward, [0, 1, 0]));
    const camUp = normalize3(cross3(camRight, camForward));
    const binCenters = computeBinaryCenters(simTime, params);

    const maxSteps =
      this.qualityMode === 'ultra'
        ? 168
        : this.qualityMode === 'balanced'
          ? 104
          : this.renderScale < 0.68
            ? 112
            : 144;

    // ---------------------------------------------------------
    // PASS 1: Raymarched Relativistic Black Hole + Lensing HDR
    // ---------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneRT.fbo);
    gl.viewport(0, 0, this.sceneRT.width, this.sceneRT.height);
    gl.useProgram(this.blackholeProgram);
    gl.bindVertexArray(this.emptyVao);

    const u = this.bhUniforms;
    gl.uniform2f(u.uResolution, this.sceneRT.width, this.sceneRT.height);
    gl.uniform1f(u.uTime, simTime);
    gl.uniform1f(u.uAspect, aspect);
    gl.uniform1f(u.uTanHalfFov, TAN_HALF_FOV);

    gl.uniform3f(u.uCamPos, camPos[0], camPos[1], camPos[2]);
    gl.uniform3f(u.uCamForward, camForward[0], camForward[1], camForward[2]);
    gl.uniform3f(u.uCamRight, camRight[0], camRight[1], camRight[2]);
    gl.uniform3f(u.uCamUp, camUp[0], camUp[1], camUp[2]);

    gl.uniform1f(u.uMass, params.mass);
    gl.uniform1f(u.uSpin, params.spin);
    gl.uniform1f(u.uLensingStrength, params.lensingStrength);
    gl.uniform1f(u.uDiskDensity, params.diskDensity);
    gl.uniform1f(u.uDiskTurbulence, params.diskTurbulence);
    gl.uniform1f(u.uDiskTemperature, params.diskTemperature);
    gl.uniform1f(u.uDopplerStrength, params.dopplerStrength);
    gl.uniform1f(u.uJetPower, params.jetPower);
    gl.uniform1f(u.uBinaryMix, params.binaryMix);
    gl.uniform1f(u.uBinarySeparation, params.binarySeparation);
    gl.uniform1f(u.uNebulaIntensity, params.nebulaIntensity);

    gl.uniform3fv(u.uPrimaryHue, params.primaryHue);
    gl.uniform3fv(u.uSecondaryHue, params.secondaryHue);
    gl.uniform3fv(u.uJetHue, params.jetHue);

    gl.uniform3fv(u.uBinPosA, binCenters.posA);
    gl.uniform3fv(u.uBinPosB, binCenters.posB);
    gl.uniform1i(u.uMaxSteps, maxSteps);

    const aliveStars = rogueStars.filter((s) => s.alive).slice(0, 6);
    const cometPosArr = new Float32Array(24);
    const cometColArr = new Float32Array(24);
    for (let i = 0; i < aliveStars.length; i++) {
      const s = aliveStars[i];
      cometPosArr[i * 4] = s.pos[0];
      cometPosArr[i * 4 + 1] = s.pos[1];
      cometPosArr[i * 4 + 2] = s.pos[2];
      cometPosArr[i * 4 + 3] = s.radius;
      cometColArr[i * 4] = s.color[0];
      cometColArr[i * 4 + 1] = s.color[1];
      cometColArr[i * 4 + 2] = s.color[2];
      cometColArr[i * 4 + 3] = 2.6;
    }
    gl.uniform1i(u.uActiveComets, aliveStars.length);
    gl.uniform4fv(u['uCometPos[0]'], cometPosArr);
    gl.uniform4fv(u['uCometCol[0]'], cometColArr);

    const recentWaves = shockwaves.slice(0, 4);
    const waveDataArr = new Float32Array(16);
    const waveColArr = new Float32Array(16);
    for (let i = 0; i < recentWaves.length; i++) {
      const w = recentWaves[i];
      waveDataArr[i * 4] = w.x;
      waveDataArr[i * 4 + 1] = w.z;
      waveDataArr[i * 4 + 2] = w.startTime;
      waveDataArr[i * 4 + 3] = w.strength;
      waveColArr[i * 4] = w.color[0];
      waveColArr[i * 4 + 1] = w.color[1];
      waveColArr[i * 4 + 2] = w.color[2];
      waveColArr[i * 4 + 3] = 1.0;
    }
    gl.uniform1i(u.uActiveShockwaves, recentWaves.length);
    gl.uniform4fv(u['uShockwaveData[0]'], waveDataArr);
    gl.uniform4fv(u['uShockwaveCol[0]'], waveColArr);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---------------------------------------------------------
    // PASS 2: 3D Spacetime Curvature Grid & Tidal Particles
    // ---------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.overlayRT.fbo);
    gl.viewport(0, 0, this.overlayRT.width, this.overlayRT.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    if (gridOpacity > 0.005) {
      gl.useProgram(this.gridProgram);
      gl.bindVertexArray(this.gridVao);
      const gu = this.gridUniforms;
      gl.uniform3fv(gu.uCamPos, camPos);
      gl.uniform3fv(gu.uCamForward, camForward);
      gl.uniform3fv(gu.uCamRight, camRight);
      gl.uniform3fv(gu.uCamUp, camUp);
      gl.uniform1f(gu.uAspect, aspect);
      gl.uniform1f(gu.uTanHalfFov, TAN_HALF_FOV);
      gl.uniform1f(gu.uTime, simTime);
      gl.uniform1f(gu.uMass, params.mass);
      gl.uniform1f(gu.uLensingStrength, params.lensingStrength);
      gl.uniform1f(gu.uBinaryMix, params.binaryMix);
      gl.uniform3fv(gu.uBinPosA, binCenters.posA);
      gl.uniform3fv(gu.uBinPosB, binCenters.posB);
      gl.uniform2f(gu.uResolution, this.overlayRT.width, this.overlayRT.height);
      gl.uniform1f(gu.uGridOpacity, gridOpacity);
      gl.uniform3fv(gu.uPrimaryHue, params.primaryHue);
      gl.uniform3fv(gu.uJetHue, params.jetHue);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.textures[1]);
      gl.uniform1i(gu.uSceneDepth, 0);

      gl.drawArrays(gl.LINES, 0, this.gridVertexCount);
    }

    const activeParticles = this.buildParticles(simTime, params, rogueStars);
    if (activeParticles > 0) {
      gl.useProgram(this.particleProgram);
      gl.bindVertexArray(this.particleVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.particleData.subarray(0, activeParticles * PARTICLE_FLOATS)
      );

      const pu = this.particleUniforms;
      gl.uniform3fv(pu.uCamPos, camPos);
      gl.uniform3fv(pu.uCamForward, camForward);
      gl.uniform3fv(pu.uCamRight, camRight);
      gl.uniform3fv(pu.uCamUp, camUp);
      gl.uniform1f(pu.uAspect, aspect);
      gl.uniform1f(pu.uTanHalfFov, TAN_HALF_FOV);
      gl.uniform1f(pu.uResolutionY, this.overlayRT.height);
      gl.uniform2f(pu.uResolution, this.overlayRT.width, this.overlayRT.height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.textures[1]);
      gl.uniform1i(pu.uSceneDepth, 0);

      gl.drawArrays(gl.POINTS, 0, activeParticles);
    }

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);

    // ---------------------------------------------------------
    // PASS 3: Bright Extraction -> Multi-Level HDR Gaussian Bloom
    // ---------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomTightA.fbo);
    gl.viewport(0, 0, this.bloomTightA.width, this.bloomTightA.height);
    gl.useProgram(this.brightProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.textures[0]);
    gl.uniform1i(this.brightUniforms.uSourceTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.overlayRT.textures[0]);
    gl.uniform1i(this.brightUniforms.uOverlayTex, 1);
    gl.uniform1f(this.brightUniforms.uThreshold, 0.9);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.runBlurPass(this.bloomTightA, this.bloomTightB, 1.0, 0.0);
    this.runBlurPass(this.bloomTightB, this.bloomTightA, 0.0, 1.0);

    // Downsample + wide atmospheric halo blur
    this.runBlurPass(this.bloomTightA, this.bloomWideB, 1.5, 0.0);
    this.runBlurPass(this.bloomWideB, this.bloomWideA, 0.0, 1.5);
    this.runBlurPass(this.bloomWideA, this.bloomWideB, 2.2, 0.0);
    this.runBlurPass(this.bloomWideB, this.bloomWideA, 0.0, 2.2);

    // ---------------------------------------------------------
    // PASS 4: ACES Filmic Composite to Screen
    // ---------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvasWidth, this.canvasHeight);
    gl.useProgram(this.compositeProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.textures[0]);
    gl.uniform1i(this.compositeUniforms.uSceneTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.overlayRT.textures[0]);
    gl.uniform1i(this.compositeUniforms.uOverlayTex, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomTightA.textures[0]);
    gl.uniform1i(this.compositeUniforms.uBloomTightTex, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomWideA.textures[0]);
    gl.uniform1i(this.compositeUniforms.uBloomWideTex, 3);

    gl.uniform1f(this.compositeUniforms.uBloomIntensity, params.bloomIntensity);
    gl.uniform1f(this.compositeUniforms.uTime, simTime);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private runBlurPass(src: RenderTarget, dst: RenderTarget, dx: number, dy: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(this.blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.textures[0]);
    gl.uniform1i(this.blurUniforms.uSourceTex, 0);
    gl.uniform2f(this.blurUniforms.uTexelSize, 1 / src.width, 1 / src.height);
    gl.uniform2f(this.blurUniforms.uDirection, dx, dy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  public capturePngDataUrl(
    simTime: number,
    camera: CameraState,
    params: SimParams,
    rogueStars: RogueStar[],
    shockwaves: ShockwaveEvent[],
    gridOpacity: number
  ): string {
    this.render(simTime, camera, params, rogueStars, shockwaves, gridOpacity);
    return this.canvas.toDataURL('image/png');
  }

  public dispose(): void {
    const gl = this.gl;
    destroyRenderTarget(gl, this.sceneRT);
    destroyRenderTarget(gl, this.overlayRT);
    destroyRenderTarget(gl, this.bloomTightA);
    destroyRenderTarget(gl, this.bloomTightB);
    destroyRenderTarget(gl, this.bloomWideA);
    destroyRenderTarget(gl, this.bloomWideB);
    gl.deleteBuffer(this.gridVbo);
    gl.deleteBuffer(this.particleVbo);
    gl.deleteVertexArray(this.emptyVao);
    gl.deleteVertexArray(this.gridVao);
    gl.deleteVertexArray(this.particleVao);
    gl.deleteProgram(this.blackholeProgram);
    gl.deleteProgram(this.gridProgram);
    gl.deleteProgram(this.particleProgram);
    gl.deleteProgram(this.brightProgram);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.compositeProgram);
  }
}
