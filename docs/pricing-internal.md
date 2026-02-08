# Pricing model (internal)

This document keeps the internal-facing pricing model notes that should **not** be rendered in the product UI. The consumer-facing copy now lives in the upgrade modal.

## First principles

- Credits, not tokens.
- Credits abstract model volatility.
- Margin target: 3–5× API cost.
- Users should not burn a month in a single day.
- Free tier demonstrates value but enforces discipline.

## Internal cost model (example numbers)

- Blended API cost (input + output, mixed use): **$0.003 per 1K tokens**.
- **1 credit = 250 tokens**.
- Cost per credit ≈ **$0.00075**.
- Cost per 1,000 credits ≈ **$0.75**.

## Public pricing tiers (reference)

- **Free**: 500 credits/month, daily cap 100, $0.
- **Starter**: 5,000 credits/month, daily cap 500, $12/month.
- **Pro**: 20,000 credits/month, daily cap 2,000, $39/month.
- **Power / Studio**: 100,000 credits/month, daily cap 10,000, $149/month.

## Credit top-ups (high-margin add-on)

- 1,000 credits → $5 (~6.5× margin)
- 5,000 credits → $20 (~5.3× margin)
- 20,000 credits → $60 (~4× margin)

## Throttling model

- Monthly credits (hard cap).
- Daily burn limit (soft cap).

## Billing implementation notes

- Stripe subscriptions for paid tiers.
- One-time Stripe Checkout for top-ups.
- Upgrades apply immediately; downgrades next billing cycle.
- Always display plan, credits remaining, and reset date in the UI.
