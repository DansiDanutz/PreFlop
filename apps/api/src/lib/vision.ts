import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { parseCard } from '@preflop/odds-engine';
import { z } from 'zod/v4';
import { ApiError } from './errors.ts';

/**
 * Webcam card recognition for manual tables (docs/19). A photo of the dealt flop goes to Claude,
 * which returns the cards it can read. The reading only pre-fills the console's card picker: a
 * person checks it and settles the hand, so a wrong reading costs a correction, never a payout.
 * Without ANTHROPIC_API_KEY the feature is off and the console says so (503 provider_not_configured).
 */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';
export interface FlopImage { base64: string; mediaType: ImageMediaType }
export interface FlopReading {
  /** Cards read left to right as the engine writes them ("Ah", "Td"), at most three, never duplicated. */
  cards: string[];
  confidence: 'high' | 'medium' | 'low';
  /** What the model could not read, or why it is unsure; shown to the operator. */
  notes: string;
}
export type FlopReader = (image: FlopImage) => Promise<FlopReading>;

/** Largest accepted photo, as base64 characters (≈ 4 MB of JPEG; the API accepts up to 5 MB). */
export const MAX_IMAGE_BASE64 = 5_500_000;

const Rank = z.enum(['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']);
const Suit = z.enum(['spades', 'hearts', 'diamonds', 'clubs']);
const Reading = z.object({
  cards: z.array(z.object({ rank: Rank, suit: Suit })).max(3),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string(),
});
export type RawReading = z.infer<typeof Reading>;

const SUIT_CODE: Record<z.infer<typeof Suit>, string> = { spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c' };

/** Model output → engine card codes: "10"→"T", suit words → letters, invalid or repeated cards dropped. */
export function normalizeReading(raw: RawReading): FlopReading {
  const cards: string[] = [];
  for (const c of raw.cards) {
    const code = `${c.rank === '10' ? 'T' : c.rank}${SUIT_CODE[c.suit]}`;
    try {
      parseCard(code);
    } catch {
      continue;
    }
    if (!cards.includes(code) && cards.length < 3) cards.push(code);
  }
  return { cards, confidence: raw.confidence, notes: raw.notes.trim().slice(0, 500) };
}

const SYSTEM = `You read the community cards dealt on a poker table from a single photo taken by a webcam.
Report the face-up playing cards you can see, left to right, at most three (the flop).
Report a card only when both its rank and its suit are clearly readable. If a card is hidden, cut off,
blurred, face down or ambiguous, leave it out and explain in notes. Never guess a card.
Ignore hole cards, chips, hands and anything that is not a face-up card on the table.`;

/** A reader backed by the Claude API. The key never leaves this closure. */
export function createFlopReader(apiKey: string, model: string): FlopReader {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  return async (image) => {
    let res;
    try {
      res = await client.messages.parse({
        model,
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
            { type: 'text', text: 'Which cards are face up on the table? Left to right.' },
          ],
        }],
        output_config: { format: zodOutputFormat(Reading), effort: 'medium' },
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new ApiError(503, 'provider_misconfigured', 'the card-recognition API key was refused; check ANTHROPIC_API_KEY');
      if (e instanceof Anthropic.RateLimitError) throw new ApiError(429, 'provider_busy', 'card recognition is rate limited; try again in a moment');
      if (e instanceof Anthropic.APIConnectionError) throw new ApiError(502, 'provider_unreachable', 'could not reach the card-recognition service');
      if (e instanceof Anthropic.APIError) throw new ApiError(502, 'provider_error', `card recognition failed (${e.status})`);
      throw e;
    }
    if (res.stop_reason === 'refusal') throw new ApiError(502, 'vision_refused', 'the card-recognition service declined this photo; enter the cards by hand');
    if (!res.parsed_output) throw new ApiError(502, 'vision_unreadable', 'the card-recognition service gave no usable answer; enter the cards by hand');
    return normalizeReading(res.parsed_output);
  };
}
