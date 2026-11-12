import type { PresetDefinition, PresetId, SimParams, Vec3 } from './types.ts';

export const PRESET_LIST: PresetDefinition[] = [
  {
    id: 'gargantua',
    code: '01',
    name: 'GARGANTUA',
    subtitleJa: '黄金の事象の地平面',
    descriptionJa: '強いドップラー・ビーミングとアインシュタイン・リングを伴う標準相対論的降着円盤',
    recommendedCamera: {
      yaw: 0.42,
      pitch: 0.16,
      distance: 10.6,
    },
    params: {
      mass: 1.0,
      spin: 0.65,
      lensingStrength: 1.05,
      diskDensity: 1.18,
      diskTurbulence: 1.0,
      diskTemperature: 1.02,
      dopplerStrength: 1.05,
      jetPower: 0.08,
      binaryMix: 0.0,
      binarySeparation: 3.2,
      bloomIntensity: 0.9,
      timeScale: 1.0,
      nebulaIntensity: 0.95,
      primaryHue: [1.0, 0.87, 0.56],
      secondaryHue: [0.96, 0.34, 0.07],
      jetHue: [0.46, 0.74, 1.0],
    },
  },
  {
    id: 'quasar',
    code: '02',
    name: 'QUASAR JET',
    subtitleJa: 'クェーサー極ジェット',
    descriptionJa: '高スピンKerrブラックホールの極軸から噴出する螺旋プラズマ・ジェット',
    recommendedCamera: {
      yaw: 0.88,
      pitch: 0.28,
      distance: 11.8,
    },
    params: {
      mass: 1.08,
      spin: 0.94,
      lensingStrength: 1.12,
      diskDensity: 1.15,
      diskTurbulence: 1.25,
      diskTemperature: 1.38,
      dopplerStrength: 1.18,
      jetPower: 1.75,
      binaryMix: 0.0,
      binarySeparation: 3.2,
      bloomIntensity: 1.08,
      timeScale: 1.15,
      nebulaIntensity: 1.05,
      primaryHue: [0.62, 0.93, 1.0],
      secondaryHue: [0.36, 0.22, 0.96],
      jetHue: [0.32, 0.82, 1.0],
    },
  },
  {
    id: 'magnetar',
    code: '03',
    name: 'MAGNETAR',
    subtitleJa: '深紅の磁気降着帯',
    descriptionJa: '激しい磁気乱流と深紅・紅蓮のプラズマフィラメントが渦巻く高密度降着トーラス',
    recommendedCamera: {
      yaw: -0.55,
      pitch: 0.21,
      distance: 9.8,
    },
    params: {
      mass: 0.95,
      spin: 0.78,
      lensingStrength: 1.0,
      diskDensity: 1.35,
      diskTurbulence: 1.52,
      diskTemperature: 0.88,
      dopplerStrength: 0.92,
      jetPower: 0.78,
      binaryMix: 0.0,
      binarySeparation: 3.2,
      bloomIntensity: 1.02,
      timeScale: 1.18,
      nebulaIntensity: 0.9,
      primaryHue: [1.0, 0.56, 0.68],
      secondaryHue: [0.92, 0.08, 0.24],
      jetHue: [1.0, 0.22, 0.72],
    },
  },
  {
    id: 'binary',
    code: '04',
    name: 'BINARY MERGER',
    subtitleJa: '連星特異点合体',
    descriptionJa: '共通重心周囲を公転する2つのブラックホールが織りなす二重重力レンズと重力波',
    recommendedCamera: {
      yaw: 0.24,
      pitch: 0.36,
      distance: 12.6,
    },
    params: {
      mass: 0.86,
      spin: 0.52,
      lensingStrength: 1.18,
      diskDensity: 1.05,
      diskTurbulence: 1.16,
      diskTemperature: 1.15,
      dopplerStrength: 0.85,
      jetPower: 0.24,
      binaryMix: 1.0,
      binarySeparation: 3.1,
      bloomIntensity: 0.98,
      timeScale: 1.1,
      nebulaIntensity: 1.0,
      primaryHue: [0.76, 0.91, 1.0],
      secondaryHue: [1.0, 0.45, 0.14],
      jetHue: [0.42, 0.86, 1.0],
    },
  },
  {
    id: 'void',
    code: '05',
    name: 'ECLIPSE VOID',
    subtitleJa: '翡翠と紫紺の虚無特異点',
    descriptionJa: '分光プリズムのような強い空間湾曲とオーロラ色のコロナが漂う静謐な深宇宙',
    recommendedCamera: {
      yaw: 1.15,
      pitch: 0.12,
      distance: 10.2,
    },
    params: {
      mass: 1.04,
      spin: -0.62,
      lensingStrength: 1.38,
      diskDensity: 0.95,
      diskTurbulence: 0.88,
      diskTemperature: 1.24,
      dopplerStrength: 0.78,
      jetPower: 0.42,
      binaryMix: 0.0,
      binarySeparation: 3.2,
      bloomIntensity: 1.0,
      timeScale: 0.78,
      nebulaIntensity: 1.32,
      primaryHue: [0.34, 1.0, 0.8],
      secondaryHue: [0.34, 0.16, 0.92],
      jetHue: [0.22, 0.9, 1.0],
    },
  },
];

export const PRESET_MAP: Record<PresetId, PresetDefinition> = Object.fromEntries(
  PRESET_LIST.map((preset) => [preset.id, preset])
) as Record<PresetId, PresetDefinition>;

export function cloneSimParams(params: SimParams): SimParams {
  return {
    ...params,
    primaryHue: [...params.primaryHue] as Vec3,
    secondaryHue: [...params.secondaryHue] as Vec3,
    jetHue: [...params.jetHue] as Vec3,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(out: Vec3, target: Vec3, t: number): void {
  out[0] = lerp(out[0], target[0], t);
  out[1] = lerp(out[1], target[1], t);
  out[2] = lerp(out[2], target[2], t);
}

/**
 * Exponentially damps current simulation parameters toward target parameters
 * so preset transitions and slider edits morph seamlessly without popping.
 */
export function dampSimParams(current: SimParams, target: SimParams, dt: number, speed = 5.5): void {
  const factor = 1 - Math.exp(-Math.max(0, dt) * speed);
  current.mass = lerp(current.mass, target.mass, factor);
  current.spin = lerp(current.spin, target.spin, factor);
  current.lensingStrength = lerp(current.lensingStrength, target.lensingStrength, factor);
  current.diskDensity = lerp(current.diskDensity, target.diskDensity, factor);
  current.diskTurbulence = lerp(current.diskTurbulence, target.diskTurbulence, factor);
  current.diskTemperature = lerp(current.diskTemperature, target.diskTemperature, factor);
  current.dopplerStrength = lerp(current.dopplerStrength, target.dopplerStrength, factor);
  current.jetPower = lerp(current.jetPower, target.jetPower, factor);
  current.binaryMix = lerp(current.binaryMix, target.binaryMix, factor);
  current.binarySeparation = lerp(current.binarySeparation, target.binarySeparation, factor);
  current.bloomIntensity = lerp(current.bloomIntensity, target.bloomIntensity, factor);
  current.timeScale = lerp(current.timeScale, target.timeScale, factor);
  current.nebulaIntensity = lerp(current.nebulaIntensity, target.nebulaIntensity, factor);
  lerpVec3(current.primaryHue, target.primaryHue, factor);
  lerpVec3(current.secondaryHue, target.secondaryHue, factor);
  lerpVec3(current.jetHue, target.jetHue, factor);
}
