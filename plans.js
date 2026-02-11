const API_BASE = window.location.origin;

const FALLBACK_PLANS = [
  { tier: 'starter', display_name: 'Starter', monthly_credits: 5000, daily_cap: 500, price_label: '$12/mo' },
  { tier: 'pro', display_name: 'Pro', monthly_credits: 20000, daily_cap: 2000, price_label: '$29/mo' },
  { tier: 'enterprise', display_name: 'Enterprise', monthly_credits: 100000, daily_cap: 10000, price_label: 'Contact sales' }
];

const plansGrid = document.getElementById('plans-grid');
const plansComparison = document.getElementById('plans-comparison');
const plansError = document.getElementById('plans-error');

function formatCredits(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
}

function planSort(a, b) {
  const rank = { free: 0, starter: 1, pro: 2, enterprise: 3, power: 3 };
  return (rank[a.tier] ?? 99) - (rank[b.tier] ?? 99);
}

async function createSubscription(planTier) {
  const response = await fetch(`${API_BASE}/api/billing/subscriptions`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ plan_tier: planTier })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.url) {
    throw new Error(payload?.error || 'Unable to create checkout session');
  }
  window.location.href = payload.url;
}

function renderCards(plans) {
  plansGrid.innerHTML = plans.map((plan) => `
    <article class="plan-card" data-tier="${plan.tier}">
      <h3>${plan.display_name}</h3>
      <p class="plan-card-price">${plan.price_label || 'Custom'}</p>
      <ul>
        <li>${formatCredits(plan.monthly_credits)} monthly credits</li>
        <li>${formatCredits(plan.daily_cap)} daily cap</li>
        <li>Priority generation queue</li>
      </ul>
      <button class="primary-button" type="button" data-plan-cta="${plan.tier}">
        Select ${plan.display_name}
      </button>
    </article>
  `).join('');

  plansGrid.querySelectorAll('[data-plan-cta]').forEach((button) => {
    button.addEventListener('click', async () => {
      plansError.classList.add('hidden');
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Redirecting…';
      try {
        await createSubscription(button.dataset.planCta);
      } catch (error) {
        plansError.textContent = error?.message || 'Unable to start checkout. Please try again.';
        plansError.classList.remove('hidden');
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });
}

function renderComparison(plans) {
  plansComparison.innerHTML = `
    <table class="paywall-table" aria-label="Plan feature comparison">
      <thead>
        <tr>
          <th>Feature</th>
          ${plans.map((plan) => `<th>${plan.display_name}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>Price</th>
          ${plans.map((plan) => `<td>${plan.price_label || 'Custom'}</td>`).join('')}
        </tr>
        <tr>
          <th>Monthly credits</th>
          ${plans.map((plan) => `<td>${formatCredits(plan.monthly_credits)}</td>`).join('')}
        </tr>
        <tr>
          <th>Daily cap</th>
          ${plans.map((plan) => `<td>${formatCredits(plan.daily_cap)}</td>`).join('')}
        </tr>
        <tr>
          <th>Priority queue</th>
          ${plans.map((_, idx) => `<td>${idx >= 1 ? 'Yes' : 'Included'}</td>`).join('')}
        </tr>
      </tbody>
    </table>
  `;
}

async function loadPlans() {
  try {
    const response = await fetch(`${API_BASE}/api/plans`, { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    const plans = Array.isArray(payload?.plans) ? payload.plans : [];
    const selectable = plans
      .filter((plan) => ['starter', 'pro', 'enterprise', 'power'].includes(String(plan.tier).toLowerCase()))
      .map((plan) => ({
        ...plan,
        tier: String(plan.tier).toLowerCase(),
        display_name: String(plan.tier).toLowerCase() === 'power' ? 'Enterprise' : (plan.display_name || plan.tier)
      }))
      .sort(planSort);
    const resultPlans = selectable.length ? selectable : FALLBACK_PLANS;
    renderCards(resultPlans);
    renderComparison(resultPlans);
  } catch {
    renderCards(FALLBACK_PLANS);
    renderComparison(FALLBACK_PLANS);
  }
}

loadPlans();
