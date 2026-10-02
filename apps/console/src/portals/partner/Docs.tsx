import { useState } from 'react';
import { Link } from 'react-router';
import { API_URL } from '../../lib/api.ts';
import { usePortal } from '../../components/Shell.tsx';
import { Callout, CodeBlock, PageHeader, Pills, Section } from '../../components/ui.tsx';

type Lang = 'curl' | 'typescript';

const STEPS = (base: string): { id: string; title: string; text: string; curl: string; typescript: string }[] => [
  {
    id: 'token', title: '1. Get an access token (OAuth2 client credentials)',
    text: 'Create an API key under API keys. Exchange the client id and secret for a bearer token, valid for one hour. Do this on your server only.',
    curl: `curl -s -X POST ${base}/v1/partner/oauth/token \\
  -H 'content-type: application/json' \\
  -d '{"grant_type":"client_credentials","client_id":"'"$PREFLOP_CLIENT_ID"'","client_secret":"'"$PREFLOP_CLIENT_SECRET"'"}'
# → {"access_token":"pft_…","token_type":"Bearer","expires_in":3600}`,
    typescript: `const BASE = '${base}';

export async function preflopToken(): Promise<string> {
  const res = await fetch(\`\${BASE}/v1/partner/oauth/token\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.PREFLOP_CLIENT_ID,
      client_secret: process.env.PREFLOP_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(\`token: \${res.status}\`);
  const { access_token } = (await res.json()) as { access_token: string; expires_in: number };
  return access_token; // cache until expires_in
}`,
  },
  {
    id: 'session', title: '2. Create a player session (for the widget)',
    text: 'Players are identified by your own player_ref. A session token lets the widget iframe act for that player; pass it as ?token= in the embed URL. Never send your access token to a browser.',
    curl: `curl -s -X POST ${base}/v1/partner/players/player-123/session \\
  -H "authorization: Bearer $PREFLOP_TOKEN"
# → {"token":"…","user_id":"…"}   use as <iframe src=".../embed/table/<tableId>?token=…">`,
    typescript: `export async function playerSession(token: string, playerRef: string) {
  const res = await fetch(\`\${BASE}/v1/partner/players/\${encodeURIComponent(playerRef)}/session\`, {
    method: 'POST',
    headers: { authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) throw new Error(\`session: \${res.status}\`);
  return (await res.json()) as { token: string; user_id: string };
}`,
  },
  {
    id: 'bet', title: '3. Place a bet (full API)',
    text: 'Read the current round and the partner-channel price, then place the bet with an Idempotency-Key. Money is integer minor units; odds are hundredths (237 = 2.37×). A 409 price_changed carries the new odds; 409 round_locked means betting closed at Start hand.',
    curl: `# current round and prices
curl -s ${base}/v1/tables/green-room/rounds/current
curl -s '${base}/v1/book?channel=partner'

curl -s -X POST ${base}/v1/partner/bets \\
  -H "authorization: Bearer $PREFLOP_TOKEN" \\
  -H 'content-type: application/json' \\
  -H "idempotency-key: $(uuidgen)" \\
  -d '{"player_ref":"player-123","round_id":"green-room:h412","selection_id":"rank-pattern:pair","stake_minor":100,"odds_centi":540}'
# → 201 {"bet_id":"…","status":"accepted","odds_centi":540,"potential_payout_minor":540,…}`,
    typescript: `import { randomUUID } from 'node:crypto';

export async function placeBet(token: string, bet: {
  player_ref: string; round_id: string; selection_id: string; stake_minor: number; odds_centi: number;
}) {
  const res = await fetch(\`\${BASE}/v1/partner/bets\`, {
    method: 'POST',
    headers: {
      authorization: \`Bearer \${token}\`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(), // reuse the same key when retrying the same bet
    },
    body: JSON.stringify(bet),
  });
  const body = await res.json();
  if (res.status === 409 && body.type === 'price_changed') return { retryAt: body.odds_centi as number };
  if (!res.ok) throw new Error(\`\${body.type}: \${body.title}\`);
  return body as { bet_id: string; status: string; potential_payout_minor: number };
}`,
  },
  {
    id: 'webhooks', title: '4. Verify webhooks',
    text: 'Each delivery has an X-PreFlop-Signature header "t=<unix seconds>, v1=<hex>", where v1 = HMAC-SHA256(signing secret, "<t>.<raw body>"). Reject stale timestamps (> 5 min), compare in constant time, and deduplicate by event_id: deliveries are retried for 24 h.',
    curl: `# Recompute the signature for a captured delivery body:
T=1760000000; BODY='{"event_id":"evt_…","type":"bet.settled",…}'
printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "$PREFLOP_WEBHOOK_SECRET" -hex
# compare with the v1= value of X-PreFlop-Signature`,
    typescript: `import { createHmac, timingSafeEqual } from 'node:crypto';

/** Express/Fastify: use the RAW request body, not re-serialised JSON. */
export function verifyPreflopWebhook(rawBody: string, header: string | undefined, secret: string, toleranceS = 300): boolean {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceS) return false;
  const expected = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// then: if (seen(event.event_id)) return 200; process(event); return 200;`,
  },
];

