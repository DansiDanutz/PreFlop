import type { CV } from './opencv.ts';
import {
  type CardGuess, type Point, type Reading, RANK_GLYPHS, SUIT_GLYPHS, bestMatch, cardLike, indexBands, inkRuns, isRedInk,
  orderCorners, pickFlop, portraitCorners,
} from './vision.ts';

/**
 * Reads the cards in a frame with OpenCV.js (docs/19). Classic computer vision, no model and no
 * service: (1) the bright card faces are separated from the felt (Otsu threshold) and their outlines
 * reduced to convex quadrilaterals of card proportions; (2) each card is straightened to 200 × 300;
 * (3) its corner index — the rank glyph above the suit pip — is cut into the two ink bands and each is
 * compared with glyphs rendered here in the browser (normalised correlation); the suit's colour decides
 * red or black first. Both opposite corners are tried, so an upside-down card reads the same.
 *
 * Every cv.Mat is freed: OpenCV.js does not garbage-collect them.
 */

const CARD_W = 200, CARD_H = 300;
/** The index corner of the straightened card: the rank and pip of a poker-size card fit in it. */
const CORNER_W = 64, CORNER_H = 130;
const RANK_SIZE = { w: 32, h: 48 }, SUIT_SIZE = { w: 32, h: 32 };

type Mat = InstanceType<CV['Mat']>;

interface Templates { rank: { code: string; mat: Mat }[]; suit: { code: string; red: boolean; mat: Mat }[] }
let templates: Templates | null = null;

/** Glyph templates drawn with the browser's own bold sans-serif, binarised and cut to their ink. */
function glyphTemplates(cv: CV): Templates {
  if (templates) return templates;
  const draw = (text: string, w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.font = 'bold 120px "Inter", "Helvetica Neue", Arial, sans-serif';
    g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(text, c.width / 2, c.height / 2);
    const rgba = cv.imread(c);
    const gray = new cv.Mat(); cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const bin = new cv.Mat(); cv.threshold(gray, bin, 128, 255, cv.THRESH_BINARY_INV);
    const cut = inkBox(cv, bin);
    const out = new cv.Mat();
    cv.resize(cut, out, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    for (const m of [rgba, gray, bin, cut]) m.delete();
    return out;
  };
  templates = {
    rank: RANK_GLYPHS.map((r) => ({ code: r.code, mat: draw(r.glyph, RANK_SIZE.w, RANK_SIZE.h) })),
    suit: SUIT_GLYPHS.map((s) => ({ code: s.code, red: s.red, mat: draw(s.glyph, SUIT_SIZE.w, SUIT_SIZE.h) })),
  };
  return templates;
}

/** Row and column sums of a binary (0/255) single-channel image. */
function projections(bin: Mat): { rows: number[]; cols: number[] } {
  const rows = new Array<number>(bin.rows).fill(0), cols = new Array<number>(bin.cols).fill(0);
  const d = bin.data;
  for (let y = 0; y < bin.rows; y++) for (let x = 0; x < bin.cols; x++) if (d[y * bin.cols + x]) { rows[y]!++; cols[x]!++; }
  return { rows, cols };
}

/** The ink's bounding box of a binary image, as a new Mat (a copy); the whole image when there is no ink. */
function inkBox(cv: CV, bin: Mat): Mat {
  const { rows, cols } = projections(bin);
  const r = inkRuns(rows, 1), c = inkRuns(cols, 1);
  if (!r.length || !c.length) return bin.clone();
  const y0 = r[0]![0], y1 = r[r.length - 1]![1], x0 = c[0]![0], x1 = c[c.length - 1]![1];
  return bin.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0)).clone();
}

/** Normalised correlation of two equal-size binary images (−1..1). */
function correlate(cv: CV, a: Mat, b: Mat): number {
  const res = new cv.Mat();
  cv.matchTemplate(a, b, res, cv.TM_CCOEFF_NORMED);
  const v = res.data32F[0] ?? -1;
  res.delete();
  return v;
}

