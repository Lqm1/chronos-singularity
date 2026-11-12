import { describe, expect, it } from 'vitest';
import { BLACKHOLE_FRAG } from '../src/render/shaders/blackhole.glsl.ts';
import { FULLSCREEN_VERT } from '../src/render/shaders/common.glsl.ts';
import { GRID_FRAG, GRID_VERT, PARTICLE_FRAG, PARTICLE_VERT } from '../src/render/shaders/overlay3d.glsl.ts';
import { BLUR_FRAG, BRIGHT_PASS_FRAG, COMPOSITE_FRAG } from '../src/render/shaders/post.glsl.ts';

describe('GLSL ES 3.00 Shader Contracts', () => {
  const allShaders = [
    ['FULLSCREEN_VERT', FULLSCREEN_VERT],
    ['BLACKHOLE_FRAG', BLACKHOLE_FRAG],
    ['GRID_VERT', GRID_VERT],
    ['GRID_FRAG', GRID_FRAG],
    ['PARTICLE_VERT', PARTICLE_VERT],
    ['PARTICLE_FRAG', PARTICLE_FRAG],
    ['BRIGHT_PASS_FRAG', BRIGHT_PASS_FRAG],
    ['BLUR_FRAG', BLUR_FRAG],
    ['COMPOSITE_FRAG', COMPOSITE_FRAG],
  ] as const;

  it('uses WebGL2 GLSL ES 3.00 header and entry point in every shader', () => {
    for (const [name, src] of allShaders) {
      expect(src.startsWith('#version 300 es'), `${name} missing #version 300 es`).toBe(true);
      expect(src, `${name} missing main()`).toContain('void main()');
    }
  });

  it('contains dual MRT outputs in BLACKHOLE_FRAG and depth occlusion in 3D overlays', () => {
    expect(BLACKHOLE_FRAG).toContain('layout(location = 0) out vec4 outColor;');
    expect(BLACKHOLE_FRAG).toContain('layout(location = 1) out vec4 outDepth;');
    expect(GRID_FRAG).toContain('uSceneDepth');
    expect(PARTICLE_FRAG).toContain('uSceneDepth');
  });
});
