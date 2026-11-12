export type PresetId = 'gargantua' | 'quasar' | 'magnetar' | 'binary' | 'void';

export type QualityMode = 'auto' | 'ultra' | 'high' | 'balanced';

export type InteractionMode = 'orbit' | 'launch';

export type Vec3 = [number, number, number];

export interface SimParams {
  mass: number;
  spin: number;
  lensingStrength: number;
  diskDensity: number;
  diskTurbulence: number;
  diskTemperature: number;
  dopplerStrength: number;
  jetPower: number;
  binaryMix: number;
  binarySeparation: number;
  bloomIntensity: number;
  timeScale: number;
  nebulaIntensity: number;
  primaryHue: Vec3;
  secondaryHue: Vec3;
  jetHue: Vec3;
}

export interface PresetDefinition {
  id: PresetId;
  code: string;
  name: string;
  subtitleJa: string;
  descriptionJa: string;
  recommendedCamera: {
    yaw: number;
    pitch: number;
    distance: number;
  };
  params: SimParams;
}

export interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  targetYaw: number;
  targetPitch: number;
  targetDistance: number;
  autoOrbit: boolean;
  autoOrbitSpeed: number;
}

export interface RogueStar {
  id: number;
  pos: Vec3;
  vel: Vec3;
  color: Vec3;
  radius: number;
  age: number;
  maxAge: number;
  alive: boolean;
  trail: Vec3[];
  tidalStretch: number;
  crossedDiskOnce: boolean;
}

export interface ShockwaveEvent {
  x: number;
  z: number;
  startTime: number;
  strength: number;
  color: Vec3;
}

export interface TelemetrySnapshot {
  massSolarMillions: number;
  schwarzschildKm: number;
  photonSphereRs: number;
  shadowRadiusRs: number;
  cameraDistanceRs: number;
  timeDilationFactor: number;
  escapeVelocityC: number;
  orbitalVelocityC: number;
  fps: number;
  renderScale: number;
  activeStars: number;
  absorbedStars: number;
}
