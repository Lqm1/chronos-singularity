import { PRESET_LIST } from '../core/presets.ts';
import type {
  InteractionMode,
  PresetDefinition,
  PresetId,
  QualityMode,
  SimParams,
  TelemetrySnapshot,
} from '../core/types.ts';

interface SliderSpec {
  key: keyof Pick<
    SimParams,
    | 'mass'
    | 'spin'
    | 'lensingStrength'
    | 'diskDensity'
    | 'diskTurbulence'
    | 'diskTemperature'
    | 'dopplerStrength'
    | 'jetPower'
    | 'binaryMix'
    | 'bloomIntensity'
    | 'timeScale'
  >;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const SLIDER_SPECS: SliderSpec[] = [
  { key: 'mass', label: '特異点質量 (Mass)', min: 0.5, max: 1.9, step: 0.02, format: (v) => `${(v * 100).toFixed(0)}M M☉` },
  { key: 'spin', label: 'Kerr スピン (a*)', min: -0.95, max: 0.95, step: 0.02, format: (v) => v.toFixed(2) },
  { key: 'lensingStrength', label: '重力レンズ曲率', min: 0.35, max: 1.85, step: 0.02, format: (v) => `${v.toFixed(2)}×` },
  { key: 'diskDensity', label: '降着円盤・密度', min: 0.1, max: 2.0, step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'diskTurbulence', label: '磁気乱流・螺旋', min: 0.3, max: 1.9, step: 0.02, format: (v) => v.toFixed(2) },
  { key: 'diskTemperature', label: '黒体輻射温度', min: 0.55, max: 1.75, step: 0.02, format: (v) => `${Math.round(v * 6800)} K` },
  { key: 'dopplerStrength', label: '相対論ドップラー効果', min: 0.0, max: 1.5, step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'jetPower', label: '極ジェット出力', min: 0.0, max: 2.0, step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'binaryMix', label: '連星合体ブレンド', min: 0.0, max: 1.0, step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'bloomIntensity', label: 'HDR コロナ残光', min: 0.0, max: 1.6, step: 0.02, format: (v) => v.toFixed(2) },
  { key: 'timeScale', label: '固有時間速度', min: 0.0, max: 2.2, step: 0.02, format: (v) => `${v.toFixed(2)}×` },
];

export interface HudCallbacks {
  onSelectPreset: (presetId: PresetId) => void;
  onParamChange: (key: SliderSpec['key'], value: number) => void;
  onResetCurrentPreset: () => void;
  onLaunchRandomStar: () => void;
  onToggleGrid: () => void;
  onToggleAudio: () => void;
  onToggleAutoOrbit: () => void;
  onCaptureSnapshot: () => void;
  onToggleCinema: () => void;
  onChangeInteractionMode: (mode: InteractionMode) => void;
  onChangeQuality: (mode: QualityMode) => void;
  onClearStars: () => void;
}

export class HudController {
  private readonly hudRoot: HTMLElement;
  private readonly restoreHudBtn: HTMLButtonElement;
  private readonly subtitleEl: HTMLElement;
  private readonly teleMass: HTMLElement;
  private readonly teleDist: HTMLElement;
  private readonly teleDilation: HTMLElement;
  private readonly teleEscape: HTMLElement;
  private readonly teleFps: HTMLElement;
  private readonly statAbsorbed: HTMLElement;
  private readonly drawerEl: HTMLElement;
  private readonly btnGrid: HTMLButtonElement;
  private readonly btnAudio: HTMLButtonElement;
  private readonly btnAutoOrbit: HTMLButtonElement;
  private readonly btnControlsToggle: HTMLButtonElement;
  private readonly modeOrbitBtn: HTMLButtonElement;
  private readonly modeLaunchBtn: HTMLButtonElement;
  private readonly presetButtons = new Map<PresetId, HTMLButtonElement>();
  private readonly sliderInputs = new Map<SliderSpec['key'], { input: HTMLInputElement; valEl: HTMLElement; spec: SliderSpec }>();
  private readonly qualityButtons: HTMLButtonElement[];
  private readonly toastEl: HTMLElement;
  private toastTimer: number | null = null;
  private drawerOpen = false;
  private cinemaMode = false;

  constructor(callbacks: HudCallbacks, targetParams: SimParams) {
    this.hudRoot = this.req('hud-root');
    this.restoreHudBtn = this.req('btn-restore-hud') as HTMLButtonElement;
    this.subtitleEl = this.req('preset-subtitle');
    this.teleMass = this.req('tele-mass');
    this.teleDist = this.req('tele-dist');
    this.teleDilation = this.req('tele-dilation');
    this.teleEscape = this.req('tele-escape');
    this.teleFps = this.req('tele-fps');
    this.statAbsorbed = this.req('stat-absorbed');
    this.drawerEl = this.req('controls-drawer');
    this.btnGrid = this.req('btn-grid') as HTMLButtonElement;
    this.btnAudio = this.req('btn-audio') as HTMLButtonElement;
    this.btnAutoOrbit = this.req('btn-auto-orbit') as HTMLButtonElement;
    this.btnControlsToggle = this.req('btn-controls-toggle') as HTMLButtonElement;
    this.modeOrbitBtn = this.req('mode-orbit') as HTMLButtonElement;
    this.modeLaunchBtn = this.req('mode-launch') as HTMLButtonElement;
    this.toastEl = this.req('toast-banner');

    // Build preset buttons
    const presetBar = this.req('preset-bar');
    for (const preset of PRESET_LIST) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-btn';
      btn.setAttribute('role', 'tab');
      btn.innerHTML = `
        <span class="preset-code">${preset.code}</span>
        <span class="preset-name">${preset.name}</span>
        <span class="preset-ja">${preset.subtitleJa}</span>
      `;
      btn.addEventListener('click', () => callbacks.onSelectPreset(preset.id));
      presetBar.appendChild(btn);
      this.presetButtons.set(preset.id, btn);
    }

