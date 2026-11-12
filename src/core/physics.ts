import type { CameraState, RogueStar, ShockwaveEvent, SimParams, TelemetrySnapshot, Vec3 } from './types.ts';

const SOLAR_MASS_SCHWARZSCHILD_KM = 2.95325; // Rs of 1 solar mass in km
const BASE_MASS_MILLIONS_SOLAR = 100.0; // Normalized mass=1.0 -> 100M M_sun (Gargantua scale)
const CRITICAL_SHADOW_FACTOR = (3 * Math.sqrt(3)) / 2; // ~2.598076 Rs

/**
 * Computes the analytical Kerr innermost stable circular orbit (ISCO) in units of Rs
 * using the Bardeen-Press-Teukolsky formula (where Rs = 2M in geometric units).
 */
export function computeKerrIscoRs(spin: number): number {
  const a = Math.max(-0.998, Math.min(0.998, spin));
  const absA = Math.abs(a);
  const z1 =
    1 +
    Math.cbrt(1 - absA * absA) *
      (Math.cbrt(1 + absA) + Math.cbrt(1 - absA));
  const z2 = Math.sqrt(3 * absA * absA + z1 * z1);
  const sign = a >= 0 ? 1 : -1;
  const rOverM = 3 + z2 - sign * Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return rOverM * 0.5;
}

export function getCameraPosition(camera: Pick<CameraState, 'yaw' | 'pitch' | 'distance'>): Vec3 {
  const cosPitch = Math.cos(camera.pitch);
  return [
    camera.distance * cosPitch * Math.sin(camera.yaw),
    camera.distance * Math.sin(camera.pitch),
    camera.distance * cosPitch * Math.cos(camera.yaw),
  ];
}

export function computeBinaryCenters(
  simTime: number,
  params: Pick<SimParams, 'binaryMix' | 'binarySeparation'>
): { posA: Vec3; posB: Vec3 } {
  const mix = Math.max(0, Math.min(1, params.binaryMix));
  const halfSep = 0.5 * params.binarySeparation * mix;
  const omega = 0.85;
  const angle = simTime * omega;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    posA: [halfSep * c, 0, halfSep * s],
    posB: [-halfSep * c, 0, -halfSep * s],
  };
}

export function computeTelemetry(
  params: SimParams,
  camera: CameraState,
  fps: number,
  renderScale: number,
  activeStars: number,
  absorbedStars: number
): TelemetrySnapshot {
  const rs = Math.max(0.25, params.mass);
  const massSolarMillions = rs * BASE_MASS_MILLIONS_SOLAR;
  const schwarzschildKm = massSolarMillions * 1e6 * SOLAR_MASS_SCHWARZSCHILD_KM;
  const cameraDistanceRs = Math.max(1.02, camera.distance / rs);
  const timeDilationFactor = Math.sqrt(Math.max(0.001, 1 - 1 / cameraDistanceRs));
  const escapeVelocityC = Math.min(0.9999, Math.sqrt(1 / cameraDistanceRs));
  const orbitalVelocityC =
    cameraDistanceRs > 1.55
      ? Math.min(0.999, Math.sqrt(0.5 / (cameraDistanceRs - 1)))
      : 0.999;

  return {
    massSolarMillions,
    schwarzschildKm,
    photonSphereRs: 1.5,
    shadowRadiusRs: CRITICAL_SHADOW_FACTOR,
    cameraDistanceRs,
    timeDilationFactor,
    escapeVelocityC,
    orbitalVelocityC,
    fps,
    renderScale,
    activeStars,
    absorbedStars,
  };
}

