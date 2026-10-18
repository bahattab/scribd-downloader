# Changelog

## 0.5.0

- Rename the product to Free Scribd Downloader.
- Add frozen desktop and worker entry points; bundle Node, Python dependencies, Chrome and matching ChromeDriver.
- Add Windows per-user Setup with a dedicated installation folder, Start menu shortcut, optional desktop shortcut and uninstaller.
- Add separate target-OS builds and local bundle/browser/PDF smoke checks.
- Keep batch downloads, original Arabic titles, collision-safe saving and cancellation.
- Add explicit privacy exclusions, release checksums and source documentation.

Build releases use `v0.5.0-build.<run number>` so every published build has a distinct identifier. Binary availability and supported targets must be read from the actual successful release assets, not inferred from this file.
