# Prompt Waypoint app icon

`app-icon.png` is the opaque square master shared by desktop, mobile and web.
The mark combines stacked task cards and a forward/run symbol. The original
artwork was generated on 2026-09-09 and recolored with the built-in imagegen
tool on 2026-09-16, preserving its silhouette. The current palette is royal
blue, white and sky blue, matching the white-and-blue application theme.

## Final edit prompt

> Edit target: the attached existing Prompt Waypoint app icon. Perform a
> color-only rebrand to blue and white. Preserve the exact stacked task-card /
> forward-arrow silhouette, geometry, layout, perspective, sizes, spacing,
> rounded shape corners and generous margins. Replace the forest-green
> background with saturated royal blue close to #2563EB, replace warm ivory
> symbol areas with clean white #FFFFFF, and replace the sage middle card with
> soft sky blue #93C5FD. Keep the artwork crisp and polished, with at most the
> existing subtle depth. Full bleed square opaque image, 1024x1024 or larger, no
> outer rounded app-icon mask. No green, no teal, no cream, no text, no new
> elements, no mockup. This is the production icon bitmap for a white-and-blue
> software interface.

## Derived assets

Generate platform sizes with Tauri's icon tooling from this master. Desktop
icons live in `apps/desktop/src-tauri/icons/`, mobile icons in
`apps/mobile/src-tauri/icons/`, and Android launcher icons in its generated
project's `app/src/main/res/mipmap-*` directories. The web uses a 1024px
`apps/server/static/marketing/icon.png` and an 80px `brand.png`.

Canonical iOS PNGs in `src-tauri/icons/ios/` must be RGB without an alpha
channel, including the App Store icon. After generating sizes, remove the opaque
alpha channel, run `deno task ios:icons:sync` from `apps/mobile`, and verify
with `deno task ios:check`. The sync task restores the canonical icons into the
generated Xcode asset catalog.