/** Reads the index in one corner of a straightened card: the rank and suit codes with their scores. */
function readCorner(cv: CV, card: Mat, t: Templates): { rank: string; suit: string; score: number } | null {
  const corner = card.roi(new cv.Rect(0, 0, CORNER_W, CORNER_H));
  const gray = new cv.Mat(); cv.cvtColor(corner, gray, cv.COLOR_RGBA2GRAY);
  const bin = new cv.Mat(); cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  const mats: Mat[] = [corner, gray, bin];
  try {
    // Ink touching the corner's border is the card's edge or a neighbour, not the index: clear a margin.
    cv.rectangle(bin, new cv.Point(0, 0), new cv.Point(bin.cols - 1, bin.rows - 1), new cv.Scalar(0), 3);
    const bands = indexBands(inkRuns(projections(bin).rows, 4, 1));
    if (!bands) return null;
    const cut = (band: [number, number], size: { w: number; h: number }) => {
      const strip = bin.roi(new cv.Rect(0, band[0], bin.cols, band[1] - band[0]));
      const box = inkBox(cv, strip);
      const out = new cv.Mat(); cv.resize(box, out, new cv.Size(size.w, size.h), 0, 0, cv.INTER_AREA);
      cv.threshold(out, out, 100, 255, cv.THRESH_BINARY);
      mats.push(strip, box, out);
      return { strip, out };
    };
    const rank = cut(bands.rank, RANK_SIZE), suit = cut(bands.suit, SUIT_SIZE);
    // Colour of the pip: the mean of the corner's pixels under the suit band's ink.
    const suitRgba = corner.roi(new cv.Rect(0, bands.suit[0], corner.cols, bands.suit[1] - bands.suit[0]));
    mats.push(suitRgba);
    const mean = cv.mean(suitRgba, suit.strip);
    const red = isRedInk({ r: mean[0] ?? 0, g: mean[1] ?? 0, b: mean[2] ?? 0 });
    const r = bestMatch(t.rank.map((x) => ({ template: x, score: correlate(cv, rank.out, x.mat) })));
    const s = bestMatch(t.suit.filter((x) => x.red === red).map((x) => ({ template: x, score: correlate(cv, suit.out, x.mat) })));
    if (!r || !s) return null;
    return { rank: r.template.code, suit: s.template.code, score: Math.max(0, Math.min(r.score, s.score)) };
  } finally {
    for (const m of mats) m.delete();
  }
}

/** The card quadrilaterals in the frame (image coordinates), largest first. */
function findCards(cv: CV, rgba: Mat): [Point, Point, Point, Point][] {
  const gray = new cv.Mat(), blur = new cv.Mat(), bin = new cv.Mat();
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  const found: { corners: [Point, Point, Point, Point]; area: number }[] = [];
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const frameArea = rgba.rows * rgba.cols;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const approx = new cv.Mat();
      try {
        const area = cv.contourArea(c);
        if (area < frameArea * 0.004 || area > frameArea * 0.6) continue;
        cv.approxPolyDP(c, approx, 0.03 * cv.arcLength(c, true), true);
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
        const pts: Point[] = [];
        for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[k * 2]!, y: approx.data32S[k * 2 + 1]! });
        const corners = orderCorners(pts);
        if (cardLike(corners)) found.push({ corners, area });
      } finally {
        c.delete(); approx.delete();
      }
    }
  } finally {
    for (const m of [gray, blur, bin, hierarchy]) m.delete();
    contours.delete();
  }
  return found.sort((a, b) => b.area - a.area).map((f) => f.corners);
}

/** Straightens one card to CARD_W × CARD_H (portrait). */
function straighten(cv: CV, rgba: Mat, corners: readonly [Point, Point, Point, Point]): Mat {
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap((p) => [p.x, p.y]));
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, CARD_W, 0, CARD_W, CARD_H, 0, CARD_H]);
  const m = cv.getPerspectiveTransform(src, dst);
  const out = new cv.Mat();
  cv.warpPerspective(rgba, out, m, new cv.Size(CARD_W, CARD_H), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
  for (const x of [src, dst, m]) x.delete();
  return out;
}

/** Reads every card in the frame drawn on `source` (a canvas, image or video element). */
export function readCards(cv: CV, source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): Reading {
  const started = performance.now();
  const rgba = cv.imread(source);
  const guesses: CardGuess[] = [];
  try {
    const t = glyphTemplates(cv);
    for (const corners of findCards(cv, rgba)) {
      const card = straighten(cv, rgba, portraitCorners(corners));
      const flipped = new cv.Mat();
      try {
        cv.rotate(card, flipped, cv.ROTATE_180);
        const a = readCorner(cv, card, t), b = readCorner(cv, flipped, t);
        const best = [a, b].filter((x): x is NonNullable<typeof x> => !!x).sort((x, y) => y.score - x.score)[0];
        if (best) guesses.push({ card: `${best.rank}${best.suit}`, confidence: best.score, corners });
      } finally {
        card.delete(); flipped.delete();
      }
    }
  } finally {
    rgba.delete();
  }
  return { guesses, flop: pickFlop(guesses), size: { width: source instanceof HTMLVideoElement ? source.videoWidth : source.width, height: source instanceof HTMLVideoElement ? source.videoHeight : source.height }, ms: Math.round(performance.now() - started) };
}