    // Build sliders
    const sliderList = this.req('slider-list');
    for (const spec of SLIDER_SPECS) {
      const row = document.createElement('div');
      row.className = 'slider-row';

      const head = document.createElement('div');
      head.className = 'slider-head';

      const label = document.createElement('span');
      label.textContent = spec.label;

      const valEl = document.createElement('span');
      valEl.className = 'slider-val';
      valEl.textContent = spec.format(targetParams[spec.key]);

      head.append(label, valEl);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(targetParams[spec.key]);
      input.addEventListener('input', () => {
        const num = Number(input.value);
        valEl.textContent = spec.format(num);
        callbacks.onParamChange(spec.key, num);
      });

      row.append(head, input);
      sliderList.appendChild(row);
      this.sliderInputs.set(spec.key, { input, valEl, spec });
    }

    this.qualityButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-quality]'));
    for (const qBtn of this.qualityButtons) {
      qBtn.addEventListener('click', () => {
        const mode = qBtn.dataset.quality as QualityMode;
        callbacks.onChangeQuality(mode);
        this.setQualityMode(mode);
      });
    }

    this.req('btn-launch-star').addEventListener('click', callbacks.onLaunchRandomStar);
    this.btnGrid.addEventListener('click', callbacks.onToggleGrid);
    this.btnAudio.addEventListener('click', callbacks.onToggleAudio);
    this.btnAutoOrbit.addEventListener('click', callbacks.onToggleAutoOrbit);
    this.req('btn-snapshot').addEventListener('click', callbacks.onCaptureSnapshot);
    this.req('btn-cinema').addEventListener('click', callbacks.onToggleCinema);
    this.restoreHudBtn.addEventListener('click', callbacks.onToggleCinema);
    this.req('btn-reset-params').addEventListener('click', callbacks.onResetCurrentPreset);
    this.req('btn-clear-stars').addEventListener('click', callbacks.onClearStars);

    this.btnControlsToggle.addEventListener('click', () => this.toggleDrawer());
    this.modeOrbitBtn.addEventListener('click', () => callbacks.onChangeInteractionMode('orbit'));
    this.modeLaunchBtn.addEventListener('click', () => callbacks.onChangeInteractionMode('launch'));
  }

  private req(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing DOM element #${id}`);
    return el;
  }

  public applyPresetUI(preset: PresetDefinition, params: SimParams): void {
    for (const [id, btn] of this.presetButtons.entries()) {
      const active = id === preset.id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    this.subtitleEl.textContent = `${preset.subtitleJa} — ${preset.descriptionJa}`;

    // Sync CSS accent hue smoothly to preset palette
    const [r, g, b] = preset.params.primaryHue.map((v) => Math.round(Math.min(1, v) * 255));
    document.documentElement.style.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
    document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.38)`);

    this.syncSliders(params);
  }

  public syncSliders(params: SimParams): void {
    for (const [key, entry] of this.sliderInputs.entries()) {
      const val = params[key];
      entry.input.value = String(val);
      entry.valEl.textContent = entry.spec.format(val);
    }
  }

  public toggleDrawer(force?: boolean): void {
    this.drawerOpen = force !== undefined ? force : !this.drawerOpen;
    this.drawerEl.classList.toggle('is-open', this.drawerOpen);
    this.drawerEl.setAttribute('aria-hidden', String(!this.drawerOpen));
    this.btnControlsToggle.classList.toggle('is-active', this.drawerOpen);
    this.btnControlsToggle.setAttribute('aria-expanded', String(this.drawerOpen));
  }

  public toggleCinemaMode(force?: boolean): boolean {
    this.cinemaMode = force !== undefined ? force : !this.cinemaMode;
    this.hudRoot.classList.toggle('is-hidden', this.cinemaMode);
    this.restoreHudBtn.hidden = !this.cinemaMode;
    return this.cinemaMode;
  }

  public setGridActive(active: boolean): void {
    this.btnGrid.classList.toggle('is-active', active);
    this.btnGrid.setAttribute('aria-pressed', String(active));
  }

  public setAudioActive(active: boolean): void {
    this.btnAudio.classList.toggle('is-active', active);
    this.btnAudio.setAttribute('aria-pressed', String(active));
  }

  public setAutoOrbitActive(active: boolean): void {
    this.btnAutoOrbit.classList.toggle('is-active', active);
    this.btnAutoOrbit.setAttribute('aria-pressed', String(active));
  }

  public setInteractionMode(mode: InteractionMode): void {
    this.modeOrbitBtn.classList.toggle('is-active', mode === 'orbit');
    this.modeLaunchBtn.classList.toggle('is-active', mode === 'launch');
  }

  public setQualityMode(mode: QualityMode): void {
    for (const btn of this.qualityButtons) {
      btn.classList.toggle('is-active', btn.dataset.quality === mode);
    }
  }

  public updateTelemetry(t: TelemetrySnapshot): void {
    this.teleMass.textContent = `${t.massSolarMillions.toFixed(1)}M M☉`;
    this.teleDist.textContent = `${t.cameraDistanceRs.toFixed(2)} Rs`;
    this.teleDilation.textContent = t.timeDilationFactor.toFixed(4);
    this.teleEscape.textContent = `${t.escapeVelocityC.toFixed(3)} c`;
    this.teleFps.textContent = `${Math.round(t.fps)} FPS (${Math.round(t.renderScale * 100)}%)`;
    this.statAbsorbed.textContent = String(t.absorbedStars);
  }

  public showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-visible');
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
      this.toastTimer = null;
    }, 2400);
  }
}
