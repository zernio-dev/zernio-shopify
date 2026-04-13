# Demo video

Auto-generated App Store demo video. Final output: `video/out/demo.mp4`.

## How it works

1. `script.json` holds the scene list — each scene has an image asset, narration text, and a target duration.
2. `generate.mjs` produces per-scene MP3 narration, builds a Ken-Burns-style MP4 per scene with the narration as audio, then concatenates everything into `demo.mp4`.
3. All outputs go to `video/out/` (gitignored).

## Regenerate

```bash
node video/generate.mjs
```

The script reads from `.env`:

- If `ELEVENLABS_API_KEY` is set → uses ElevenLabs for narration (natural human voice).
- Otherwise → falls back to macOS `say` + Samantha. Works out of the box but sounds like macOS.

## To upgrade to the ElevenLabs voice

1. Grab a key from https://elevenlabs.io/app/settings/api-keys
2. Add to `.env`:

   ```
   ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxx
   ```

3. Delete the existing outputs so they get regenerated:

   ```bash
   rm -rf video/out/
   node video/generate.mjs
   ```

The voice ID in `script.json` (`EXAVITQu4vr4xnSDxMaL`) is Bella — a clear, friendly English female voice. Change to any voice ID from your ElevenLabs dashboard by editing `meta.voice_elevenlabs`.

## Tweak the script

Edit `script.json`. Each scene's `duration` is a minimum — the actual length adapts to the narration audio, so feel free to tighten or loosen text freely. Total target: under 5 min (Shopify's hard cap).

## Scene list

| # | Asset | Narration focus |
|---|---|---|
| 01 | `app-icon-1200.png` | Intro |
| 02 | `01-home.png` | Dashboard |
| 03 | `02-products.png` | Product grid + multi-select |
| 04 | `03-compose.png` | Composer + per-platform overrides |
| 05 | `04-bulk-schedule.png` | Bulk schedule timeline |
| 06 | `05-settings.png` | Auto-publish triggers + UTM |
| 07 | `app-icon-1200.png` | Closing CTA |
