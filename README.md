# AutoMotion Studio

Desktop app (Electron + bundled FFmpeg) for **automatic, music-synced editing of car videos** — macOS Big Sur 11+ (Intel x86_64), fully offline.

## Build the DMG on GitHub (no tools needed on your Mac)
1. Create a new GitHub repository and upload **all files of this project** (keep the folder structure, including the hidden `.github` folder).
2. Open the **Actions** tab → **Build AutoMotion Studio** → **Run workflow** (leave defaults) → wait for the green check.
3. Open the finished run → **Artifacts** → download **AutoMotion-Studio-Intel-DMG** (contains `AutoMotion-Studio-Intel.dmg`).
4. Open the DMG, drag the app to Applications. First launch: right-click → **Open** (app is not notarized). If macOS says "damaged": `xattr -cr "/Applications/AutoMotion Studio.app"`.

The workflow fails (no false success) if the DMG is missing, the app is not x86_64, or anything requires a newer macOS than 11.7.11. If it complains about the prebuilt FFmpeg's macOS version, re-run with **ffmpeg_source = build**.

## Using the app
1. **Import**: Moving / Parked / Music tabs → *Import…* (folder or files). Thumbnails and durations appear; ★ = favorite (picked more often), ✕ = excluded; double-click previews.
2. Pick the music in **Auto Edit**, then **AUTO EDIT**. Music is analysed once (cached). **CREATE NEW VARIATION** re-edits with a new seed without re-analysing.
3. Fine-tune on the timeline: drag, trim handles, **S** split, ⌫ delete, ⇧⌫ ripple delete, ⌘D duplicate, Replace, Crop, Snap to Beat, ⌘Z / ⇧⌘Z, zoom (⌘ + scroll), ←/→ frame step, Space play. **REGENERATE CLIP** swaps one clip only.
4. **Export** tab (or **FAST EXPORT**): MP4/MOV, H.264/H.265, 720p–4K, 24/25/30/60 fps, Fast / Balanced / Maximum.

## Speed design
Each cut is encoded once into a cached segment (parallel, VideoToolbox when it really works, else x264), then joined losslessly with the audio mix. Re-exporting, variations that reuse cuts, and regenerating one clip only encode what changed. Proxy files make preview smooth. No heavy effects.

## Layout
`src/main` Electron main · `src/ui` interface · `src/audio` analyzer · `src/timeline` model + auto-edit · `src/rendering` renderer · `src/media` ffmpeg/scan/proxy · `scripts` build/DMG/verify · `tests` automated tests (`npm test`).

## Testing status (honest)
Automated here (Linux): analyzer, auto-edit, timeline, full render pipeline with real FFmpeg, and the real Electron UI in a headless session. **Not tested on macOS Big Sur / Intel Iris Pro**: the macOS build, DMG, VideoToolbox, and real-world performance are verified only by the workflow's static checks (x86_64, minimum OS) — run it and try the DMG on your Mac.
