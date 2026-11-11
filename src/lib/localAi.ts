import { env, pipeline, RawImage } from "@huggingface/transformers";
import { invoke } from "@tauri-apps/api/core";
import type { CaptionSegment, Transcription } from "./media";
import { configureLocalModels, isStrictOffline, offlineModelFileUrl } from "./offlineModels";

export interface ModelProgress {
  status: string;
  progress?: number;
  file?: string;
  name?: string;
}

type ProgressHandler = (progress: ModelProgress) => void;
type PipelineFn = (...args: any[]) => Promise<any>;

const loaded = new Map<string, Promise<PipelineFn>>();

env.useBrowserCache = true;

function getPipeline(task: string, model: string, onProgress?: ProgressHandler, dtype: "q8" | "fp32" = "q8") {
  const key = `${task}:${model}:${dtype}`;
  let instance = loaded.get(key);
  if (!instance) {
    const createPipeline = pipeline as unknown as (
      taskName: string,
      modelName: string,
      options: Record<string, unknown>,
    ) => Promise<PipelineFn>;
    instance = configureLocalModels(env).then(() => createPipeline(task, model, {
      dtype,
      progress_callback: (info: ModelProgress) => onProgress?.(info),
    }));
    loaded.set(key, instance);
    instance.catch(() => loaded.delete(key));
  }
  return instance;
}

export async function transcribeLocally(path: string, model: string, language: string, onProgress?: ProgressHandler): Promise<Transcription> {
  const file = await invoke<{ name: string; mimeType: string; dataBase64: string }>("read_media_for_ai", { path });
  const binary = atob(file.dataBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const source = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  try {
    const asr = await getPipeline("automatic-speech-recognition", model, onProgress);
    const result = await asr(source, { language, return_timestamps: true });
    const segments: CaptionSegment[] = (result.chunks ?? [])
      .filter((chunk: { text?: string; timestamp?: [number | null, number | null] }) => chunk.text?.trim())
      .map((chunk: { text: string; timestamp: [number | null, number | null] }) => ({
        text: chunk.text.trim(), start: Math.max(0, chunk.timestamp[0] ?? 0), end: Math.max(0.1, chunk.timestamp[1] ?? (chunk.timestamp[0] ?? 0) + 1),
      }));
    return { text: result.text ?? "", segments };
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function synthesizeLocally(text: string, model: string, voice: string, onProgress?: ProgressHandler): Promise<string> {
  const usesSupertonic = model === "onnx-community/Supertonic-TTS-ONNX";
  const tts = await getPipeline("text-to-speech", model, onProgress, usesSupertonic ? "fp32" : "q8");
  onProgress?.({ status: "inference", file: "Generating speech" });
  const options = usesSupertonic
    ? {
        speaker_embeddings: isStrictOffline()
          ? offlineModelFileUrl(model, `voices/${encodeURIComponent(voice)}.bin`)
          : `https://huggingface.co/${model}/resolve/main/voices/${encodeURIComponent(voice)}.bin`,
        num_inference_steps: 5,
        speed: 1.0,
      }
    : {};
  const audio = await tts(text, options);
  onProgress?.({ status: "saving", file: "Saving generated audio" });
  const wavBlob = await audio.toBlob() as Blob;
  const wav = new Uint8Array(await wavBlob.arrayBuffer());
  let binary = "";
  for (let start = 0; start < wav.length; start += 0x8000) binary += String.fromCharCode(...wav.subarray(start, start + 0x8000));
  return invoke<string>("save_ai_audio", { dataBase64: btoa(binary) });
}

export async function removeImageBackground(image: Blob, model: string, onProgress?: ProgressHandler): Promise<Blob> {
  const remover = await getPipeline("background-removal", model, onProgress, "fp32");
  const original = await RawImage.fromBlob(image);
  const result = await remover(await original.toCanvas());
  const mask = (Array.isArray(result) ? result[0] : result) as RawImage;
  const rgba = original.rgba();
  const resizedMask = await mask.resize(rgba.width, rgba.height);
  const maskData = resizedMask.data;
  const channels = resizedMask.channels;
  for (let pixel = 0; pixel < rgba.width * rgba.height; pixel += 1) {
    const destination = pixel * 4 + 3;
    const source = pixel * channels;
    const alpha = channels === 4 ? maskData[source + 3] : maskData[source];
    rgba.data[destination] = alpha;
  }
  return rgba.toBlob("image/png");
}

export async function saveLocalImage(image: Blob): Promise<string> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return invoke<string>("save_ai_image", { dataBase64: btoa(binary) });
}
