export const BRIGHT_PASS_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSourceTex;
uniform sampler2D uOverlayTex;
uniform float uThreshold;

void main() {
  vec3 col = texture(uSourceTex, vUv).rgb + texture(uOverlayTex, vUv).rgb;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float softKnee = 0.45;
  float rq = clamp(lum - uThreshold + softKnee, 0.0, 2.0 * softKnee);
  rq = (rq * rq) / (4.0 * softKnee + 1e-5);
  float contrib = max(rq, lum - uThreshold) / max(lum, 1e-4);
  outColor = vec4(col * max(0.0, contrib), 1.0);
}
`;

export const BLUR_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSourceTex;
uniform vec2 uTexelSize;
uniform vec2 uDirection;

void main() {
  // 9-tap separable Gaussian filter for silky wide HDR corona glow
  vec2 off1 = uDirection * uTexelSize * 1.3846153846;
  vec2 off2 = uDirection * uTexelSize * 3.2307692308;

  vec3 sum = texture(uSourceTex, vUv).rgb * 0.2270270270;
  sum += texture(uSourceTex, vUv + off1).rgb * 0.3162162162;
  sum += texture(uSourceTex, vUv - off1).rgb * 0.3162162162;
  sum += texture(uSourceTex, vUv + off2).rgb * 0.0702702703;
  sum += texture(uSourceTex, vUv - off2).rgb * 0.0702702703;

  outColor = vec4(sum, 1.0);
}
`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSceneTex;
uniform sampler2D uOverlayTex;
uniform sampler2D uBloomTightTex;
uniform sampler2D uBloomWideTex;
uniform float uBloomIntensity;
uniform float uTime;

// Narkowicz ACES filmic tone mapping curve
vec3 acesToneMap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  // Subtle optical edge chromatic aberration away from screen center
  vec2 centered = vUv - 0.5;
  float r2 = dot(centered, centered);
  vec2 caOffset = centered * r2 * 0.0045;

  float r = texture(uSceneTex, vUv + caOffset).r;
  float g = texture(uSceneTex, vUv).g;
  float b = texture(uSceneTex, vUv - caOffset).b;
  vec3 scene = vec3(r, g, b);

  vec3 overlay = texture(uOverlayTex, vUv).rgb;
  vec3 bloomTight = texture(uBloomTightTex, vUv).rgb;
  vec3 bloomWide = texture(uBloomWideTex, vUv).rgb;

  vec3 hdr = scene + overlay + (bloomTight * 0.50 + bloomWide * 0.36) * uBloomIntensity;

  // Cinematic exposure + ACES tone map + sRGB gamma
  vec3 mapped = acesToneMap(hdr * 0.86);
  mapped = pow(mapped, vec3(1.0 / 2.2));

  // Subtle radial cinematic vignette
  float vig = 1.0 - r2 * 0.52;
  mapped *= clamp(vig, 0.72, 1.0);

  // Micro temporal film dither prevents 8-bit dark-sky gradient banding
  float dither = fract(sin(dot(gl_FragCoord.xy + vec2(uTime * 11.3), vec2(12.9898, 78.233))) * 43758.5453);
  mapped += (dither - 0.5) / 255.0;

  outColor = vec4(clamp(mapped, 0.0, 1.0), 1.0);
}
`;
