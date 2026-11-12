import { describe, expect, it } from 'vitest';
import {
  computeBinaryCenters,
  computeKerrIscoRs,
  computeTelemetry,
  createRogueStarFromScreen,
  getCameraPosition,
  stepRogueStars,
} from '../src/core/physics.ts';
import { cloneSimParams, PRESET_MAP } from '../src/core/presets.ts';
import type { CameraState } from '../src/core/types.ts';

function makeCamera(overrides: Partial<CameraState> = {}): CameraState {
  return {
    yaw: 0,
    pitch: 0.2,
    distance: 10,
    targetYaw: 0,
    targetPitch: 0.2,
    targetDistance: 10,
    autoOrbit: false,
    autoOrbitSpeed: 0.14,
    ...overrides,
  };
}

describe('Relativistic Black Hole Physics', () => {
  it('computes analytical Kerr ISCO accurately for Schwarzschild (a=0) and prograde/retrograde extremes', () => {
    // Schwarzschild: r_ISCO = 6M = 3.0 Rs
    expect(computeKerrIscoRs(0)).toBeCloseTo(3.0, 5);
    // Extreme prograde shrinks below 1.0 Rs
    expect(computeKerrIscoRs(0.998)).toBeLessThan(0.8);
    // Extreme retrograde expands toward 4.5 Rs (9M)
    expect(computeKerrIscoRs(-0.998)).toBeGreaterThan(4.4);
  });

  it('computes telemetry metrics consistently with general relativity bounds', () => {
    const params = cloneSimParams(PRESET_MAP.gargantua.params);
    const cam = makeCamera({ distance: 10.0 });
    const tele = computeTelemetry(params, cam, 60, 0.8, 1, 2);

    expect(tele.photonSphereRs).toBeCloseTo(1.5, 4);
    expect(tele.shadowRadiusRs).toBeCloseTo((3 * Math.sqrt(3)) / 2, 4);
    expect(tele.cameraDistanceRs).toBeCloseTo(10.0, 4);
    // sqrt(1 - 1/10) = sqrt(0.9)
    expect(tele.timeDilationFactor).toBeCloseTo(Math.sqrt(0.9), 5);
    expect(tele.escapeVelocityC).toBeCloseTo(Math.sqrt(0.1), 5);
    expect(tele.activeStars).toBe(1);
    expect(tele.absorbedStars).toBe(2);
  });

  it('positions camera at exact spherical distance', () => {
    const cam = makeCamera({ yaw: 0.75, pitch: 0.35, distance: 12.5 });
    const pos = getCameraPosition(cam);
    expect(Math.hypot(pos[0], pos[1], pos[2])).toBeCloseTo(12.5, 5);
  });

  it('computes binary centers symmetrically around the barycenter', () => {
    const centers = computeBinaryCenters(1.2, { binaryMix: 1.0, binarySeparation: 3.6 });
    expect(centers.posA[0] + centers.posB[0]).toBeCloseTo(0, 6);
    expect(centers.posA[2] + centers.posB[2]).toBeCloseTo(0, 6);
    const sep = Math.hypot(
      centers.posA[0] - centers.posB[0],
      centers.posA[1] - centers.posB[1],
      centers.posA[2] - centers.posB[2]
    );
    expect(sep).toBeCloseTo(3.6, 5);
  });

  it('integrates rogue star orbits and captures plunging stars inside event horizon', () => {
    const params = cloneSimParams(PRESET_MAP.gargantua.params);
    const cam = makeCamera({ distance: 10.6 });
    const star = createRogueStarFromScreen(0.05, 0.02, cam, params, true);
    // Place star near horizon moving inward to guarantee capture within a few steps
    star.pos = [1.8, 0.2, 0.0];
    star.vel = [-1.4, -0.1, 0.1];

    let totalAbsorbed = 0;
    let totalShockwaves = 0;
    for (let i = 0; i < 60; i++) {
      const res = stepRogueStars([star], 0.03, i * 0.03, params);
      totalAbsorbed += res.absorbedCount;
      totalShockwaves += res.shockwaves.length;
      if (!star.alive) break;
    }

    expect(star.alive).toBe(false);
    expect(totalAbsorbed).toBe(1);
    expect(totalShockwaves).toBeGreaterThanOrEqual(1);
  });
});
