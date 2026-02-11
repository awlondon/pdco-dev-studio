#!/usr/bin/env node
import { grantPlanOverrideByEmail } from '../utils/userDb.js';

const FREE_PLAN = { tier: 'free', monthly_credits: 500 };
const PLAN_DAILY_CAPS = {
  free: 100,
  starter: 500,
  pro: 2000,
  power: 10000
};

function loadPlanCatalog() {
  const catalog = {
    [FREE_PLAN.tier]: {
      tier: FREE_PLAN.tier,
      monthly_credits: FREE_PLAN.monthly_credits,
      daily_cap: PLAN_DAILY_CAPS.free
    }
  };

  const rawCatalog = process.env.STRIPE_PLAN_CATALOG;
  if (rawCatalog) {
    try {
      const parsed = JSON.parse(rawCatalog);
      for (const [tier, entry] of Object.entries(parsed)) {
        const normalizedTier = String(tier).toLowerCase();
        const monthlyCredits = Number(entry?.monthly_credits ?? entry?.monthlyCredits);
        const dailyCap = Number(entry?.daily_cap ?? entry?.dailyCap);
        catalog[normalizedTier] = {
          tier: normalizedTier,
          monthly_credits: Number.isFinite(monthlyCredits)
            ? monthlyCredits
            : (catalog[normalizedTier]?.monthly_credits ?? FREE_PLAN.monthly_credits),
          daily_cap: Number.isFinite(dailyCap)
            ? dailyCap
            : (PLAN_DAILY_CAPS[normalizedTier] ?? null)
        };
      }
    } catch (error) {
      console.warn('Invalid STRIPE_PLAN_CATALOG JSON. Falling back to defaults.', error?.message || error);
    }
  }

  return catalog;
}

function parseArgs(argv) {
  const parsed = {
    email: '',
    plan: '',
    internal: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--email') {
      parsed.email = argv[i + 1] || '';
      i += 1;
    } else if (token === '--plan') {
      parsed.plan = argv[i + 1] || '';
      i += 1;
    } else if (token === '--external') {
      parsed.internal = false;
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email || '').trim().toLowerCase();
  const plan = String(args.plan || '').trim().toLowerCase();

  if (!email || !plan) {
    console.error('Usage: node scripts/grant-plan.js --email <user@example.com> --plan <free|starter|pro|power> [--external]');
    process.exit(1);
  }

  const catalog = loadPlanCatalog();
  const planConfig = catalog[plan];
  if (!planConfig) {
    console.error(`Unknown plan tier: ${plan}`);
    process.exit(1);
  }

  const user = await grantPlanOverrideByEmail({
    email,
    planTier: plan,
    monthlyCredits: Number(planConfig.monthly_credits ?? FREE_PLAN.monthly_credits),
    dailyCap: planConfig.daily_cap ?? null,
    markInternal: args.internal
  });

  console.log(JSON.stringify({
    ok: true,
    user_id: user.user_id,
    email: user.email,
    is_internal: user.is_internal,
    plan_override: user.plan_override,
    effective_plan: user.plan_tier,
    credits_total: user.credits_total,
    credits_remaining: user.credits_remaining,
    daily_credit_limit: user.daily_credit_limit
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error)
  }, null, 2));
  process.exit(1);
});