export interface StarStepResult {
  absorbedCount: number;
  shockwaves: ShockwaveEvent[];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function len(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function computePseudoNewtonianAccel(
  pos: Vec3,
  vel: Vec3,
  simTime: number,
  params: SimParams
): Vec3 {
  const rsBase = Math.max(0.25, params.mass);
  const mix = Math.max(0, Math.min(1, params.binaryMix));
  const centers = computeBinaryCenters(simTime, params);

  const masses: Array<{ center: Vec3; rs: number }> =
    mix > 0.02
      ? [
          { center: centers.posA, rs: rsBase * (1 - 0.35 * mix) },
          { center: centers.posB, rs: rsBase * (0.35 * mix + (1 - mix) * 0.0) },
        ]
      : [{ center: [0, 0, 0], rs: rsBase }];

  // When binaryMix blends between single (1.0*rsBase) and binary (0.65 + 0.35), conserve total mass.
  if (mix > 0.02) {
    masses[0].rs = rsBase * (1 - 0.36 * mix);
    masses[1].rs = rsBase * (0.36 * mix);
  }

  let ax = 0;
  let ay = 0;
  let az = 0;

  for (const body of masses) {
    if (body.rs <= 0.001) continue;
    const d = sub(pos, body.center);
    const r = Math.max(len(d), body.rs * 1.02);
    const gm = 0.5 * body.rs * (1.2 + 0.4 * params.lensingStrength);
    const denom = Math.max(0.18, r - body.rs * 0.85);
    const mag = -gm / (denom * denom * r);
    ax += d[0] * mag;
    ay += d[1] * mag;
    az += d[2] * mag;

    // Subtle Kerr frame-dragging swirl near horizon
    const frameDrag = (params.spin * body.rs * 0.25) / Math.pow(r, 3.0);
    ax += -d[2] * frameDrag;
    az += d[0] * frameDrag;

    // Gentle orbital precession / radiative drag so plunged trajectories spiral realistically
    if (r < body.rs * 4.5) {
      const drag = -0.022 * Math.pow(body.rs / r, 2.0);
      ax += vel[0] * drag;
      ay += vel[1] * drag;
      az += vel[2] * drag;
    }
  }

  return [ax, ay, az];
}

const STAR_PALETTE: Vec3[] = [
  [0.65, 0.92, 1.0],
  [1.0, 0.86, 0.52],
  [1.0, 0.55, 0.78],
  [0.45, 1.0, 0.82],
  [0.92, 0.72, 1.0],
];

let nextStarId = 1;

/**
 * Spawns a rogue star from a screen NDC coordinate ([-1, 1]) projected into a
 * curved orbital plane with near-tangential orbital velocity for dramatic slingshots or inspirals.
 */
export function createRogueStarFromScreen(
  ndcX: number,
  ndcY: number,
  camera: CameraState,
  params: SimParams,
  plungeBias = false
): RogueStar {
  const camPos = getCameraPosition(camera);
  const camLen = len(camPos);
  const forward: Vec3 = [-camPos[0] / camLen, -camPos[1] / camLen, -camPos[2] / camLen];
  const worldUp: Vec3 = [0, 1, 0];
  let right: Vec3 = [
    forward[1] * worldUp[2] - forward[2] * worldUp[1],
    forward[2] * worldUp[0] - forward[0] * worldUp[2],
    forward[0] * worldUp[1] - forward[1] * worldUp[0],
  ];
  const rLen = Math.max(1e-5, len(right));
  right = [right[0] / rLen, right[1] / rLen, right[2] / rLen];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];

  // Place star on a plane passing near the origin facing the camera
  const spawnDist = Math.max(5.5, Math.min(11.0, camera.distance * 0.72));
  const fovScale = Math.tan((52 * Math.PI) / 360) * spawnDist;
  const aspectEstimate = 1.6;
  const rayTarget: Vec3 = [
    camPos[0] + forward[0] * spawnDist + right[0] * ndcX * fovScale * aspectEstimate + up[0] * ndcY * fovScale,
    camPos[1] + forward[1] * spawnDist + right[1] * ndcX * fovScale * aspectEstimate + up[1] * ndcY * fovScale,
    camPos[2] + forward[2] * spawnDist + right[2] * ndcX * fovScale * aspectEstimate + up[2] * ndcY * fovScale,
  ];

  // Clamp initial radius into interesting orbital zone [4.8, 9.2]
  const rNow = Math.max(1e-4, len(rayTarget));
  const clampedR = Math.max(4.8, Math.min(9.2, rNow));
  const pos: Vec3 = [
    (rayTarget[0] / rNow) * clampedR,
    (rayTarget[1] / rNow) * clampedR,
    (rayTarget[2] / rNow) * clampedR,
  ];

  // Compute tangential orbital velocity around Y + slight inclination
  const rs = Math.max(0.25, params.mass);
  const gm = 0.5 * rs * (1.2 + 0.4 * params.lensingStrength);
  const vCirc = Math.sqrt(gm / Math.max(0.6, clampedR - rs * 0.85));
  const tangentialMag = vCirc * (plungeBias ? 0.58 : 0.84 + Math.random() * 0.22);

  // Tangent vector perpendicular to pos & slightly tilted out of XZ plane
  const radial: Vec3 = [pos[0] / clampedR, pos[1] / clampedR, pos[2] / clampedR];
  let tang: Vec3 = [-radial[2], 0.16 * (ndcY >= 0 ? -1 : 1), radial[0]];
  const tLen = Math.max(1e-5, len(tang));
  tang = [tang[0] / tLen, tang[1] / tLen, tang[2] / tLen];

  const vel: Vec3 = [
    tang[0] * tangentialMag - radial[0] * vCirc * (plungeBias ? 0.22 : 0.06),
    tang[1] * tangentialMag,
    tang[2] * tangentialMag - radial[2] * vCirc * (plungeBias ? 0.22 : 0.06),
  ];

  const color = STAR_PALETTE[(nextStarId - 1) % STAR_PALETTE.length];

  return {
    id: nextStarId++,
    pos,
    vel,
    color: [...color] as Vec3,
    radius: 0.048 + Math.random() * 0.022,
    age: 0,
    maxAge: 28,
    alive: true,
    trail: [[...pos] as Vec3],
    tidalStretch: 1,
    crossedDiskOnce: false,
  };
}

/**
 * Sub-stepped Velocity-Verlet integrator for rogue stars orbiting the black hole(s).
 */
export function stepRogueStars(
  stars: RogueStar[],
  dt: number,
  simTime: number,
  params: SimParams
): StarStepResult {
  const result: StarStepResult = { absorbedCount: 0, shockwaves: [] };
  if (stars.length === 0 || dt <= 0) return result;

  const substeps = 4;
  const subDt = Math.min(0.05, dt) / substeps;
  const rsBase = Math.max(0.25, params.mass);
  const centers = computeBinaryCenters(simTime, params);
  const mix = Math.max(0, Math.min(1, params.binaryMix));

  for (const star of stars) {
    if (!star.alive) continue;

    for (let s = 0; s < substeps; s++) {
      const prevY = star.pos[1];
      const a0 = computePseudoNewtonianAccel(star.pos, star.vel, simTime, params);

      star.pos[0] += star.vel[0] * subDt + 0.5 * a0[0] * subDt * subDt;
      star.pos[1] += star.vel[1] * subDt + 0.5 * a0[1] * subDt * subDt;
      star.pos[2] += star.vel[2] * subDt + 0.5 * a0[2] * subDt * subDt;

      const a1 = computePseudoNewtonianAccel(star.pos, star.vel, simTime, params);
      star.vel[0] += 0.5 * (a0[0] + a1[0]) * subDt;
      star.vel[1] += 0.5 * (a0[1] + a1[1]) * subDt;
      star.vel[2] += 0.5 * (a0[2] + a1[2]) * subDt;

      // Check disk plane crossing for shockwave flare
      const radialXZ = Math.hypot(star.pos[0], star.pos[2]);
      if (
        ((prevY > 0 && star.pos[1] <= 0) || (prevY < 0 && star.pos[1] >= 0)) &&
        radialXZ > rsBase * 1.2 &&
        radialXZ < 9.5
      ) {
        result.shockwaves.push({
          x: star.pos[0],
          z: star.pos[2],
          startTime: simTime,
          strength: star.crossedDiskOnce ? 0.65 : 1.05,
          color: [...star.color] as Vec3,
        });
        star.crossedDiskOnce = true;
      }

      // Check capture against single or binary event horizons
      let minRatio = len(star.pos) / rsBase;
      if (mix > 0.02) {
        const dA = len(sub(star.pos, centers.posA)) / (rsBase * (1 - 0.36 * mix));
        const dB = len(sub(star.pos, centers.posB)) / Math.max(0.18, rsBase * (0.36 * mix));
        minRatio = Math.min(dA, dB);
      }

      star.tidalStretch = Math.min(8.0, 1 + 4.2 / Math.max(0.4, minRatio * minRatio));

      if (minRatio <= 1.12) {
        star.alive = false;
        result.absorbedCount++;
        result.shockwaves.push({
          x: star.pos[0],
          z: star.pos[2],
          startTime: simTime,
          strength: 1.5,
          color: [...star.color] as Vec3,
        });
        break;
      }
    }

    star.age += dt;
    if (star.age >= star.maxAge || len(star.pos) > 36) {
      star.alive = false;
    }

    if (star.alive) {
      star.trail.unshift([star.pos[0], star.pos[1], star.pos[2]]);
      if (star.trail.length > 36) {
        star.trail.pop();
      }
    }
  }

  return result;
}
