/**
 * OpenCV.js, loaded on demand (docs/19). The library is a 13 MB chunk (WebAssembly inlined), so it is
 * never part of the console's start-up bundle: the first "Read cards" click fetches it, and the
 * promise is kept so later readings are instant. Everything runs in this browser; no frame leaves it.
 */
export type CV = typeof import('@techstark/opencv-js');

let loading: Promise<CV> | null = null;

export function loadCv(): Promise<CV> {
  loading ??= import('@techstark/opencv-js').then(async (m) => {
    // The module is a promise in some builds, an object that fires onRuntimeInitialized in others.
    const mod = (m as { default?: unknown }).default ?? m;
    if (mod instanceof Promise) return (await mod) as CV;
    const cv = mod as CV & { onRuntimeInitialized?: () => void; Mat?: unknown };
    if (cv.Mat) return cv;
    await new Promise<void>((resolve) => { cv.onRuntimeInitialized = () => resolve(); });
    return cv;
  }).catch((e) => { loading = null; throw e; });
  return loading;
}
