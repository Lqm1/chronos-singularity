import { NOISE_GLSL } from './common.glsl.ts';

export const BLACKHOLE_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outDepth;

uniform vec2 uResolution;
uniform float uTime;
uniform float uAspect;
uniform float uTanHalfFov;

uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;

uniform float uMass;
uniform float uSpin;
uniform float uLensingStrength;
uniform float uDiskDensity;
uniform float uDiskTurbulence;
uniform float uDiskTemperature;
uniform float uDopplerStrength;
uniform float uJetPower;
uniform float uBinaryMix;
uniform float uBinarySeparation;
uniform float uNebulaIntensity;

uniform vec3 uPrimaryHue;
uniform vec3 uSecondaryHue;
uniform vec3 uJetHue;

uniform vec3 uBinPosA;
uniform vec3 uBinPosB;
uniform int uMaxSteps;

uniform int uActiveComets;
uniform vec4 uCometPos[6]; // xyz, radius
uniform vec4 uCometCol[6]; // rgb, intensity

uniform int uActiveShockwaves;
uniform vec4 uShockwaveData[4]; // x, z, startTime, strength
uniform vec4 uShockwaveCol[4];  // rgb, unused

${NOISE_GLSL}

// Crisp multi-layer analytical starfield + sweeping deep-space nebula band
vec3 sampleStarLayer(vec3 dir, float scale, float densityThreshold, float brightnessScale) {
  vec3 p = dir * scale;
  vec3 id = floor(p);
  vec3 f = fract(p) - 0.5;
  vec3 rnd = hash33(id);
  if (rnd.x < densityThreshold) return vec3(0.0);

  vec3 starOffset = (rnd - 0.5) * 0.72;
  float d = length(f - starOffset);
  float core = smoothstep(0.14, 0.0, d);
  core = core * core * core;

  // Spectral color temperature from O/B blue-white to K/M warm amber
  float temp = rnd.y;
  vec3 starCol = mix(vec3(1.0, 0.72, 0.48), vec3(0.98, 0.98, 1.0), smoothstep(0.15, 0.55, temp));
  starCol = mix(starCol, vec3(0.64, 0.84, 1.0), smoothstep(0.55, 0.96, temp));

  float twinkle = 0.85 + 0.15 * sin(uTime * (1.2 + rnd.z * 3.0) + rnd.x * 40.0);
  float mag = pow((rnd.x - densityThreshold) / (1.0 - densityThreshold), 2.2);
  return starCol * core * (0.25 + 2.4 * mag) * brightnessScale * twinkle;
}

vec3 sampleBackground(vec3 dir) {
  vec3 d = normalize(dir);
  vec3 col = vec3(0.004, 0.006, 0.014);

  // Subtle galactic plane orientation
  vec3 galNormal = normalize(vec3(0.24, 0.87, -0.43));
  float galLat = dot(d, galNormal);
  float band = exp(-galLat * galLat * 14.0);

  if (uNebulaIntensity > 0.01) {
    float n1 = fbm4(d * 3.1 + vec3(1.7, -2.4, 0.9));
    float n2 = fbm3(d * 6.8 + vec3(n1 * 1.4, 4.1, -1.3));
    float dustRift = smoothstep(0.38, 0.74, n2);

    vec3 nebCool = mix(vec3(0.04, 0.09, 0.22), uJetHue * 0.26, 0.45);
    vec3 nebWarm = mix(vec3(0.18, 0.07, 0.24), uSecondaryHue * 0.28, 0.5);
    vec3 nebula = mix(nebCool, nebWarm, smoothstep(0.25, 0.78, n1));

    float cloud = band * smoothstep(0.22, 0.82, n1) * (1.0 - 0.68 * dustRift);
    float outerMist = exp(-galLat * galLat * 3.2) * smoothstep(0.42, 0.88, n1) * 0.28;
    col += nebula * (cloud * 1.25 + outerMist) * uNebulaIntensity;

    // Fine ionized filament glow inside the galactic band
    float ion = band * pow(max(0.0, 1.0 - abs(n2 - 0.52) * 4.5), 2.0);
    col += mix(uJetHue, uPrimaryHue, 0.35) * ion * 0.08 * uNebulaIntensity;
  }

  // Three scales of crisp spectral stars
  col += sampleStarLayer(d, 52.0, 0.85, 1.75);
  col += sampleStarLayer(d, 118.0, 0.81, 1.05);
  col += sampleStarLayer(d, 240.0, 0.77, 0.56);

  return col;
}

