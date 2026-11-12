import { describe, expect, it } from 'vitest';
import { cloneSimParams, dampSimParams, PRESET_LIST, PRESET_MAP } from '../src/core/presets.ts';

describe('Presets and Parameter Morphing', () => {
  it('defines all 5 distinct presets with valid physical ranges', () => {
    expect(PRESET_LIST).toHaveLength(5);
    const ids = new Set(PRESET_LIST.map((p) => p.id));
    expect(ids.size).toBe(5);

    for (const preset of PRESET_LIST) {
      expect(preset.params.mass).toBeGreaterThan(0.2);
      expect(Math.abs(preset.params.spin)).toBeLessThan(1.0);
      expect(preset.params.primaryHue).toHaveLength(3);
      expect(preset.params.secondaryHue).toHaveLength(3);
      expect(preset.params.jetHue).toHaveLength(3);
    }
  });

  it('smoothly converges parameters toward target preset under exponential damping', () => {
    const current = cloneSimParams(PRESET_MAP.gargantua.params);
    const target = cloneSimParams(PRESET_MAP.quasar.params);

    for (let i = 0; i < 120; i++) {
      dampSimParams(current, target, 1 / 60, 6.0);
    }

    expect(current.jetPower).toBeCloseTo(target.jetPower, 2);
    expect(current.spin).toBeCloseTo(target.spin, 2);
    expect(current.primaryHue[0]).toBeCloseTo(target.primaryHue[0], 2);
  });
});
