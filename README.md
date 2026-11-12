# CHRONOS // SINGULARITY

> Real-time WebGL2 Relativistic Black Hole, Gravitational Lensing & Spacetime Observatory  
> リアルタイム WebGL2 相対論的ブラックホール・重力レンズ＆時空観測シミュレータ

**Live Demo (GitHub Pages):** https://lqm1.github.io/chronos-singularity/

---

## Features / 主な機能

- **Relativistic Geodesic Raymarching (GLSL ES 3.00)**  
  Schwarzschild / Kerr 測地線に沿った光の曲げ、光子球 ($1.5\,R_s$)、アインシュタイン・リング、降着円盤の相対論的ドップラー・ビーミングをピクセル単位でリアルタイム計算。
- **Multi-Pass HDR Pipeline & ACES Tone Mapping**  
  `RGBA16F` 浮動小数点レンダーターゲット（非対応 GPU 向け `RGBA8` フォールバック付）による輝度抽出・2段階ガウシアン・ブルーム・エッジ色収差・ACES フィルミック合成。
- **5 Interactive Astrophysical Presets (`1`–`5`)**
  1. `01 GARGANTUA` — 黄金の事象の地平面
  2. `02 QUASAR JET` — 高スピン Kerr ブラックホールの極軸プラズマ・ジェット
  3. `03 MAGNETAR` — 激しい磁気乱流と深紅の降着トーラス
  4. `04 BINARY MERGER` — 共通重心を公転する連星ブラックホールの二重重力レンズ＆重力波
  5. `05 ECLIPSE VOID` — 強い空間湾曲とオーロラ色のコロナ
- **Interactive Physics & Overlays**
  - **Rogue Star Injector (`Shift + Click` / `Space`)**: Paczyński–Wiita 擬ニュートンポテンシャル + Velocity-Verlet 積分で恒星を軌道投入。潮汐変形・円盤衝撃波・重力レンズ弧をリアルタイム生成。
  - **3D Spacetime Curvature Grid (`G`)**: 事象の地平面の深度遮蔽に対応した立体的な重力井戸メッシュ。
  - **Procedural Cosmic Audio (`A`)**: Web Audio API による外部音声ファイル不要のリアルタイム宇宙音響シンセ。
  - **Cinema Mode (`H`) & PNG Snapshot (`P`)**

---

## Controls / 操作方法

| 操作 / キー | 機能 |
| --- | --- |
| ドラッグ | カメラ周回 |
| ホイール | 事象の地平面への接近・離脱 |
| `Shift` + クリック / `Space` | 恒星を重力圏へ投入 |
| `1` – `5` | プリセット切替 |
| `G` | 3D 時空湾曲グリッド ON/OFF |
| `A` | プロシージャル宇宙音響 ON/OFF |
| `S` | 物理パラメータ調整パネル開閉 |
| `R` | 自動周回カメラ ON/OFF |
| `H` | HUD 非表示（シネマモード） |
| `P` | PNG スナップショット保存 |

---

## Development / ローカル開発

```bash
npm install
npm run dev        # Start Vite dev server
npm test           # Run Vitest unit & shader contract tests
npm run typecheck  # Run TypeScript check
npm run build      # Build production bundle to dist/
```
