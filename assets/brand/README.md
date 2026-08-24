# Paperlight — brand assets (monogram mark, option 1b)

Production-ready logo files for the Paperlight PDF editor. Drop this folder into your repo (e.g. `assets/brand/`) and point your build at the files below.

## Files

```
icon/
  paperlight.ico                    ← Windows app icon: 16, 24, 32, 48, 64, 128, 256 px in one file
  png/paperlight-icon-{16,20,24,32,48,64,128,256}.png   purple tile + white mark, square
  png/paperlight-mark-256-lilac.png     mark only, #B49BF0, transparent  (for dark UI)
  png/paperlight-mark-256-purple.png    mark only, #6B43D6, transparent  (for light UI)
  png/paperlight-mark-256-white.png     mark only, white, transparent    (on accent fills)
svg/
  paperlight-icon-tile.svg          app icon, vector (64×64, radius 14.5)
  paperlight-icon-tile-small.svg     ↑ bolder strokes — use when rendering ≤24 px
  paperlight-mark-lilac.svg         mark for dark UI
  paperlight-mark-purple.svg        mark for light UI
  paperlight-mark-white.svg         knockout on accent / photos
  paperlight-mark-ink.svg           single-colour #0F0E14
  paperlight-mark-currentcolor.svg  inherits surrounding text colour (best for in-app use)
  paperlight-lockup-dark-ui.svg     mark + "Paperlight" wordmark, for dark backgrounds
  paperlight-lockup-light-ui.svg    mark + wordmark, for light backgrounds
```

## Geometry (single source of truth)

The mark is two shapes on a 64×64 box — a rounded stem plus a half-ring bowl:

```svg
<rect x="14" y="10" width="9" height="44" rx="4.5" fill="COLOR"/>
<path d="M23 14.5h11a13 13 0 010 26H23"
      stroke="COLOR" stroke-width="9" stroke-linecap="round" fill="none"/>
```

Small-size variant (≤24 px — stem 10 wide, stroke 10 so it survives rasterisation):

```svg
<rect x="14" y="10" width="10" height="44" rx="5" fill="COLOR"/>
<path d="M24 15h10a13 13 0 010 26H24"
      stroke="COLOR" stroke-width="10" stroke-linecap="round" fill="none"/>
```

App-icon tile: `<rect width="64" height="64" rx="14.5" fill="#6B43D6"/>` with the mark in white.

## Colours

| Use | Hex |
|---|---|
| Mark on dark UI | `#B49BF0` |
| Mark on light UI / print | `#6B43D6` |
| App-icon tile fill | `#6B43D6` |
| Mark inside tile | `#FFFFFF` |
| Single-colour / ink | `#0F0E14` |

Alternate accents (if you ship the accent preference from the UI spec): orchid `#D79BEF` dark / `#A233C9` light; periwinkle `#9AA8F5` dark / `#4A53CF` light. The tile fill stays `#6B43D6` regardless — the taskbar icon should not change with in-app theme.

## Wordmark

`Paperlight` set in **Manrope Bold (700)**, `letter-spacing: -0.03em`, with `light` in the accent colour and `Paper` in the primary text colour. Manrope is free (SIL OFL) — bundle it, or fall back to `Segoe UI Variable Display Semibold` if you don't want a font dependency. The lockup SVGs use `<text>`, so convert them to outlines if Manrope won't be installed on the target machine.

Clear space around the lockup = the height of the mark's stem cap (≈ 25% of mark height). Minimum sizes: mark 16 px, lockup 100 px wide.

## Wiring it up

**Executable + window icon (any Windows toolchain)** — use `icon/paperlight.ico`.

```
// .NET / WPF / WinUI  (.csproj)
<ApplicationIcon>assets/brand/icon/paperlight.ico</ApplicationIcon>

// Qt (CMake, Windows resource)
// app.rc:  IDI_ICON1 ICON "assets/brand/icon/paperlight.ico"
// then add app.rc to your target sources

// PyInstaller
pyinstaller --icon assets/brand/icon/paperlight.ico main.py

// Electron / Tauri
"icon": "assets/brand/icon/paperlight.ico"          // electron-builder win.icon
"icon": ["assets/brand/icon/paperlight.ico"]        // tauri.conf.json bundle.icon
```

**In-app title bar (22 px mark next to the product name)** — use `paperlight-mark-currentcolor.svg` and colour it with the accent token so it follows the dark/light theme:

```xml
<!-- WPF / WinUI -->
<Image Source="ms-appx:///assets/brand/svg/paperlight-mark-lilac.svg" Width="22" Height="22"/>
```

```python
# Qt
icon = QIcon("assets/brand/svg/paperlight-mark-lilac.svg")   # dark theme
label.setPixmap(icon.pixmap(22, 22))
```

```html
<!-- HTML/Electron: recolours with the theme automatically -->
<span style="color: var(--accent); display: inline-flex">
  <svg width="22" height="22" viewBox="0 0 64 64" fill="none">
    <rect x="14" y="10" width="9" height="44" rx="4.5" fill="currentColor"/>
    <path d="M23 14.5h11a13 13 0 010 26H23" stroke="currentColor" stroke-width="9" stroke-linecap="round" fill="none"/>
  </svg>
</span>
```

**Installer / Start menu / file association** — `paperlight.ico` for the shortcut; for a `.pdf` document-type icon, use the tile at 256 px (`png/paperlight-icon-256.png`) or generate a second `.ico` from `svg/paperlight-icon-tile.svg` with a page-shaped background if you want it visually distinct from the app icon.

**Splash / about box** — `svg/paperlight-lockup-dark-ui.svg` (or the light variant) at 228×40 or any multiple.

## Notes for whoever implements this

- Replace the placeholder `P` tile in the UI spec (`design_handoff_pdf_editor/README.md`, title-bar section) with the 22 px mark.
- Never re-draw the mark by hand or restyle the strokes — scale the SVG. If you need a size below 24 px, switch to the small-size variant rather than shrinking the standard one.
- Don't add gradients, shadows, or outlines to the mark. Flat fill only.
