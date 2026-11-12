/**
 * Procedural Web Audio API cosmic soundscape synthesizer.
 * Zero external audio assets; reacts continuously to camera proximity and star captures.
 */
export class CosmicAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private shimmerGain: GainNode | null = null;
  private oscLow: OscillatorNode | null = null;
  private oscMid: OscillatorNode | null = null;
  private oscFifth: OscillatorNode | null = null;
  private enabled = false;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public toggle(): boolean {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.enabled;
  }

  public enable(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.0001;
      this.masterGain.connect(this.ctx.destination);

      this.droneFilter = this.ctx.createBiquadFilter();
      this.droneFilter.type = 'lowpass';
      this.droneFilter.frequency.value = 180;
      this.droneFilter.Q.value = 3.2;
      this.droneFilter.connect(this.masterGain);

      // Deep gravitational sub-bass triad (36 Hz, 54 Hz, 72.15 Hz)
      this.oscLow = this.ctx.createOscillator();
      this.oscLow.type = 'sawtooth';
      this.oscLow.frequency.value = 36;
      const gLow = this.ctx.createGain();
      gLow.gain.value = 0.24;
      this.oscLow.connect(gLow);
      gLow.connect(this.droneFilter);

      this.oscMid = this.ctx.createOscillator();
      this.oscMid.type = 'triangle';
      this.oscMid.frequency.value = 54.08;
      const gMid = this.ctx.createGain();
      gMid.gain.value = 0.18;
      this.oscMid.connect(gMid);
      gMid.connect(this.droneFilter);

      this.oscFifth = this.ctx.createOscillator();
      this.oscFifth.type = 'sine';
      this.oscFifth.frequency.value = 108.2;
      this.shimmerGain = this.ctx.createGain();
      this.shimmerGain.gain.value = 0.06;
      this.oscFifth.connect(this.shimmerGain);
      this.shimmerGain.connect(this.masterGain);

      this.oscLow.start();
      this.oscMid.start();
      this.oscFifth.start();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setTargetAtTime(0.28, this.ctx.currentTime, 0.35);
    }
    this.enabled = true;
  }

  public disable(): void {
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
    }
    this.enabled = false;
  }

  public update(cameraDistanceRs: number, dopplerEnergy: number): void {
    if (!this.enabled || !this.ctx || !this.droneFilter || !this.shimmerGain || !this.oscLow) return;

    const now = this.ctx.currentTime;
    const proximity = Math.max(0, Math.min(1, 1 - (cameraDistanceRs - 3.5) / 16));
    const cutoff = 110 + proximity * 420 + dopplerEnergy * 110;
    this.droneFilter.frequency.setTargetAtTime(cutoff, now, 0.12);
    this.shimmerGain.gain.setTargetAtTime(0.03 + proximity * 0.08, now, 0.15);
    // Subtle gravitational pitch bend near horizon
    this.oscLow.frequency.setTargetAtTime(36 - proximity * 4.5, now, 0.2);
  }

  public playLaunchChime(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(528, now);
    osc.frequency.exponentialRampToValueAtTime(264, now + 0.55);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.65);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.7);
  }

  public playImpactPulse(strength = 1): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.85);

    subGain.gain.setValueAtTime(Math.min(0.32, 0.22 * strength), now);
    subGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.95);

    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 1.0);
  }
}
