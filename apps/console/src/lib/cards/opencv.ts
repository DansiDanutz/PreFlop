import { GLYPH_FONT, GLYPH_TEXT } from './vision.ts';

/**
 * OpenCV.js, loaded on demand (docs/19). The library is a 13 MB chunk (WebAssembly inlined), so it is
 * never part of the console's start-up bundle: the first "Read cards" click fetches it, and the
 * promise is kept so later readings are instant. Everything runs in this browser; no frame leaves it.
 */
export type CV = typeof import('@techstark/opencv-js');

let loading: Promise<CV> | null = null;

/**
 * Waits for the glyph-template fonts. A canvas does not wait for a web font: drawn before the file
 * has arrived, the templates would silently use a system font and be kept for the whole session.
 * A missing DejaVu face (its stylesheet not imported) is an error, never a quiet fallback.
 */
async function loadGlyphFonts(): Promise<void> {
  const faces = await document.fonts.load(GLYPH_FONT, GLYPH_TEXT);
  if (!faces.some((f) => f.family.replace(/["']/g, '') === 'DejaVu Sans')) throw new Error('the card suit font (DejaVu Sans) is not available');
}

/** OpenCV.js and the fonts the reader's templates are drawn with: everything readCards needs. */
export function loadCv(): Promise<CV> {
  loading ??= Promise.all([import('@techstark/opencv-js'), loadGlyphFonts()]).then(async ([m]) => {
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