export function Docs() {
  const portal = usePortal();
  const [lang, setLang] = useState<Lang>('curl');
  const steps = STEPS(API_URL);
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Integration docs" subtitle="Quickstart for the Partner API (docs/02 §2). Sandbox: a simulated table deals random flops every ~20 s, so you can integrate without a live club." />
      <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden xl:block">
          <ul className="sticky top-24 space-y-1 text-sm">
            {steps.map((s) => <li key={s.id}><a href={`#${s.id}`} className="block rounded-[8px] px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-ink">{s.title.replace(/^\d\.\s*/, '')}</a></li>)}
            <li><a href="#reference" className="block rounded-[8px] px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-ink">Reference</a></li>
          </ul>
        </nav>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Pills label="Code language" options={['curl', 'typescript'] as const} value={lang} onChange={setLang} render={(l) => (l === 'curl' ? 'curl' : 'TypeScript')} />
            <span className="text-xs text-muted">Base URL <code className="font-mono text-ink">{API_URL}</code></span>
          </div>
          <Callout tone="info" title="Rules that apply everywhere">
            Every write takes an <code className="font-mono">Idempotency-Key</code> (a replay returns the original response). Money is integer minor units with a currency; odds are integer hundredths. Errors are <code className="font-mono">application/problem+json</code> with stable <code className="font-mono">type</code> codes such as <code className="font-mono">round_locked</code>, <code className="font-mono">price_changed</code>, <code className="font-mono">limit_exceeded</code>.
          </Callout>
          {steps.map((s) => (
            <Section key={s.id} title={<span id={s.id} className="scroll-mt-24">{s.title}</span>} subtitle={s.text}>
              <CodeBlock lang={lang === 'curl' ? 'bash' : 'typescript'} code={s[lang]} />
            </Section>
          ))}
          <Section title={<span id="reference" className="scroll-mt-24">Reference</span>}>
            <div className="grid gap-4 text-sm md:grid-cols-2">
              <div>
                <div className="mb-1 font-semibold">Feeds</div>
                <ul className="space-y-1 font-mono text-[12.5px] text-muted">
                  <li>GET /v1/lobby</li><li>GET /v1/tables/:id/rounds/current</li><li>GET /v1/book?channel=partner</li><li>WS /v1/stream — subscribe table:&lt;id&gt;</li>
                </ul>
              </div>
              <div>
                <div className="mb-1 font-semibold">Webhook events</div>
                <ul className="space-y-1 font-mono text-[12.5px] text-muted">
                  <li>bet.settled · bet.voided</li><li>round.voided · event.finished</li><li>fee.statement.ready</li>
                </ul>
              </div>
              <div>
                <div className="mb-1 font-semibold">Wallet modes</div>
                <p className="text-muted"><strong className="text-ink">Seamless</strong> (recommended): PreFlop calls your <code className="font-mono">/wallet/debit</code> and <code className="font-mono">/credit</code>, idempotent by bet_id. <strong className="text-ink">Transfer</strong>: move value into a PreFlop sub-wallet (<code className="font-mono">POST /v1/partner/players/:ref/deposits</code> in the sandbox).</p>
              </div>
              <div>
                <div className="mb-1 font-semibold">Next steps</div>
                <ul className="space-y-1 text-muted">
                  <li><Link className="text-accent hover:underline" to={`${portal.key}/keys`}>Create an API key</Link></li>
                  <li><Link className="text-accent hover:underline" to={`${portal.key}/webhooks`}>Register a webhook endpoint</Link></li>
                  <li><Link className="text-accent hover:underline" to={`${portal.key}/widget`}>Theme the widget</Link></li>
                </ul>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