float diskDensityAndColor(
  vec3 p,
  vec3 rayDir,
  float rs,
  out vec3 emission
) {
  emission = vec3(0.0);
  float rXZ = length(p.xz);

  // Circumbinary cavity & bridge when binary mode is active
  float binaryCave = uBinaryMix * (uBinarySeparation * 0.52 + 0.35 * rs);
  float spinInnerShift = mix(1.42, 2.15, clamp(0.5 - 0.35 * uSpin, 0.08, 0.92));
  float rInner = max(rs * spinInnerShift, rs * 1.32 + binaryCave * 0.55);
  float rOuter = rs * 7.6 + uBinaryMix * 1.4;

  float halfHeight = (0.064 + 0.038 * pow(max(0.0, rXZ - rInner), 0.72)) * rs;
  if (abs(p.y) > halfHeight * 2.3 || rXZ < rInner * 0.78 || rXZ > rOuter * 1.12) {
    return 0.0;
  }

  float verticalProfile = exp(-pow(abs(p.y) / max(0.015, halfHeight), 1.9));
  float innerFade = smoothstep(rInner * 0.82, rInner * 1.16, rXZ);
  float outerFade = 1.0 - smoothstep(rOuter * 0.50, rOuter * 1.02, rXZ);
  float envelope = verticalProfile * innerFade * outerFade;
  if (envelope < 0.002) return 0.0;

  // Keplerian differential rotation + logarithmic spiral shear
  float omega = (1.55 + 0.35 * uSpin) / pow(max(rXZ / rs, 0.75), 1.38);
  float theta = atan(p.z, p.x);
  float spiralAngle = theta + uTime * omega * 0.95 + 3.05 * log(max(rXZ, 0.4));

  vec2 spiralCoord = vec2(cos(spiralAngle), sin(spiralAngle)) * (0.95 + 0.62 * log(max(rXZ, 0.6)));
  vec3 noiseCoord = vec3(
    spiralCoord * (2.5 * uDiskTurbulence),
    p.y * 5.6 + rXZ * 0.46 - uTime * 0.18
  );

  float f1 = fbm4(noiseCoord);
  float f2 = fbm3(noiseCoord * 2.45 + vec3(f1 * 1.7, -uTime * 0.25, 3.1));

  // Crisp concentric orbital plasma rings modulated by high-contrast spiral filaments
  float radialRings = 0.5 + 0.5 * sin(rXZ * 5.2 / rs - f1 * 4.1 + uTime * 0.55);
  float filaments = smoothstep(0.28, 0.78, f1 * 0.58 + f2 * 0.42);
  filaments = mix(0.14, 1.48, pow(filaments, 1.35)) * mix(0.52, 1.34, radialRings);

  // Dark dust lane contrast near midplane outer disk
  float dustLane = smoothstep(0.56, 0.86, f2) * smoothstep(rInner * 1.45, rOuter * 0.82, rXZ);
  float density = envelope * filaments * (1.0 - 0.52 * dustLane) * uDiskDensity;

  // Binary gravitational wave tidal spiral arms
  if (uBinaryMix > 0.02) {
    float wavePhase = rXZ * 2.3 - uTime * 3.2 - 2.0 * theta;
    float tidalWave = 0.5 + 0.5 * sin(wavePhase);
    density *= 1.0 + uBinaryMix * 0.48 * pow(tidalWave, 2.2);
  }

  // Radial blackbody temperature profile (hottest right outside ISCO)
  float radialNorm = clamp((rXZ - rInner) / max(0.5, rOuter - rInner), 0.0, 1.0);
  float tempProfile = pow(1.0 - radialNorm, 1.55) * uDiskTemperature;

  // Relativistic Doppler beaming & redshift
  float spinSign = uSpin < -0.15 ? -1.0 : 1.0;
  vec3 orbDir = normalize(vec3(-p.z, 0.0, p.x)) * spinSign;
  float beta = min(0.62, sqrt(0.52 * rs / max(rXZ, rs * 1.12)));
  float cosAlpha = dot(orbDir, -rayDir);
  float gamma = inversesqrt(max(0.18, 1.0 - beta * beta));
  float doppler = 1.0 / (gamma * (1.0 - beta * cosAlpha * uDopplerStrength));
  float beaming = pow(clamp(doppler, 0.40, 2.15), 2.15);

  // Hot ISCO edge -> primary hue -> cooler outer secondary hue (preserving rich chromatic saturation)
  vec3 hotCore = mix(uPrimaryHue, vec3(1.0, 0.93, 0.78), clamp(tempProfile * 0.28, 0.0, 0.44));
  vec3 diskHue = mix(uSecondaryHue * 0.78, hotCore, clamp(tempProfile * 1.05, 0.0, 1.0));

  // Blue/red Doppler spectral shift
  vec3 blueShifted = mix(diskHue, mix(uPrimaryHue, vec3(0.95, 0.96, 1.0), 0.35), clamp((doppler - 1.0) * 0.75, 0.0, 0.58));
  vec3 shiftedHue = mix(blueShifted, uSecondaryHue * vec3(1.05, 0.50, 0.32), clamp((1.0 - doppler) * 0.95, 0.0, 0.76));

  // Inner edge blazing photon-rim flare
  float innerGlow = exp(-pow(max(0.0, rXZ - rInner * 1.04) / (0.32 * rs), 2.0));
  float energy = (0.22 + 1.28 * tempProfile + 0.78 * innerGlow) * beaming;

  // Shockwave rings from rogue star impacts
  vec3 shockGlow = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uActiveShockwaves) break;
    vec4 sw = uShockwaveData[i];
    float age = uTime - sw.z;
    if (age > 0.0 && age < 4.5) {
      float distImpact = length(p.xz - sw.xy);
      float ringR = age * 3.4;
      float ring = exp(-pow((distImpact - ringR) / (0.28 + age * 0.18), 2.0));
      float fade = exp(-age * 0.85) * sw.w;
      shockGlow += uShockwaveCol[i].rgb * ring * fade * 3.8;
    }
  }

  emission = (shiftedHue * energy + shockGlow) * density;
  return density;
}

