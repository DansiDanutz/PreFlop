-- News: posts about the app and the platform, written by the PreFlop team in the console and
-- shown on the public website (/news). The body is a small Markdown subset (paragraphs, ## and ###
-- headings, bullet and numbered lists, **bold**, *italic*, `code`, https links) that the apps
-- render into elements, never into raw HTML.

create table news_posts (
  id           text primary key,
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title        text not null check (length(title) between 3 and 120),
  summary      text not null default '' check (length(summary) <= 300),
  body         text not null default '' check (length(body) <= 20000),
  tags         text[] not null default '{}',
  status       text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  author_id    text references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (status = 'draft' or published_at is not null)
);
create index news_posts_published on news_posts (published_at desc) where status = 'published';
create index news_posts_tags on news_posts using gin (tags);

-- Launch posts. Each one describes work that is in this repository.
insert into news_posts (id, slug, title, summary, body, tags, status, published_at) values
('news_launch_widget', 'partner-widget-customization', 'Partner widget customization',
 'Partners can now set the accent colour, the markets, the stake buttons and the default table of the embeddable PreFlop widget.',
 $md$The PreFlop widget lets a partner show a live table inside its own product. Partners can now tailor it from the **Widget** page of the partner portal.

## What you can set

- **Accent colour**: any 6-digit hex colour. The widget derives hover, background and text shades from it, and picks dark or white text on top so buttons stay readable.
- **Markets**: show every market, or only the ones you choose.
- **Stake buttons**: up to five stake presets.
- **Default table**: the table the widget opens on.

## Safe by design

Every option in the iframe URL is validated. A value that is not valid is dropped and the widget falls back to its default. The player session travels in the URL *fragment*, which browsers never send to a server, and the widget keeps it only for the browser session.

Free chips have no cash value. Real-money play is only offered where licensed, through licensed operators.$md$,
 '{partners,widget}', 'published', now() - interval '3 minutes'),

('news_launch_markets', 'markets-rulebook-42-markets', 'New markets rulebook: 42 markets, every count verified',
 'The full rulebook covers 42 markets and 250 selections. Every winning-flop count is now checked by a second, independent calculation.',
 $md$PreFlop prices every bet from all **22,100** possible flops. The new rulebook groups every bet into **42 markets** with **250 selections**.

## One rule prices and settles

The same rule that counts the winning flops for a price also settles the bet, so the published rule and the settlement can never drift apart. Three selections ("exactly 3 aces", "total 6" and "total 42") win on only 4 of 22,100 flops and are too rare to offer, so 247 selections are offered.

## Counted twice

Each count now has an independent closed-form calculation in the test suite, and the tests fail if the two ever disagree. The conventions are written down too: the ace plays high or low in straights, J, Q and K are the face cards, and "below" and "above" are strict.

Every market and price is listed in the **Odds** page of this site, with the rule for each market.$md$,
 '{markets,odds}', 'published', now() - interval '2 minutes'),

('news_launch_security', 'security-and-responsible-play-upgrades', 'Security and responsible-play upgrades',
 'Age gate, territory rules, session limits with reality checks, email verification, password reset and two-factor sign-in for the PreFlop team.',
 $md$We have shipped a round of account, security and responsible-play work across the app and the console.

## Responsible play

- **18+ only**: registration asks for a date of birth and refuses anyone under 18.
- **Territories**: registration asks for a country, and some countries are blocked.
- **Session limit and reality checks**: set a session length in your profile. A reality check shows your time played and your result for the session, with *Continue* or *Take a break*.
- **Limits and self-exclusion** stay in your profile. Self-exclusion cannot be shortened once it starts.

## Accounts and security

- Email verification and password reset links that work once and expire.
- Two-factor sign-in (TOTP) for the PreFlop team console.
- Strict security headers on every site, self-hosted fonts and no third-party scripts.
- Live updates authenticate inside the connection, never in the URL.
- Club tablets lock with a staff PIN, sign nothing while locked, and use press-and-hold for every signed step.

Free chips have no cash value and can never be cashed out.$md$,
 '{security,responsible-play}', 'published', now() - interval '1 minute'),

('news_launch_tournaments', 'tournaments-are-live', 'Tournaments are live (free chips)',
 'Free-chip tournaments: everyone gets the same stack and the same number of bets, and the biggest stack at the end wins.',
 $md$Tournaments are now open in the app, with **free chips**.

## How they work

1. Register for a tournament from the **Tournaments** page.
2. Every entrant gets the same stack of tournament points and the same number of bets.
3. Bet on the flops of the live simulated tables while the tournament runs, one bet per flop.
4. The biggest stack when the clock ends wins. On the same stack, the player who used fewer bets ranks higher.

The leaderboard updates live after every bet and every flop.

## Prizes

Free-chip tournaments pay free chips and badges only. Free chips have no cash value and can never be cashed out. Play for fun, and take a break whenever you like.$md$,
 '{tournaments,players}', 'published', now());
