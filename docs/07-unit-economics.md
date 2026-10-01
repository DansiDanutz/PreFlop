# 07 — Unit Economics: the Net Expected-Value (EV) Model

**Principle:** the house edge counts only **after every cost has been paid**. A 5% gross margin is not a 5% profit. Revenue shares, promotions, payment fees, KYC, chargebacks and streaming all come out of it first. The engine builds these costs into every price.

All cost figures are **placeholders** in `packages/odds-engine/src/costModel.ts`. Change them and run `pnpm book`; the odds, margins and the net-EV columns in [`odds-book.md`](./odds-book.md) update automatically. The tests then prove again that every offered selection still meets the net target.

## 1. Per-bet economics (fixed odds against the house)

Per unit staked:

```
GGR (gross edge)  g = 1 − p · odds
paid away           (s + b) · g        s = revenue shares (club / partner), b = promotions — fractions of GGR
variable costs      c_t                payments (fee × deposits ÷ turnover) + KYC/chargebacks + streaming/infra
───────────────────────────────────
PreFlop net EV    = g · (1 − s − b) − c_t
```

To keep a net target T, the gross margin must be at least:

```
m_required = (T + c_t) / (1 − s − b)
```

**Worked example:** s = 40%, b = 10%, c_t = 0.5%, T = 3% gives m = 3.5% / 50% = **7%**. A flat 5% book would **lose money** in that channel. This case is a unit test.

Each selection's margin is `max(tier floor, m_required)`. The higher number always wins.

## 2. Placeholder channels and the margins they require (T = 2.5%)

| Channel | Plan model | s + b | c_t | Required gross margin |
|---|---|---|---|---|
| Direct app | PreFlop + provider club (20%), promotions 10% | 30% | 1.13% | **5.18%** |
| Club's own players | Model A, club 50%, promotions 5% | 55% | 1.13% | **8.06%** |
| Betting partner | Model B, club 15% + partner 35%, seamless wallet | 50% | 0.30% | **5.60%** |
| User-organized contest | Model C, organizer 45% + club 20% | 65% | 3.00% | **15.71% fee** |
| Club-organized contest | Model D, club 50% | 50% | 3.00% | **11.00% fee** |

c_t for the direct app: 2.5% payment fee × 0.25 deposits per unit staked, plus 0.2% KYC/chargebacks, plus 0.3% streaming/infrastructure = 1.125%.

**What this tells the commercial team:**

1. **Model A is the most expensive channel.** Giving clubs 50% of GGR pushes the required margin to about 8%. Either cap the club's share at around 35–40%, or accept shorter odds in club-branded rooms.
2. **Contest fees must be high** (11–16%) once the organizer and club are paid, because the fee is the only income and buy-ins carry full payment costs. The alternative is cutting the organizer's share. "Largest share" can be 40% against PreFlop's 35% and still satisfy the plan.
3. **The partner channel is efficient.** The partner bears payment, KYC and promotion costs, so 5.6% suffices.
4. Promotions are a cost like any other. A 10% promotions budget raises every price by about 0.4–0.7 points.

## 3. Fixed costs and break-even

Fixed costs do not go into the odds; they set the **volume** needed:

```
break-even monthly turnover = (fixed monthly costs − subscription income) / net margin per unit staked
```

With the placeholders:
- Fixed costs: €85k/month (engineering €45k, operations €15k, compliance €8k, infrastructure €5k, marketing €12k).
- Subscriptions: 10 clubs × €1,500 = €15k.
- Result: **€2.8M staked per month** at a 2.5% net margin.

**Sanity check on volume:** one table deals about 30 hands per hour.
- 12 live hours × 30 days ≈ 10,800 flops per table per month.
- €2.8M ÷ 10,800 ≈ **€260 staked per flop** across all tables. That is about €26 per flop per table across 10 tables.

## 4. Net EV in the odds book

[`odds-book.md`](./odds-book.md) has a **Net EV** column for every selection. Because of tier floors and rounding down, most selections land well above the 2.5% target. Common markets sit at about 2.6–3.0%, and long shots at about 5–10%. The engine guarantees that none is below the target.
