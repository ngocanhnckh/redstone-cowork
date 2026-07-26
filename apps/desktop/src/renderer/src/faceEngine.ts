// On-device face recognition for the YITEC login. Uses @vladmandic/face-api
// (TF.js) with model weights bundled under public/face-models (served over the
// app:// origin). Everything runs in the renderer — camera frames and photos never
// leave the machine; only the resulting 128-float descriptor is sent to the server.

import * as faceapi from "@vladmandic/face-api";

const MODEL_URL = "/face-models"; // dev: localhost:5173/face-models · packaged: app://bundle/face-models
let loading: Promise<void> | null = null;
let ready = false;

/** Load the detector + landmarks + recognition nets once (idempotent). */
export function loadFaceModels(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      // Force the WebGL backend: TF.js otherwise prefers WASM, whose .wasm binaries
      // we don't bundle (and WebGL is always available in the Electron renderer).
      const tf = faceapi.tf as unknown as { setBackend(b: string): Promise<boolean>; ready(): Promise<void> };
      try {
        await tf.setBackend("webgl");
      } catch {
        await tf.setBackend("cpu"); // last-resort fallback
      }
      await tf.ready();
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      ready = true;
    })().catch((e) => {
      loading = null; // allow a retry
      throw e;
    });
  }
  return loading;
}

export function faceModelsReady(): boolean {
  return ready;
}

const OPTS = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

/** Compute a 128-float descriptor for the single most prominent face in the source,
 *  or null if no face is detected. Accepts a <video>, <img>, or <canvas>. */
export async function describeFace(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<number[] | null> {
  await loadFaceModels();
  const det = await faceapi.detectSingleFace(source, OPTS).withFaceLandmarks().withFaceDescriptor();
  return det ? Array.from(det.descriptor) : null;
}

export type FaceBox = { x: number; y: number; width: number; height: number };

/** Like describeFace, but also returns the detection's bounding box (in SOURCE pixel
 *  coordinates) so the caller can crop a face snapshot from the same frame — used by the
 *  lock screen to show the just-captured face in the identification sequence. */
export async function describeFaceWithBox(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<{ descriptor: number[]; box: FaceBox } | null> {
  await loadFaceModels();
  const det = await faceapi.detectSingleFace(source, OPTS).withFaceLandmarks().withFaceDescriptor();
  if (!det) return null;
  const b = det.detection.box;
  return { descriptor: Array.from(det.descriptor), box: { x: b.x, y: b.y, width: b.width, height: b.height } };
}

/** Descriptor from a data-URL / URL image (used for admin roster-photo enrollment). */
export async function describeFaceFromImageUrl(url: string): Promise<number[] | null> {
  const img = await faceapi.fetchImage(url);
  return describeFace(img as unknown as HTMLImageElement);
}