vec3 polarJetEmission(vec3 p, float rs) {
  if (uJetPower <= 0.01) return vec3(0.0);
  float absY = abs(p.y);
  if (absY < rs * 0.72 || absY > 18.0) return vec3(0.0);

  float rXZ = length(p.xz);
  float jetRadius = (0.18 + 0.14 * pow(absY, 0.76)) * rs;
  if (rXZ > jetRadius * 2.4) return vec3(0.0);

  float radialMask = exp(-pow(rXZ / max(0.04, jetRadius), 2.1));
  float axialFade = smoothstep(rs * 0.72, rs * 1.9, absY) * exp(-absY * 0.13);

  float twist = atan(p.z, p.x) + sign(p.y) * absY * 1.35 - uTime * 3.8;
  float helix = 0.5 + 0.5 * sin(twist * 2.0);
  float turb = fbm3(vec3(p.x * 2.2, absY * 0.85 - uTime * 3.2, p.z * 2.2));

  float intensity = radialMask * axialFade * (0.45 + 0.75 * helix * turb) * uJetPower;
  vec3 coreCol = mix(uJetHue, vec3(0.95, 0.98, 1.0), radialMask * 0.65);
  return coreCol * intensity * 1.65;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(
    uCamForward +
    ndc.x * uAspect * uTanHalfFov * uCamRight +
    ndc.y * uTanHalfFov * uCamUp
  );

  vec3 pos = uCamPos;
  vec3 vel = rd;

  const float R_BOUND = 24.0;
  float totalTraveled = 0.0;

  // Analytically advance straight ray to outer relativistic bounding sphere
  float b = dot(pos, vel);
  float c = dot(pos, pos) - R_BOUND * R_BOUND;
  if (c > 0.0) {
    float disc = b * b - c;
    if (disc <= 0.0) {
      outColor = vec4(sampleBackground(vel), 1.0);
      outDepth = vec4(1.0, 0.0, 0.0, 1.0);
      return;
    }
    float tEnter = max(0.0, -b - sqrt(disc));
    pos += vel * tEnter;
    totalTraveled += tEnter;
  }

  // Interleaved gradient noise jitter eliminates raymarch slicing bands
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

  vec3 accumColor = vec3(0.0);
  float transmittance = 1.0;
  float horizonHitDist = 1000.0;
  bool absorbed = false;

  float rsTotal = max(0.25, uMass);
  float binaryMix = clamp(uBinaryMix, 0.0, 1.0);
  float rsA = rsTotal * (1.0 - 0.36 * binaryMix);
  float rsB = rsTotal * (0.36 * binaryMix);

  float minHorizonDist = 100.0;
  float totalBend = 0.0;

  for (int stepIdx = 0; stepIdx < 176; stepIdx++) {
    if (stepIdx >= uMaxSteps) break;

    // Nearest singularity distance & horizon check
    float rGlobal = length(pos);
    float rNearest = rGlobal;
    float rsNearest = rsTotal;

    if (binaryMix > 0.02) {
      float dA = length(pos - uBinPosA);
      float dB = length(pos - uBinPosB);
      if (dA / max(0.1, rsA) < dB / max(0.1, rsB)) {
        rNearest = dA;
        rsNearest = rsA;
      } else {
        rNearest = dB;
        rsNearest = rsB;
      }
    }

    minHorizonDist = min(minHorizonDist, rNearest / max(0.15, rsNearest));

    if (rNearest <= rsNearest * 1.006) {
      absorbed = true;
      horizonHitDist = totalTraveled;
      break;
    }

    if (rGlobal > R_BOUND + 0.5 && dot(pos, vel) > 0.0) {
      break;
    }

    // Adaptive step: fine near photon sphere and disk equatorial plane, fast in outer space
    float diskProximity = clamp(abs(pos.y) / (0.75 * rsTotal), 0.12, 1.0);
    float dt = clamp(rNearest * 0.075 * mix(0.28, 1.12, diskProximity), 0.019, 0.50);
    if (stepIdx == 0) {
      dt *= (0.45 + 0.55 * jitter);
    }

    // Midpoint/Leapfrog geodesic bending
    vec3 accel = vec3(0.0);
    if (binaryMix > 0.02) {
      vec3 dpA = pos - uBinPosA;
      float rA = max(length(dpA), 0.15);
      vec3 hA = cross(dpA, vel);
      accel += -1.5 * rsA * dot(hA, hA) * dpA / pow(rA, 5.0);

      vec3 dpB = pos - uBinPosB;
      float rB = max(length(dpB), 0.15);
      vec3 hB = cross(dpB, vel);
      accel += -1.5 * rsB * dot(hB, hB) * dpB / pow(rB, 5.0);
    } else {
      vec3 h = cross(pos, vel);
      accel = -1.5 * rsTotal * dot(h, h) * pos / pow(max(rGlobal, 0.2), 5.0);
    }

    // Subtle Kerr frame-dragging asymmetry
    if (abs(uSpin) > 0.01) {
      vec3 swirl = vec3(-pos.z, 0.0, pos.x);
      accel += swirl * (uSpin * rsTotal * rsTotal * 0.28 / pow(max(rNearest, 0.4), 3.8));
    }

    accel *= uLensingStrength;

    vec3 prevVel = vel;
    vec3 velMid = normalize(vel + 0.5 * accel * dt);
    vec3 nextPos = pos + velMid * dt;
    vec3 nextVel = normalize(vel + accel * dt);

    totalBend += length(nextVel - prevVel);

    // Sample volumetric accretion disk with subtle low-discrepancy anti-aliasing along segment
    float stepFrac = fract(jitter + float(stepIdx) * 0.61803398875);
    vec3 samplePos = mix(pos, nextPos, 0.40 + 0.20 * stepFrac);
    vec3 diskEmit;
    float dDisk = diskDensityAndColor(samplePos, velMid, rsTotal, diskEmit);
    if (dDisk > 0.001) {
      float alpha = 1.0 - exp(-dDisk * dt * 1.18);
      accumColor += transmittance * diskEmit * dt * 1.05;
      transmittance *= (1.0 - alpha * 0.78);
    }

    // Sample volumetric polar jets
    if (uJetPower > 0.01) {
      accumColor += transmittance * polarJetEmission(samplePos, rsTotal) * dt * 0.75;
    }

    // Sample gravitationally lensed rogue stars along ray segment (crisp jewel core + soft corona)
    for (int i = 0; i < 6; i++) {
      if (i >= uActiveComets) break;
      vec4 cPos = uCometPos[i];
      vec4 cCol = uCometCol[i];
      vec3 pa = cPos.xyz - pos;
      float proj = clamp(dot(pa, velMid), 0.0, dt);
      float distToStar = length(pa - velMid * proj);
      float coreR = cPos.w;
      if (distToStar < coreR * 6.5) {
        float edgeMask = 1.0 - smoothstep(coreR * 2.0, coreR * 6.5, distToStar);
        float core = exp(-pow(distToStar / max(0.012, coreR * 0.45), 2.0));
        float halo = exp(-distToStar / max(0.025, coreR * 1.05)) * edgeMask * edgeMask;
        vec3 starHue = mix(cCol.rgb, vec3(1.0), core * 0.55);
        accumColor += transmittance * starHue * cCol.a * (core * 2.4 * edgeMask + halo * 0.45) * dt * 2.0;
      }
    }

    pos = nextPos;
    vel = nextVel;
    totalTraveled += dt;

    if (transmittance < 0.015) {
      break;
    }
  }

  // Razor-sharp photon ring grazing corona around shadow edge
  float photonRing = exp(-pow((minHorizonDist - 1.02) / 0.036, 2.0)) * smoothstep(0.55, 2.6, totalBend);
  vec3 photonTint = mix(uPrimaryHue, vec3(1.0, 0.93, 0.78), 0.32);
  accumColor += photonTint * photonRing * (0.24 + 0.12 * uDiskDensity) * (absorbed ? 0.45 : 1.0);

  if (!absorbed) {
    accumColor += transmittance * sampleBackground(vel);
  }

  outColor = vec4(max(accumColor, vec3(0.0)), 1.0);
  outDepth = vec4(clamp(horizonHitDist / 60.0, 0.0, 1.0), 1.0 - transmittance, 0.0, 1.0);
}
`;
