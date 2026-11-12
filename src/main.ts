import './styles/main.css';
import { CosmicAudioEngine } from './audio/cosmicAudio.ts';
import { computeTelemetry, createRogueStarFromScreen, stepRogueStars } from './core/physics.ts';
import { cloneSimParams, dampSimParams, PRESET_LIST, PRESET_MAP } from './core/presets.ts';
import type {
  CameraState,
  InteractionMode,
  PresetId,
  QualityMode,
  RogueStar,
  ShockwaveEvent,
  SimParams,
} from './core/types.ts';
import { BlackHoleRenderer } from './render/renderer.ts';
import { HudController } from './ui/hud.ts';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function bootstrap(): void {
  const canvas = document.getElementById('singularity-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing #singularity-canvas element');
  }

  let renderer: BlackHoleRenderer;
  try {
    renderer = new BlackHoleRenderer(canvas);
  } catch (err) {
    document.body.innerHTML = `
      <div style="display:grid;place-items:center;height:100vh;background:#05070e;color:#eef2ff;font-family:sans-serif;padding:24px;text-align:center;">
        <div style="max-width:480px;border:1px solid rgba(255,255,255,0.14);border-radius:16px;padding:24px;background:rgba(12,16,28,0.85);">
          <h1 style="margin-top:0;font-size:20px;">WebGL2 が利用できません</h1>
          <p style="opacity:0.8;line-height:1.6;">このリアルタイム相対論的ブラックホール・シミュレータには WebGL2 対応ブラウザが必要です。</p>
          <pre style="font-size:12px;opacity:0.6;white-space:pre-wrap;">${String(err)}</pre>
        </div>
      </div>
    `;
    return;
  }

  let activePresetId: PresetId = 'gargantua';
  const initialPreset = PRESET_MAP[activePresetId];
  const currentParams: SimParams = cloneSimParams(initialPreset.params);
  let targetParams: SimParams = cloneSimParams(initialPreset.params);

  const camera: CameraState = {
    yaw: initialPreset.recommendedCamera.yaw,
    pitch: initialPreset.recommendedCamera.pitch,
    distance: initialPreset.recommendedCamera.distance,
    targetYaw: initialPreset.recommendedCamera.yaw,
    targetPitch: initialPreset.recommendedCamera.pitch,
    targetDistance: initialPreset.recommendedCamera.distance,
    autoOrbit: true,
    autoOrbitSpeed: 0.14,
  };

  let simTime = 0;
  let gridTargetOpacity = 0;
  let gridOpacity = 0;
  let interactionMode: InteractionMode = 'orbit';
  const rogueStars: RogueStar[] = [];
  const shockwaves: ShockwaveEvent[] = [];
  let absorbedStars = 0;

  const audio = new CosmicAudioEngine();

  const launchStarAtNdc = (ndcX: number, ndcY: number, plungeBias = false, quiet = false): void => {
    const star = createRogueStarFromScreen(ndcX, ndcY, camera, currentParams, plungeBias);
    rogueStars.push(star);
    while (rogueStars.length > 8) {
      rogueStars.shift();
    }
    if (!quiet) {
      audio.playLaunchChime();
    }
  };

  const selectPreset = (presetId: PresetId): void => {
    const preset = PRESET_MAP[presetId];
    activePresetId = presetId;
    targetParams = cloneSimParams(preset.params);
    camera.targetYaw = preset.recommendedCamera.yaw;
    camera.targetPitch = preset.recommendedCamera.pitch;
    camera.targetDistance = preset.recommendedCamera.distance;
    hud.applyPresetUI(preset, targetParams);
    hud.showToast(`${preset.code} ${preset.name} — ${preset.subtitleJa}`);
  };

  const toggleGrid = (): void => {
    gridTargetOpacity = gridTargetOpacity > 0.1 ? 0 : 0.78;
    const active = gridTargetOpacity > 0.1;
    hud.setGridActive(active);
    hud.showToast(active ? '3D 時空湾曲グリッド: ON' : '3D 時空湾曲グリッド: OFF');
  };

  const toggleAudio = (): void => {
    const enabled = audio.toggle();
    hud.setAudioActive(enabled);
    hud.showToast(enabled ? '宇宙音響シンセ: ON' : '宇宙音響シンセ: OFF');
  };

  const toggleAutoOrbit = (): void => {
    camera.autoOrbit = !camera.autoOrbit;
    hud.setAutoOrbitActive(camera.autoOrbit);
  };

  const captureSnapshot = (): void => {
    const dataUrl = renderer.capturePngDataUrl(
      simTime,
      camera,
      currentParams,
      rogueStars,
      shockwaves,
      gridOpacity
    );
    const link = document.createElement('a');
    link.download = `chronos-singularity-${activePresetId}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
    hud.showToast('高精細PNGスナップショットを保存しました');
  };

  const setInteractionMode = (mode: InteractionMode): void => {
    interactionMode = mode;
    canvas.classList.toggle('launch-cursor', mode === 'launch');
    hud.setInteractionMode(mode);
  };

  const hud = new HudController(
    {
      onSelectPreset: selectPreset,
      onParamChange: (key, value) => {
        targetParams[key] = value;
      },
      onResetCurrentPreset: () => {
        selectPreset(activePresetId);
        hud.showToast('プリセットを初期値へ戻しました');
      },
      onLaunchRandomStar: () => {
        const ndcX = (Math.random() - 0.5) * 0.9;
        const ndcY = (Math.random() - 0.5) * 0.55;
        launchStarAtNdc(ndcX, ndcY, Math.random() < 0.35);
      },
      onToggleGrid: toggleGrid,
      onToggleAudio: toggleAudio,
      onToggleAutoOrbit: toggleAutoOrbit,
      onCaptureSnapshot: captureSnapshot,
      onToggleCinema: () => {
        const hidden = hud.toggleCinemaMode();
        if (!hidden) hud.showToast('HUDを表示しました');
      },
      onChangeInteractionMode: setInteractionMode,
      onChangeQuality: (mode: QualityMode) => {
        renderer.setQualityMode(mode);
        hud.showToast(`描画品質: ${mode.toUpperCase()}`);
      },
      onClearStars: () => {
        rogueStars.length = 0;
        shockwaves.length = 0;
        hud.showToast('恒星軌道をクリアしました');
      },
    },
    targetParams
  );

  hud.applyPresetUI(initialPreset, targetParams);

  // Pointer & wheel camera + star-launch controls
  let dragging = false;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    dragMoved = false;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.hypot(dx, dy) > 3) {
      dragMoved = true;
    }
    if (interactionMode === 'orbit' && !e.shiftKey) {
      camera.targetYaw -= dx * 0.0058;
      camera.targetPitch = clamp(camera.targetPitch + dy * 0.0046, -1.42, 1.42);
    }
    lastX = e.clientX;
    lastY = e.clientY;
  });

  canvas.addEventListener('pointerup', (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    const shouldLaunch =
      !dragMoved && (e.shiftKey || interactionMode === 'launch' || e.button === 2);
    dragging = false;

    if (shouldLaunch) {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      launchStarAtNdc(ndcX, ndcY, e.altKey);
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const zoomDelta = e.deltaY * 0.0085;
      camera.targetDistance = clamp(camera.targetDistance + zoomDelta, 3.8, 23.0);
    },
    { passive: false }
  );

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    if (key >= '1' && key <= '5') {
      const idx = Number(key) - 1;
      const preset = PRESET_LIST[idx];
      if (preset) selectPreset(preset.id);
    } else if (key === 'g') {
      toggleGrid();
    } else if (key === 'a') {
      toggleAudio();
    } else if (key === 'r') {
      toggleAutoOrbit();
    } else if (key === 'h') {
      hud.toggleCinemaMode();
    } else if (key === 's') {
      hud.toggleDrawer();
    } else if (key === 'p') {
      captureSnapshot();
    } else if (e.code === 'Space') {
      e.preventDefault();
      launchStarAtNdc((Math.random() - 0.5) * 0.85, (Math.random() - 0.5) * 0.5, false);
    }
  });

  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
  });

  // Launch one graceful hero rogue star shortly after boot for immediate cosmic life
  window.setTimeout(() => {
    if (rogueStars.length === 0) {
      launchStarAtNdc(-0.56, 0.22, false, true);
    }
  }, 400);

  let prevTs = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let currentFps = 60;
  let telemetryTimer = 0;

  const frame = (now: number): void => {
    const rawDt = Math.min(0.05, Math.max(0.001, (now - prevTs) / 1000));
    prevTs = now;

    // Smooth parameter & grid interpolation
    dampSimParams(currentParams, targetParams, rawDt, 5.2);
    gridOpacity += (gridTargetOpacity - gridOpacity) * (1 - Math.exp(-rawDt * 8.0));

    // Smooth spring-damped orbital camera
    if (camera.autoOrbit && !dragging) {
      camera.targetYaw += camera.autoOrbitSpeed * rawDt;
    }
    const camDamp = 1 - Math.exp(-rawDt * 7.5);
    camera.yaw += (camera.targetYaw - camera.yaw) * camDamp;
    camera.pitch += (camera.targetPitch - camera.pitch) * camDamp;
    camera.distance += (camera.targetDistance - camera.distance) * camDamp;

    const simDt = rawDt * currentParams.timeScale;
    simTime += simDt;

    // Step rogue star physics
    const stepRes = stepRogueStars(rogueStars, simDt, simTime, currentParams);
    if (stepRes.absorbedCount > 0) {
      absorbedStars += stepRes.absorbedCount;
      audio.playImpactPulse(1.1);
    }
    if (stepRes.shockwaves.length > 0) {
      for (const sw of stepRes.shockwaves) {
        shockwaves.unshift(sw);
      }
      if (shockwaves.length > 4) shockwaves.length = 4;
      if (stepRes.absorbedCount === 0) {
        audio.playImpactPulse(0.65);
      }
    }

    // Prune dead stars after short fade
    for (let i = rogueStars.length - 1; i >= 0; i--) {
      if (!rogueStars[i].alive) rogueStars.splice(i, 1);
    }
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      if (simTime - shockwaves[i].startTime > 4.8) shockwaves.splice(i, 1);
    }

    // Render WebGL2 scene
    renderer.render(simTime, camera, currentParams, rogueStars, shockwaves, gridOpacity);

    // FPS & adaptive scaling + telemetry update
    fpsAccum += rawDt;
    fpsFrames++;
    telemetryTimer += rawDt;

    if (fpsFrames >= 24) {
      const avgFrameMs = (fpsAccum / fpsFrames) * 1000;
      currentFps = 1000 / Math.max(1, avgFrameMs);
      renderer.adaptScale(avgFrameMs);
      fpsAccum = 0;
      fpsFrames = 0;
    }

    const tele = computeTelemetry(
      currentParams,
      camera,
      currentFps,
      renderer.getRenderScale(),
      rogueStars.length,
      absorbedStars
    );
    audio.update(tele.cameraDistanceRs, currentParams.dopplerStrength);

    if (telemetryTimer >= 0.12) {
      hud.updateTelemetry(tele);
      telemetryTimer = 0;
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

bootstrap();
