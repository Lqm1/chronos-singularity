export const GRID_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aXZ;
layout(location = 1) in float aLineWeight;

uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uAspect;
uniform float uTanHalfFov;

uniform float uTime;
uniform float uMass;
uniform float uLensingStrength;
uniform float uBinaryMix;
uniform vec3 uBinPosA;
uniform vec3 uBinPosB;

out float vViewDist;
out float vWellDepth;
out float vEdgeFade;
out float vLineWeight;

void main() {
  float rs = max(0.25, uMass);
  vec2 xz = aXZ;

  // Gravitational potential funnel (Flamm's paraboloid / Paczynski-Wiita depression)
  float well = 0.0;
  if (uBinaryMix > 0.02) {
    float rsA = rs * (1.0 - 0.36 * uBinaryMix);
    float rsB = rs * (0.36 * uBinaryMix);
    float dA = length(xz - uBinPosA.xz);
    float dB = length(xz - uBinPosB.xz);
    well += -1.75 * rsA / max(0.55, dA - rsA * 0.42);
    well += -1.75 * rsB / max(0.45, dB - rsB * 0.42);

    // Outward quadrupole gravitational wave ripple
    float rGlobal = length(xz);
    float theta = atan(xz.y, xz.x);
    float gw = sin(rGlobal * 1.9 - uTime * 3.4 - 2.0 * theta);
    well += uBinaryMix * 0.16 * gw * smoothstep(1.5, 5.0, rGlobal) * exp(-rGlobal * 0.06);
  } else {
    float r = length(xz);
    well = -1.95 * rs / max(0.58, r - rs * 0.45);
  }

  well *= (0.75 + 0.35 * uLensingStrength);
  well = clamp(well, -3.6, 0.4);

  vec3 worldPos = vec3(xz.x, -1.65 + well, xz.y);
  vec3 rel = worldPos - uCamPos;

  float viewZ = dot(rel, uCamForward);
  float viewX = dot(rel, uCamRight);
  float viewY = dot(rel, uCamUp);

  float near = 0.15;
  float far = 120.0;
  float ndcX = viewX / (max(0.05, viewZ) * uAspect * uTanHalfFov);
  float ndcY = viewY / (max(0.05, viewZ) * uTanHalfFov);
  float ndcZ = (viewZ - near) / (far - near) * 2.0 - 1.0;

  if (viewZ <= near) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
  } else {
    gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
  }

  vViewDist = length(rel);
  vWellDepth = clamp(-well / 3.0, 0.0, 1.0);
  float rOut = length(xz);
  vEdgeFade = (1.0 - smoothstep(11.5, 16.5, rOut)) * smoothstep(0.65 * rs, 1.35 * rs, rOut);
  vLineWeight = aLineWeight;
}
`;

export const GRID_FRAG = `#version 300 es
precision highp float;

in float vViewDist;
in float vWellDepth;
in float vEdgeFade;
in float vLineWeight;

uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform float uGridOpacity;
uniform vec3 uPrimaryHue;
uniform vec3 uJetHue;

out vec4 outColor;

void main() {
  if (uGridOpacity <= 0.005 || vEdgeFade <= 0.005) discard;

  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 depthInfo = texture(uSceneDepth, uv).rg;
  float horizonDist = depthInfo.r * 60.0;

  // Occlude lines behind the black hole shadow
  if (depthInfo.r < 0.98 && vViewDist > horizonDist + 0.12) discard;

  vec3 col = mix(uJetHue * 0.55, uPrimaryHue * 1.25, vWellDepth);
  float alpha = uGridOpacity * vEdgeFade * vLineWeight * (0.28 + 0.65 * vWellDepth);
  // Attenuate softly behind thick foreground accretion plasma
  alpha *= (1.0 - 0.55 * depthInfo.g);

  outColor = vec4(col * alpha * 1.45, alpha);
}
`;

export const PARTICLE_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aWorldPos;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aSize;
layout(location = 3) in float aAlpha;

uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uAspect;
uniform float uTanHalfFov;
uniform float uResolutionY;

out vec3 vColor;
out float vAlpha;
out float vViewDist;

void main() {
  vec3 rel = aWorldPos - uCamPos;
  float viewZ = dot(rel, uCamForward);
  if (viewZ <= 0.15) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    return;
  }

  float viewX = dot(rel, uCamRight);
  float viewY = dot(rel, uCamUp);

  float ndcX = viewX / (viewZ * uAspect * uTanHalfFov);
  float ndcY = viewY / (viewZ * uTanHalfFov);
  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);

  vViewDist = length(rel);
  float projSize = (aSize * uResolutionY * 0.5) / (viewZ * uTanHalfFov);
  gl_PointSize = clamp(projSize, 1.5, 44.0);
  vColor = aColor;
  vAlpha = aAlpha;
}
`;

export const PARTICLE_FRAG = `#version 300 es
precision highp float;

in vec3 vColor;
in float vAlpha;
in float vViewDist;

uniform sampler2D uSceneDepth;
uniform vec2 uResolution;

out vec4 outColor;

void main() {
  if (vAlpha <= 0.005) discard;

  vec2 uv = gl_FragCoord.xy / uResolution;
  float depthNorm = texture(uSceneDepth, uv).r;
  float horizonDist = depthNorm * 60.0;
  if (depthNorm < 0.98 && vViewDist > horizonDist + 0.08) discard;

  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;

  float core = exp(-r2 * 5.2);
  float halo = exp(-r2 * 1.9) * 0.42;
  float shape = core + halo;

  outColor = vec4(vColor * shape * vAlpha * 2.2, shape * vAlpha);
}
`;
