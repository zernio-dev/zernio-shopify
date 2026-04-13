/**
 * Build the App Store demo video from the scripted narration and the
 * existing screenshot assets.
 *
 *   1. Per scene, produce an MP3 of the narration.
 *        - If ELEVENLABS_API_KEY is set in .env, use ElevenLabs
 *          (higher quality, natural voice)
 *        - Otherwise fall back to macOS `say` + Samantha so there's
 *          always a working artifact
 *   2. Per scene, build a short mp4: the screenshot as a still for the
 *      narration's duration, plus a gentle Ken Burns zoom, with the
 *      narration on the audio track.
 *   3. Concatenate every scene mp4 into `demo.mp4`.
 *
 * Output: video/out/demo.mp4
 */
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// -- env --------------------------------------------------------------
const env = {};
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const ELEVEN_KEY = env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;

// -- read script ------------------------------------------------------
const script = JSON.parse(readFileSync('video/script.json', 'utf8'));
const OUT_DIR = 'video/out';
mkdirSync(OUT_DIR, { recursive: true });

const VOICE_ENGINE = ELEVEN_KEY ? 'elevenlabs' : 'macos-say';
console.log(`Voice engine: ${VOICE_ENGINE}`);
console.log(`Scenes: ${script.scenes.length}`);

// -- 1. Per-scene audio ------------------------------------------------
for (const scene of script.scenes) {
  const audioPath = `${OUT_DIR}/${scene.id}.mp3`;
  if (existsSync(audioPath)) {
    console.log(`  [skip] ${scene.id} audio exists`);
    continue;
  }
  console.log(`  [audio] ${scene.id}`);

  if (ELEVEN_KEY) {
    // ElevenLabs REST — returns audio/mpeg
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${script.meta.voice_elevenlabs}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVEN_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: scene.narration,
          model_id: script.meta.model_elevenlabs,
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      },
    );
    if (!r.ok) {
      console.error(`    ElevenLabs error ${r.status}: ${(await r.text()).slice(0, 200)}`);
      process.exit(1);
    }
    writeFileSync(audioPath, Buffer.from(await r.arrayBuffer()));
  } else {
    // macOS fallback. `say` → aiff (default format) → ffmpeg → mp3
    const aiff = `${OUT_DIR}/${scene.id}.aiff`;
    execSync(
      `say -v "${script.meta.voice_macos}" -r ${script.meta.rate_macos} -o "${aiff}" ${JSON.stringify(scene.narration)}`,
      { stdio: 'inherit' },
    );
    execSync(`ffmpeg -y -loglevel error -i "${aiff}" -c:a libmp3lame -b:a 128k "${audioPath}"`);
    execSync(`rm "${aiff}"`);
  }
}

// -- 2. Per-scene video: ken burns still + narration ------------------
// All scenes are normalized to 1920x1080 (1080p). Screenshots at other
// sizes get centered on a cream background matching the app's brand.
for (const scene of script.scenes) {
  const videoPath = `${OUT_DIR}/${scene.id}.mp4`;
  if (existsSync(videoPath)) {
    console.log(`  [skip] ${scene.id} video exists`);
    continue;
  }
  console.log(`  [video] ${scene.id}`);

  const audioPath = `${OUT_DIR}/${scene.id}.mp3`;

  // Read actual audio duration (narration might be a bit longer or
  // shorter than the script's `duration` hint). Always pad by 0.3s on
  // the tail so the voice doesn't clip.
  const durJson = execSync(
    `ffprobe -v error -show_entries format=duration -of json "${audioPath}"`,
    { encoding: 'utf8' },
  );
  const audioSec = parseFloat(JSON.parse(durJson).format.duration) + 0.3;
  const duration = Math.max(audioSec, scene.duration);

  // Ken Burns: slow zoom from 1.0 → 1.08 over the scene length.
  // fps=25; zoompan applies per-frame so d = duration * fps.
  const fps = 25;
  const frames = Math.round(duration * fps);

  // Centered scale+pad to 1920x1080 on cream background (#F0EFEB) so
  // screenshots of any aspect ratio look intentional.
  const vf = [
    `scale=1920:1080:force_original_aspect_ratio=decrease`,
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:0xF0EFEB`,
    `zoompan=z='min(zoom+0.0004,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${fps}`,
    `format=yuv420p`,
  ].join(',');

  execSync(
    `ffmpeg -y -loglevel error -loop 1 -i "${scene.asset}" -i "${audioPath}" ` +
      `-vf "${vf}" ` +
      `-c:v libx264 -preset medium -crf 20 -r ${fps} -pix_fmt yuv420p ` +
      `-c:a aac -b:a 160k ` +
      `-t ${duration} -shortest "${videoPath}"`,
    { stdio: 'inherit' },
  );
}

// -- 3. Concatenate scenes --------------------------------------------
const concatList = `${OUT_DIR}/concat.txt`;
writeFileSync(
  concatList,
  script.scenes.map((s) => `file '${s.id}.mp4'`).join('\n'),
);
console.log('[concat] merging all scenes');
execSync(
  `ffmpeg -y -loglevel error -f concat -safe 0 -i "${concatList}" -c copy "${OUT_DIR}/demo.mp4"`,
  { stdio: 'inherit' },
);

// Final sanity: total duration
const totalJson = execSync(
  `ffprobe -v error -show_entries format=duration -of json "${OUT_DIR}/demo.mp4"`,
  { encoding: 'utf8' },
);
const totalSec = parseFloat(JSON.parse(totalJson).format.duration);
console.log(
  `\n✓ video/out/demo.mp4 (${Math.floor(totalSec / 60)}m${String(Math.round(totalSec % 60)).padStart(2, '0')}s) — voice=${VOICE_ENGINE}`,
);
