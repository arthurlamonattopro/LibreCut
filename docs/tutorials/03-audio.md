# 3. Mix the audio

This lesson covers levels, panning, equalisation, dynamics, ducking, volume
automation, and the two AI tools that produce audio.

## Get the audio onto a track

Music and voice-over files appear in the **Audio** tab of the media panel,
with a waveform and a duration. Click one to place it on the timeline at the
playhead, or drag it onto an audio track.

A video file carries its own sound. To work with that sound on its own, select
the video clip and press **Extract audio to timeline** in the inspector. It
appears as a new audio clip you can trim, move, and level separately.

Tracks are **mixed**, not layered: every audible clip on every track is summed
together. To make one clip sit on top of another, raise the one you want to
hear and lower the level of the other, or mute the track it is on.

## Set the level

Select a clip and open the **Audio** tab of the inspector.

| Control | What it does | Range |
| --- | --- | --- |
| **Clip volume** | The level of this clip | 0 – 200% |
| **Track volume** | The level of the whole track | 0 – 200% |
| **Pan** | Places the clip left or right in the stereo field | hard left – hard right |
| **Pitch** | Shifts the pitch without changing the speed | −12 – +12 semitones |

The clip level and the track level multiply. A clip at 50% on a track at 50%
comes out at 25%.

**Pan** reads as `Center` in the middle, and as `30% left` or `30% right` at
the edges.

To silence a track without changing the mix, press the mute button in the
track header. A muted track stays in the export but contributes no sound.

## Equalise

The **Equalizer** section has three bands. Each band has a gain and a
frequency, and the middle band also has a width.

| Control | Range |
| --- | --- |
| **Low gain** / **Low frequency** | −12 – +12 dB / 40 – 1000 Hz |
| **Mid gain** / **Mid frequency** / **Mid width** | −24 – +24 dB / 100 – 8000 Hz / 0.25 – 4 octaves |
| **High gain** / **High frequency** | −12 – +12 dB / 2000 – 16000 Hz |

A common starting point for dialogue mixed under music: **Low gain** `+2`,
**Mid gain** `+3` at `1000 Hz`, **High gain** `−2`.

## Compress

The **Dynamics** section is a compressor.

- **Enable compressor** turns it on.
- **Threshold** is the level in dB above which the compressor starts to work.
  The default is `−18`.
- **Ratio** is how hard it squeezes. `4:1` is a gentle, natural setting.
- **Attack** and **Release** are in milliseconds. `12 ms` and `180 ms` are the
  defaults.

Compress the dialogue, not the music. It evens out the level so the mix does
not jump around.

## Fade the edges

The **Fades** section has **Fade in** and **Fade out**, in seconds. A fade in
of `0.5` brings the clip up from silence over half a second.

For a longer, shaped change, use **Automation** instead:

- **Volume fade in** and **Volume fade out** fade the clip over up to a
  second.
- **Volume ramp up** and **Volume ramp down** move the level between 40% and
  160%.
- **Clear** removes the volume keyframes from the clip.

Volume automation is drawn on the timeline as a line across the clip. It is
applied in the preview and in the exported file.

## Duck the music

Ducking turns a track down while something else is playing, and brings it
back afterwards. It is a **track** setting, not a clip setting.

1. Open the **Audio** tab of the inspector with any clip on that track
   selected.
2. Turn on **Duck this track under other audio**.
3. Set the amount, the trigger threshold, the attack, and the release.

| Control | Range | Meaning |
| --- | --- | --- |
| **Duck amount** | 0 – 24 dB | How far the track drops |
| **Trigger threshold** | −60 – 0 dB | How loud the other audio has to be |
| **Attack** | 0.01 – 2 s | How fast the track drops |
| **Release** | 0.05 – 5 s | How fast it comes back |

Put your voice-over on an audio track, turn ducking on for the **music**
track, and the music steps back under the voice.

## Generate speech with AI

Open **AI tools** in the top bar, or the **Text to speech** button in the
**Text** tab.

The **Local · private** tab runs on your own computer.

1. Pick a **Language**: English, Spanish, Portuguese, or French.
2. Pick a **Local speech model**:
   - `MMS · follows selected language · recommended` — a voice for the
     language you chose.
   - `Supertonic · English · multiple voices` — four English voices
     (`Female 1`, `Female 2`, `Male 1`, `Male 2`). It is only available for
     English.
   - `Custom Hugging Face model…` — any compatible repository.
3. Type the text into the **Text** box.
4. Press **Generate locally**.

The speech is written to your computer and added to the timeline as an audio
clip, ready to trim and level like any other.

The first run downloads the model. Turn on **Strict offline** and install the
model bundles with `pnpm fetch:models` if you want to work without a network
connection.

## Transcribe speech into captions

In **AI tools**, open the **Local · private** tab and press **Captions**.

1. Choose a **Transcription source**: `Selected timeline video` (pick a video
   clip first) or `Imported media`.
2. Choose a **Language**.
3. Choose a **Local transcription model**: `Whisper Small · multilingual ·
   recommended`, `Whisper Base · smaller download`, or `Whisper Tiny · fastest
   setup`.
4. Press **Transcribe locally**.

Every timed segment becomes an editable caption clip on the timeline. Lesson 4
shows how to style them.

## Use a cloud provider instead

The **Cloud · BYOK** tab sends the audio or the text to an endpoint you
supply. Fill in **Provider endpoint**, **API key**, and the model, then press
**Transcribe with cloud** or **Generate with cloud**.

Two things to know:

- The endpoint must use HTTPS, unless it is `localhost` or `127.0.0.1`.
- The API key is kept in memory for the session only. It is never written to
  the project and never saved. You retype it after a restart.

## What the export does to your mix

- Audio is mixed to a single stereo track at 48 kHz.
- The export dialog offers AAC at 96, 128, 192, 256, or 320 kbps and ALAC
  (lossless), at 44.1, 48, or 96 kHz. The default is AAC, 192 kbps, 48 kHz.
- Speed changes keep the pitch steady on ordinary clips.
- A speed ramp retimes the picture continuously. The audio side uses up to 600
  segments, targeting twenty milliseconds and one percent of speed, instead of
  the coarser steps the earlier 120-segment approximation produced.

## Try this

Import a music file and a video with speech in it. Put the video on a video
track, extract its audio onto an audio track, and turn ducking on for the
music. Add a 0.5 second fade in on the music, compress the voice-over, and
lower the music track to 60%.

## Gotchas

- **A muted track is silent in the preview and in the export.** That is what
  mute means. If you can hear a track that you muted, check that you muted the
  track and not just the clip.
- **Pitch and speed are different.** Changing **Pitch** shifts the pitch and
  keeps the duration. Changing **Speed** changes the duration and keeps the
  pitch.
- **Ducking follows the other audible tracks, not a specific clip.** It
  reacts to whatever else is playing above the threshold. To duck under one
  voice, keep that voice alone above the threshold.
- **AI models download on first use.** "Local" means the model runs on your
  machine, not that it is already installed.
- **The **Offline model bundles** counter only sees the models folder**, not
  the download cache. It can say `No models installed yet` even after a model
  has been downloaded.
- **Background removal does not work on video.** It handles images only; for
  video, use the chroma key controls under **Masks**.

Next: [4. Add titles and captions](04-titles-and-captions.md).
