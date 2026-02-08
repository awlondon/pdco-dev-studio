import { createSandboxController } from './sandboxController.js';

if (!window.GOOGLE_CLIENT_ID) {
  console.warn('Missing GOOGLE_CLIENT_ID. Google auth disabled.');
}

const API_BASE = window.__MAYA_API_BASE || '';

const AuthController = (() => {
  const providers = new Map();

  function register(name, initFn) {
    providers.set(name, initFn);
  }

  function initAll() {
    for (const [name, init] of providers.entries()) {
      try {
        init();
      } catch (err) {
        console.error(`Auth provider failed: ${name}`, err);
      }
    }
  }

  return {
    register,
    initAll
  };
})();

window.AuthController = AuthController;

const EmailAuthSlot = (() => {
  let state = 'idle';
  let email = '';

  function render() {
    const slot = document.querySelector('.auth-slot[data-provider="email"]');
    if (!slot) {
      return;
    }

    if (state === 'idle') {
      slot.innerHTML = `
        <div class="email-auth">
          <input
            type="email"
            class="email-input"
            placeholder="you@example.com"
            aria-label="Email address"
          />
          <button class="auth-btn email-btn">Continue with Email</button>
        </div>
      `;
    }

    if (state === 'sending') {
      slot.innerHTML = `
        <button class="auth-btn" disabled>
          Sending link…
        </button>
      `;
    }

    if (state === 'sent') {
      slot.innerHTML = `
        <div class="email-sent">
          <p>Check your email</p>
          <span>${email}</span>
        </div>
      `;
    }

    bind();
  }

  function bind() {
    if (state !== 'idle') {
      return;
    }

    const input = document.querySelector('.email-input');
    const button = document.querySelector('.email-btn');

    if (!input || !button) {
      return;
    }

    button.onclick = async () => {
      email = input.value.trim();
      if (!email) {
        return;
      }

      markAuthAttempt('email');
      state = 'sending';
      render();

      try {
        const res = await fetch(`${API_BASE}/api/auth/email/request`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error('Email auth request failed.');
        }
        if (data?.debug_magic_link) {
          setDebugMagicLink(data.debug_magic_link);
        }

        state = 'sent';
        render();
      } catch {
        state = 'idle';
        render();
      }
    };
  }

  return {
    init() {
      state = 'idle';
      render();
    }
  };
})();

const isAuthDebugEnabled =
  location.hostname === 'localhost' ||
  location.hostname.startsWith('dev.') ||
  new URLSearchParams(location.search).has('authDebug');

let lastAuthProvider = '—';
let lastMagicLink = '—';
let lastGoogleAuthStatus = '—';
let lastGoogleAuthJson = '—';

export function markAuthAttempt(provider) {
  lastAuthProvider = provider;
}

function setDebugMagicLink(link) {
  lastMagicLink = link || '—';
  const el = document.getElementById('authDebugMagicLink');
  if (!el) return;

  if (lastMagicLink !== '—') {
    el.textContent = lastMagicLink;
    el.href = lastMagicLink;
  } else {
    el.textContent = '—';
    el.removeAttribute('href');
  }
}

async function refreshAuthDebug() {
  const panel = document.getElementById('auth-debug-panel');
  if (!panel) return;

  const fetchDebugInfo = async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    const contentType = res.headers.get('content-type') || '—';
    let preview = '—';
    let json = null;

    if (contentType.includes('application/json')) {
      try {
        json = await res.json();
      } catch {
        preview = 'Invalid JSON response';
      }
    } else {
      const text = await res.text();
      preview = text ? text.slice(0, 120) : '—';
    }

    return { res, contentType, preview, json };
  };

  document.getElementById('authDebugEnv').textContent = location.origin;

  document.getElementById('authDebugCookie').textContent =
    document.cookie.includes('maya_session')
      ? 'present'
      : 'not visible';

  try {
    const meInfo = await fetchDebugInfo(`${API_BASE}/api/me?ts=${Date.now()}`);
    document.getElementById('authDebugMeStatus').textContent =
      `${meInfo.res.status}`;
    document.getElementById('authDebugMeType').textContent =
      meInfo.contentType;
    const authState = uiState === UI_STATE.APP ? 'authenticated' : 'unauthenticated';
    if (isAuthDebugEnabled && authState === 'authenticated' && meInfo.res.status !== 200) {
      console.error('[AUTH INVARIANT FAILED]', 'authenticated=true but /api/me != 200');
    }

    if (meInfo.contentType.includes('application/json')) {
      const data = meInfo.json;
      const keys = data && typeof data === 'object' ? Object.keys(data) : [];
      document.getElementById('authDebugMeKeys').textContent =
        keys.length ? keys.join(', ') : '—';
      document.getElementById('authDebugMePreview').textContent = '—';
    } else {
      document.getElementById('authDebugMeKeys').textContent =
        '/api/me returned HTML; domain is not wired to Pages Functions.';
      document.getElementById('authDebugMePreview').textContent =
        meInfo.preview;
      console.error('/api/me returned HTML; domain is not wired to Pages Functions.');
    }
  } catch {
    document.getElementById('authDebugMeStatus').textContent = 'network error';
    document.getElementById('authDebugMeType').textContent = '—';
    document.getElementById('authDebugMeKeys').textContent = '—';
    document.getElementById('authDebugMePreview').textContent = '—';
  }

  try {
    const envInfo = await fetchDebugInfo(`${API_BASE}/api/debug/env?ts=${Date.now()}`);
    document.getElementById('authDebugEnvStatus').textContent =
      `${envInfo.res.status}`;
    if (envInfo.res.status === 404) {
      document.getElementById('authDebugEnvMissing').textContent =
        'debug endpoint disabled';
    } else if (envInfo.contentType.includes('application/json')) {
      const data = envInfo.json;
      const envPresent = data?.env_present || {};
      const missing = Object.entries(envPresent)
        .filter(([, present]) => !present)
        .map(([key]) => key);
      document.getElementById('authDebugEnvMissing').textContent =
        missing.length ? missing.join(', ') : 'none';
    } else {
      document.getElementById('authDebugEnvMissing').textContent = envInfo.preview;
    }
  } catch {
    document.getElementById('authDebugEnvStatus').textContent = 'network error';
    document.getElementById('authDebugEnvMissing').textContent = '—';
  }

  try {
    const healthInfo = await fetchDebugInfo(`${API_BASE}/api/health`);
    document.getElementById('authDebugHealthStatus').textContent =
      `${healthInfo.res.status}`;
    document.getElementById('authDebugHealthType').textContent =
      healthInfo.contentType;
    if (healthInfo.contentType.includes('application/json')) {
      document.getElementById('authDebugHealthPreview').textContent = '—';
    } else {
      document.getElementById('authDebugHealthPreview').textContent =
        healthInfo.preview;
    }
  } catch {
    document.getElementById('authDebugHealthStatus').textContent = 'network error';
    document.getElementById('authDebugHealthType').textContent = '—';
    document.getElementById('authDebugHealthPreview').textContent = '—';
  }

  document.getElementById('authDebugLastProvider').textContent =
    lastAuthProvider;

  document.getElementById('authDebugGoogleStatus').textContent =
    lastGoogleAuthStatus;
  document.getElementById('authDebugGoogleJson').textContent =
    lastGoogleAuthJson;

  setDebugMagicLink(lastMagicLink);
}

function initAuthDebugPanel() {
  if (!isAuthDebugEnabled) {
    return;
  }

  const panel = document.getElementById('auth-debug-panel');
  if (!panel) return;

  panel.classList.remove('hidden');

  document
    .getElementById('authDebugRefresh')
    ?.addEventListener('click', refreshAuthDebug);

  const toggleBtn = document.getElementById('authDebugToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      toggleBtn.title = panel.classList.contains('collapsed')
        ? 'Expand debug panel'
        : 'Collapse debug panel';
    });
  }

  refreshAuthDebug();
}

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('btn-send');
const creditPreviewEl = document.getElementById('credit-preview');
const micButton = document.getElementById('btn-mic');
const creditBadge = document.getElementById('creditBadge');
const creditPanel = document.getElementById('credit-panel');
const creditMeterFill = document.querySelector('.credit-meter .fill');
const creditMeterLabel = document.querySelector('.credit-meter .label');
const creditResetLabel = document.getElementById('credit-reset');
const creditDailyLimitLabel = document.getElementById('credit-daily-limit');
const creditInlineWarning = document.getElementById('credit-inline-warning');
const creditBanner = document.getElementById('credit-banner');
const creditZero = document.getElementById('credit-zero');
const creditDailyMessage = document.getElementById('credit-daily-message');
const creditUpgradeNudge = document.getElementById('credit-upgrade-nudge');
const userMenuTrigger = document.getElementById('userMenuTrigger');
const userMenu = document.getElementById('userMenu');
const upgradePlanButton = document.getElementById('upgradePlan');
const pricingModal = document.getElementById('pricing-modal');
const pricingModalBody = document.getElementById('pricing-modal-body');
const pricingCloseButton = document.getElementById('pricing-close');
const pricingCollapseButton = document.getElementById('pricing-collapse');
const pricingOpenButtons = document.querySelectorAll('[data-open-pricing]');
const throttleNotice = document.getElementById('throttleNotice');
const usageModal = document.getElementById('usage-modal');
const usageCloseButton = document.getElementById('usage-close');
const usageTabs = document.querySelectorAll('.usage-tab');
const usageTabPanels = document.querySelectorAll('.usage-tab-panel');
const usageOpenButtons = document.querySelectorAll('[data-open-usage]');
const usageScopeLabel = document.getElementById('usage-scope-label');
const usageFilters = document.getElementById('usage-filters');
const usageUserFilter = document.getElementById('usage-user-filter');
const usagePlanFilter = document.getElementById('usage-plan-filter');
const usageStartDate = document.getElementById('usage-start-date');
const usageEndDate = document.getElementById('usage-end-date');
const usageApplyFilters = document.getElementById('usage-apply-filters');
const usageCreditsMonth = document.getElementById('usage-credits-month');
const usageRequestsMonth = document.getElementById('usage-requests-month');
const usageLatencyMonth = document.getElementById('usage-latency-month');
const usageSuccessMonth = document.getElementById('usage-success-month');
const usageRangeLabel = document.getElementById('usage-range-label');
const usageCreditsChart = document.getElementById('credits-chart');
const usageRequestsChart = document.getElementById('requests-chart');
const usageLatencyChart = document.getElementById('latency-chart');
const usageHistoryBody = document.getElementById('usage-history-body');
const usageHistoryEmpty = document.getElementById('usage-history-empty');
const usageLoadMore = document.getElementById('usage-load-more');
const paywallModal = document.getElementById('paywall-modal');
const paywallBackdrop = document.querySelector('[data-paywall-backdrop]');
const paywallTitle = document.getElementById('paywall-title');
const paywallSubtext = document.getElementById('paywall-subtext');
const paywallCurrentPlan = document.getElementById('paywall-current-plan');
const paywallCreditsRemaining = document.getElementById('paywall-credits-remaining');
const paywallDailyThrottle = document.getElementById('paywall-daily-throttle');
const paywallCostLine = document.getElementById('paywall-cost-line');
const paywallFooter = document.getElementById('paywall-footer');
const paywallCompactSection = document.querySelector('[data-paywall-compact]');
const paywallCompareSection = document.querySelector('[data-paywall-compare]');
const paywallPlanButtons = document.querySelectorAll('[data-paywall-plan]');
const paywallPlanCells = document.querySelectorAll('[data-paywall-plan-cell]');
const paywallPlanCards = document.querySelectorAll('[data-paywall-plan-card]');
const paywallPrimaryButton = document.getElementById('paywall-primary');
const paywallSecondaryButton = document.getElementById('paywall-secondary');
const paywallTertiaryButton = document.getElementById('paywall-tertiary');
const paywallCloseButton = document.getElementById('paywall-close');
const codeEditor = document.getElementById('code-editor');
const lineNumbersEl = document.getElementById('line-numbers');
const lineCountEl = document.getElementById('line-count');
const consoleLog = document.getElementById('console-output-log');
const consolePane = document.getElementById('consoleOutput');
const root = document.getElementById('root');
let sandboxFrame = document.getElementById('sandbox');
const previewFrameHost = document.getElementById('previewFrameContainer');
const statusLabel = document.getElementById('status-label');
const generationIndicator = document.getElementById('generation-indicator');
const previewStatus = document.getElementById('previewStatus');
const previewExecutionStatus = document.getElementById('previewExecutionStatus');
const splitter = document.getElementById('splitter');
const rightPane = document.getElementById('right-pane');
const codePanel = document.getElementById('code-panel');
const outputPanel = document.getElementById('output-panel');
const fullscreenToggle = document.getElementById('fullscreenToggle');
const interfaceStatus = document.getElementById('interfaceStatus');
const viewDiffBtn = document.getElementById('viewDiffBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const executionWarnings = document.getElementById('executionWarnings');
const sandboxStatus = document.getElementById('sandbox-status');
const sandboxControls = document.getElementById('sandbox-controls');
const sandboxPauseButton = document.getElementById('sandboxPause');
const sandboxResumeButton = document.getElementById('sandboxResume');
const sandboxResetButton = document.getElementById('sandboxReset');
const sandboxStopButton = document.getElementById('sandboxStop');
const runButton = document.getElementById('runCode');
const rollbackButton = document.getElementById('rollbackButton');
const promoteButton = document.getElementById('promoteButton');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const SANDBOX_TIMEOUT_MS = 4500;
const UI_STATE = {
  AUTH: 'auth',
  APP: 'app'
};
let uiState = UI_STATE.AUTH;
let showAnalytics = false;
let appInitialized = false;
const Auth = {
  user: null,
  token: null,
  provider: null
};
let currentUser = null;
const GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || '';
const APPLE_CLIENT_ID = window.APPLE_CLIENT_ID || '';
const APPLE_REDIRECT_URI = window.APPLE_REDIRECT_URI || '';

const AUTH_STORAGE_KEYS = [
  'maya_credits',
  'maya_user',
  'maya_token'
];
const GENERATION_PHASES = [
  {
    afterMs: 2500,
    messages: [
      'Laying out the structure…',
      'Sketching the interface…',
      'Planning visual components…'
    ]
  },
  {
    afterMs: 8000,
    messages: [
      'Refining interactions and layout…',
      'Balancing structure with visuals…',
      'Resolving component relationships…'
    ]
  },
  {
    afterMs: 20000,
    messages: [
      'This is a more complex build — working through details…',
      'Handling multiple layers of logic and presentation…',
      'Making sure pieces fit together cleanly…'
    ]
  },
  {
    afterMs: 45000,
    messages: [
      'This is a heavy request — taking extra care to get it right…',
      'Finalizing a larger-than-usual generation…',
      'Almost there — finishing the remaining pieces…'
    ]
  }
];

const defaultInterfaceCode = `<!doctype html>
<html>
<body>
<div id="app"></div>
</body>
</html>`;

const SESSION_BRIDGE_MARKER = '<!-- MAYA_SESSION_BRIDGE -->';
const SESSION_BRIDGE_SCRIPT = `${SESSION_BRIDGE_MARKER}
<script id="maya-session-bridge">
  window.__SESSION__ = window.__SESSION__ || null;
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'SESSION') {
      window.__SESSION__ = event.data;
    }
  });
</script>`;

function injectSessionBridge(code) {
  if (!code || code.includes('maya-session-bridge') || code.includes(SESSION_BRIDGE_MARKER)) {
    return code;
  }
  if (code.includes('</body>')) {
    return code.replace('</body>', `${SESSION_BRIDGE_SCRIPT}\n</body>`);
  }
  if (code.includes('</html>')) {
    return code.replace('</html>', `${SESSION_BRIDGE_SCRIPT}\n</html>`);
  }
  return `${code}\n${SESSION_BRIDGE_SCRIPT}`;
}

const TOKENS_PER_CREDIT = 250;
const CREDIT_RESERVE_MULTIPLIER = 1.25;
const CREDIT_WARNING_THRESHOLD = 0.5;
const MONTHLY_SOFT_USAGE_THRESHOLD = 0.5;
const MONTHLY_FIRM_USAGE_THRESHOLD = 0.85;
const DAILY_SOFT_USAGE_THRESHOLD = 0.7;
const PAYWALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const PAYWALL_DISMISS_KEY = 'mayaPaywallDismissedAt';
const PAYWALL_SUPPRESS_SESSION_KEY = 'mayaPaywallSuppressSession';
const PAYWALL_SELECTED_PLAN_KEY = 'mayaPaywallSelectedPlan';
const PAYWALL_UPGRADE_KEY = 'mayaPaywallUpgradeSuccess';
const PAYWALL_FIRST_SEEN_KEY = 'mayaPaywallFirstSeenAt';
const PAYWALL_FIRST_SESSION_KEY = 'mayaPaywallFirstSessionSeen';
const NUDGE_SESSION_KEY = 'mayaNudgeSessionShown';
const NUDGE_STATE_KEY = 'mayaNudgeState';
const NUDGE_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const THROTTLE_HIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const LARGE_GENERATION_TOKEN_THRESHOLD = 2400;
const LARGE_GENERATION_COUNT_THRESHOLD = 3;
const LARGE_GENERATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const USAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const ANALYTICS_CACHE_TTL_MS = 45 * 1000;
const ANALYTICS_TIMEOUT_MS = 3000;
const USAGE_FETCH_TIMEOUT_MS = 5000;
const USAGE_RANGE_STEPS = [14, 30, 60, 90];
const PLAN_DAILY_CAPS = {
  free: 100,
  starter: 500,
  pro: 2000,
  power: 10000
};

const usageState = {
  activeTab: 'overview',
  rangeIndex: 0,
  charts: {
    credits: null,
    requests: null,
    latency: null
  }
};

const usageCache = {
  fetchedAt: 0,
  usageRows: null,
  userRows: null
};

const analyticsCache = {
  fetchedAt: 0,
  data: null
};

const analyticsModalState = {
  open: false,
  loading: false,
  error: null,
  data: null,
  watchdogId: null
};

function applyAuthToRoot() {
  if (!root) {
    return;
  }
  root.dataset.userId = Auth.user?.id || '';
  root.dataset.email = Auth.user?.email || '';
}

function clearAuthFromRoot() {
  if (!root) {
    return;
  }
  root.dataset.userId = '';
  root.dataset.email = '';
}

function renderAuthModalHTML() {
  return `
    <div class="auth-card">
      <h2 class="auth-title">Welcome to Maya</h2>

      <div class="auth-stack">

        <div class="auth-slot" data-provider="google">
          <div id="google-signin"></div>
          <p class="auth-helper" id="google-auth-status" data-active="false" aria-live="polite"></p>
        </div>

        <div class="auth-slot" data-provider="apple">
          <button class="auth-btn">Continue with Apple</button>
        </div>

        <div class="auth-slot" data-provider="email"></div>

      </div>

      <label class="newsletter">
        <input type="checkbox" checked />
        Receive product updates and announcements
      </label>
    </div>
  `;
}

function showAuthModal() {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    return;
  }

  modalRoot.innerHTML = renderAuthModalHTML();
  modalRoot.classList.remove('hidden');
  modalRoot.setAttribute('aria-hidden', 'false');

  AuthController.initAll();
}

function bootstrapAuthenticatedUI(user) {
  currentUser = user;

  uiState = UI_STATE.APP;
  showAnalytics = false;

  document.body.classList.remove('unauthenticated');
  document.getElementById('modal-root')?.classList.add('hidden');
  document.getElementById('root')?.classList.remove('hidden');

  renderUserHeader();
  renderCredits();
  renderUI();
}

function renderUserHeader() {
  if (!currentUser) return;

  const avatar = document.getElementById('userAvatar');
  const name = document.getElementById('userName');
  if (!avatar || !name) return;

  const displayName = currentUser.name || currentUser.email || 'User';
  const initial = displayName[0]?.toUpperCase() ?? '?';

  avatar.textContent = initial;
  name.textContent = displayName;
}

function renderCredits() {
  if (!currentUser) return;

  const badge = document.querySelector('#creditBadge .count');
  const planCredits = document.getElementById('userPlanCredits');
  if (!badge || !planCredits) return;

  badge.textContent = currentUser.creditsRemaining;
  const planLabel = currentUser.plan || currentUser.planTier || 'Free';
  planCredits.textContent = `Credits: ${currentUser.creditsRemaining} · Plan: ${planLabel}`;
}

function updateCreditsUI(credits) {
  const resolvedCredits = Number.isFinite(credits) ? credits : 500;
  if (currentUser) {
    currentUser.creditsRemaining = resolvedCredits;
  }
  if (root) {
    root.dataset.remainingCredits = `${resolvedCredits}`;
    root.dataset.creditsTotal = `${resolvedCredits}`;
  }
  updateCreditUI();
  renderCredits();
}

function hydrateCreditState() {
  if (!window.localStorage) {
    return;
  }
  const storedCredits = Number(window.localStorage.getItem('maya_credits'));
  if (Number.isFinite(storedCredits)) {
    updateCreditsUI(storedCredits);
  }
}

function resolveCredits(credits) {
  if (Number.isFinite(credits)) {
    return credits;
  }
  const storedCredits = Number(window.localStorage?.getItem('maya_credits'));
  if (Number.isFinite(storedCredits)) {
    return storedCredits;
  }
  return 500;
}

function persistSessionStorage({ user, token }) {
  if (!window.localStorage) {
    return;
  }
  if (user) {
    window.localStorage.setItem('maya_user', JSON.stringify(user));
  }
  if (token) {
    window.localStorage.setItem('maya_token', token);
  }
}

function buildSessionPayload() {
  if (!Auth.user || !Auth.token) {
    return null;
  }
  return {
    type: 'SESSION',
    user: Auth.user,
    token: Auth.token
  };
}

function postSessionToSandbox(frame = sandboxFrame) {
  const payload = buildSessionPayload();
  if (!payload || !frame?.contentWindow) {
    return;
  }
  frame.contentWindow.postMessage(payload, '*');
}

function syncSessionToSandbox() {
  runWhenPreviewReady(() => postSessionToSandbox(sandboxFrame));
}

function onAuthSuccess({ user, token, provider, credits, deferRender = false }) {
  const resolvedCredits = resolveCredits(credits);
  const planLabel = user?.plan || user?.plan_tier || user?.planTier || 'Free';
  const storedToken = window.localStorage?.getItem('maya_token');
  const resolvedToken = token
    || storedToken
    || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `token-${Date.now()}`);
  Auth.user = user;
  Auth.token = resolvedToken;
  Auth.provider = provider;
  persistSessionStorage({ user, token: resolvedToken });
  currentUser = {
    ...user,
    plan: planLabel,
    creditsRemaining: resolvedCredits
  };

  window.localStorage?.setItem('maya_credits', `${resolvedCredits}`);

  document.body.classList.remove('unauthenticated');
  applyAuthToRoot();
  updateCreditsUI(resolvedCredits);
  renderUserHeader();
  renderCredits();

  uiState = UI_STATE.APP;
  showAnalytics = false;
  if (!deferRender) {
    renderUI();
    ModalManager.close();
  }

  syncSessionToSandbox();
  refreshAuthDebug();
}

async function handleGoogleCredential(response) {
  markAuthAttempt('google');
  const res = await fetch(`${API_BASE}/api/auth/google`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    // Google Identity Services returns a JWT ID token via response.credential.
    // Send as id_token to align with backend expectations.
    body: JSON.stringify({ id_token: response.credential })
  });

  const data = await res.json().catch(() => ({}));
  lastGoogleAuthStatus = `${res.status}`;
  lastGoogleAuthJson = data && typeof data === 'object'
    ? JSON.stringify(data)
    : String(data ?? '—');
  if (!res.ok) {
    console.warn('Google auth failed.', data);
    refreshAuthDebug();
    return;
  }

  const meRes = await fetch(`${API_BASE}/api/me`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!meRes.ok) {
    console.error('Failed to fetch /me', meRes.status);
    refreshAuthDebug();
    return;
  }

  const meData = await meRes.json().catch(() => ({}));
  const user = meData?.user;
  Auth.user = user ?? null;
  Auth.token = Auth.token
    || window.localStorage?.getItem('maya_token')
    || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `token-${Date.now()}`);
  Auth.provider = user?.provider ?? 'google';
  applyAuthToRoot();
  updateCreditsUI(user?.creditsRemaining ?? 500);
  bootstrapAuthenticatedUI({
    ...user,
    plan: user?.plan ?? 'Free',
    creditsRemaining: user?.creditsRemaining ?? 500
  });
  refreshAuthDebug();
}

AuthController.register('google', () => {
  const container = document.getElementById('google-signin');
  if (!container) return;

  if (!window.GOOGLE_CLIENT_ID) {
    container.innerHTML = `
      <div class="auth-error">
        Missing GOOGLE_CLIENT_ID.<br/>
        Check env injection.
      </div>
    `;
    return;
  }

  let resolved = false;

  const fail = () => {
    if (resolved) return;
    resolved = true;

    container.innerHTML = `
      <button class="auth-btn" disabled>
        Google unavailable
      </button>
    `;
  };

  const tryInit = () => {
    if (!window.google?.accounts?.id) return false;

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      ux_mode: 'popup'
    });

    google.accounts.id.renderButton(container, {
      theme: 'outline',
      size: 'large',
      width: 360,
      text: 'continue_with'
    });

    resolved = true;
    return true;
  };

  // Try immediately
  if (tryInit()) return;

  // Retry briefly
  const interval = setInterval(() => {
    if (tryInit()) {
      clearInterval(interval);
    }
  }, 50);

  // Hard timeout (2.5s)
  setTimeout(() => {
    clearInterval(interval);
    fail();
  }, 2500);
});

AuthController.register('email', () => {
  EmailAuthSlot.init();
});

let appleAuthInitAttempts = 0;
function initAppleAuth() {
  const button = document.querySelector('.auth-slot[data-provider="apple"] .auth-btn');
  if (!button) {
    return;
  }
  if (button.dataset.authInitialized === 'true') {
    return;
  }
  if (!window.AppleID?.auth) {
    if (appleAuthInitAttempts < 10) {
      appleAuthInitAttempts += 1;
      setTimeout(initAppleAuth, 200);
    }
    return;
  }
  if (!APPLE_CLIENT_ID || !APPLE_REDIRECT_URI) {
    console.warn('Apple auth configuration missing.');
    return;
  }

  window.AppleID.auth.init({
    clientId: APPLE_CLIENT_ID,
    scope: 'name email',
    redirectURI: APPLE_REDIRECT_URI,
    usePopup: true
  });

  button.onclick = async () => {
    markAuthAttempt('apple');
    const res = await window.AppleID.auth.signIn();
    const auth = res.authorization;

    const server = await fetch('/auth/apple', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: auth.code })
    });

    const data = await server.json();
    onAuthSuccess({
      user: data.user,
      token: data.token,
      provider: 'apple',
      credits: data.credits
    });
  };
  button.dataset.authInitialized = 'true';
}

AuthController.register('apple', initAppleAuth);

const NUDGE_COPY = {
  monthly_soft: {
    inApp: {
      message:
        'Heads up: you’re about halfway through your monthly credits. Pro users get higher limits and faster generations.',
      primaryCta: 'View plans'
    },
    email: {
      subject: 'You’re building fast — want more room?',
      body: 'You generated 14 interactive UIs this month. Pro plans unlock higher limits and faster generations.'
    }
  },
  daily_soft: {
    inApp: {
      message:
        'You’re past 70% of today’s credits. Pro plans raise daily limits to keep momentum up.',
      primaryCta: 'View plans'
    },
    email: {
      subject: 'Daily limits are getting tight',
      body: 'You’re moving quickly. Pro plans unlock higher daily caps and more uninterrupted runs.'
    }
  },
  large_soft: {
    inApp: {
      message:
        'You’ve run a few large generations. Pro gives you more headroom for complex builds.',
      primaryCta: 'View plans'
    },
    email: {
      subject: 'Handling bigger generations?',
      body: 'Looks like you’re running larger builds. Pro keeps large generations smooth with higher limits.'
    }
  },
  monthly_firm: {
    inApp: {
      message:
        'You’re close to your monthly limit. Upgrade now to avoid interruptions on complex generations.',
      primaryCta: 'Upgrade',
      secondaryCta: 'Remind me later'
    },
    email: {
      subject: 'Don’t let limits interrupt your next build',
      body: 'You have 15% of your monthly credits left. Upgrade for uninterrupted generations.'
    }
  },
  daily_firm: {
    inApp: {
      message:
        'You’ve hit daily throttles a couple times this week. Upgrade to remove most slowdowns.',
      primaryCta: 'Upgrade',
      secondaryCta: 'Remind me later'
    },
    email: {
      subject: 'Daily throttles are slowing you down',
      body: 'Upgrade for higher daily limits and fewer slowdowns.'
    }
  },
  hard_stop: {
    inApp: {
      message:
        'You’ve hit your monthly limit. Upgrade to keep generating today.',
      primaryCta: 'Upgrade'
    },
    email: {
      subject: 'You’ve hit your monthly limit',
      body: 'Your credits reset next month. Upgrade to keep generating now.'
    }
  }
};

let lastRequestThrottled = false;

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function startAnalyticsModalWatchdog() {
  if (!analyticsModalState.open) {
    return;
  }
  if (analyticsModalState.watchdogId) {
    clearTimeout(analyticsModalState.watchdogId);
  }
  analyticsModalState.watchdogId = window.setTimeout(() => {
    if (!analyticsModalState.open) {
      return;
    }
    console.warn('Analytics modal watchdog triggered');
    analyticsModalState.loading = false;
    analyticsModalState.error = 'Analytics took too long to load.';
  }, 5000);
}

function clearAnalyticsModalWatchdog() {
  if (analyticsModalState.watchdogId) {
    clearTimeout(analyticsModalState.watchdogId);
    analyticsModalState.watchdogId = null;
  }
}

const ModalManager = (() => {
  const modalRoot = document.getElementById('modal-root');
  let closeHandler = null;
  let dismissible = false;

  const close = () => {
    if (!modalRoot) {
      return;
    }
    modalRoot.classList.add('hidden');
    modalRoot.innerHTML = '';
    modalRoot.setAttribute('aria-hidden', 'true');
    if (closeHandler) {
      closeHandler();
      closeHandler = null;
    }
    dismissible = false;
  };

  if (modalRoot) {
    modalRoot.addEventListener('click', (event) => {
      if (!dismissible) {
        return;
      }
      if (event.target === modalRoot) {
        close();
      }
    });
  }

  return {
    open(html, { onClose = null, dismissible: allowDismiss = false } = {}) {
      if (!modalRoot) {
        return;
      }
      closeHandler = onClose;
      dismissible = allowDismiss;
      modalRoot.innerHTML = `<div class="modal-panel">${html}</div>`;
      modalRoot.classList.remove('hidden');
      modalRoot.setAttribute('aria-hidden', 'false');
    },
    close
  };
})();

window.ModalManager = ModalManager;

function getAuthenticatedUser() {
  if (!Auth.token || !Auth.user) {
    return null;
  }
  return Auth.user;
}

function setAuthenticatedUser(user, provider) {
  Auth.user = user;
  Auth.provider = provider;
  Auth.token = Auth.token
    || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `token-${Date.now()}`);
  applyAuthToRoot();
}

function clearChatState() {
  if (chatMessages) {
    chatMessages.innerHTML = '';
  }
  if (chatInput) {
    chatInput.value = '';
  }
  chatFinalized = false;
  currentTurnMessageId = null;
  pendingAssistantProposal = null;
  intentAnchor = null;
  chatState.locked = false;
  if (chatState.unlockTimerId) {
    clearTimeout(chatState.unlockTimerId);
    chatState.unlockTimerId = null;
  }
}

function clearEditorState() {
  if (!codeEditor) {
    return;
  }
  codeEditor.value = defaultInterfaceCode;
  baselineCode = defaultInterfaceCode;
  currentCode = defaultInterfaceCode;
  previousCode = null;
  lastLLMCode = null;
  lastRunCode = null;
  lastRunSource = null;
  lastCodeSource = null;
  userHasEditedCode = false;
  updateLineNumbers();
}

function clearPreviewState() {
  if (sandboxFrame) {
    sandboxFrame.src = 'about:blank';
  }
}

function resetAppToUnauthed() {
  document.body.classList.add('unauthenticated');
  uiState = UI_STATE.AUTH;
  closeAllModals();
  root?.classList.add('hidden');
  showAuthModal();
}

async function signOut() {
  console.log('🔒 Signing out user');

  try {
    if (Auth.provider === 'google' && window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    if (Auth.provider === 'apple') {
      // Apple has no JS revoke; handled server-side
    }
  } catch (err) {
    console.warn('Auth provider cleanup failed', err);
  }

  Auth.user = null;
  Auth.token = null;
  Auth.provider = null;
  clearAuthFromRoot();

  AUTH_STORAGE_KEYS.forEach((key) => window.localStorage?.removeItem(key));
  window.sessionStorage?.clear();

  ModalManager.close();
  clearChatState();
  clearEditorState();
  clearPreviewState();
  resetExecutionPreparation();
  resetAppToUnauthed();

  console.log('✅ Signed out cleanly');
}

function renderAuth() {
  resetAppToUnauthed();
}

function initializeAppForAuthenticatedUser() {
  if (appInitialized) {
    return;
  }
  appInitialized = true;
  updateCreditUI();
  refreshAnalyticsAndThrottle({ force: false }).catch((error) => {
    console.warn('Usage analytics refresh failed.', error);
  });
}

function renderApp() {
  document.body.classList.remove('unauthenticated');
  ModalManager.close();
  root?.classList.remove('hidden');
  initializeAppForAuthenticatedUser();
}

function renderUI() {
  if (uiState === UI_STATE.AUTH) {
    showAnalytics = false;
    renderAuth();
    return;
  }
  renderApp();
  if (showAnalytics) {
    openUsageModal();
  } else {
    closeUsageModal();
  }
}

async function hydrateSessionFromServer() {
  try {
    const res = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
    if (res.ok) {
      return await res.json();
    }
    if (res.status === 401) {
      Auth.user = null;
      Auth.token = null;
      Auth.provider = null;
    }
  } catch (error) {
    console.warn('Failed to bootstrap session from server.', error);
  }
  return null;
}

async function checkEmailVerification() {
  const url = new URL(window.location.href);
  if (url.pathname !== '/auth/email') {
    return false;
  }
  const token = url.searchParams.get('token');
  if (!token) {
    return false;
  }
  try {
    const res = await fetch(`${API_BASE}/api/auth/email/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!res.ok) {
      return false;
    }
    const data = await res.json().catch(() => ({}));
    const session = data?.session || data;
    if (session?.user && session?.token) {
      persistSessionStorage(session);
    }
    window.history.replaceState({}, '', '/');
    return true;
  } catch (error) {
    console.warn('Failed to verify email token.', error);
    return false;
  }
}

async function bootstrapApp() {
  await checkEmailVerification();
  const sessionData = await hydrateSessionFromServer();
  if (sessionData?.user) {
    onAuthSuccess({
      user: sessionData.user,
      token: sessionData.token,
      provider: sessionData.user?.provider || sessionData.provider,
      credits: sessionData.credits,
      deferRender: true
    });
  }
  initAuthDebugPanel();
  hydrateCreditState();
  applyAuthToRoot();
  const user = getAuthenticatedUser();
  if (!user) {
    uiState = UI_STATE.AUTH;
    showAnalytics = false;
    resetAppToUnauthed();
    return;
  }
  uiState = UI_STATE.APP;
  showAnalytics = false;
  renderApp();
}

function onAnalyticsClick() {
  if (uiState !== UI_STATE.APP) {
    return;
  }
  showAnalytics = true;
  renderUI();
}

function closeAllModals() {
  closeUsageModal();
  hidePaywall();
}

function unlockUI() {
  unlockChat();
  stopLoading();
  document.body.style.overflow = '';
}

const sessionId = (() => {
  if (typeof window === 'undefined') {
    return '';
  }
  const stored = window.sessionStorage?.getItem('mayaSessionId');
  if (stored) {
    return stored;
  }
  const created = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage?.setItem('mayaSessionId', created);
  return created;
})();

const isDev = window.location.hostname === 'localhost'
  || window.location.hostname === '127.0.0.1';

let lastThrottleState = { state: 'ok', remaining: 0 };

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

function updateLineNumbers() {
  if (!codeEditor || !lineNumbersEl || !lineCountEl) {
    return;
  }
  const lines = codeEditor.value.split('\n').length;
  let numbers = '';
  for (let i = 1; i <= lines; i += 1) {
    numbers += `${i}\n`;
  }
  lineNumbersEl.textContent = numbers;
  lineCountEl.textContent = `Lines: ${lines}`;
}

function getCreditState() {
  const root = document.getElementById('root');
  const remainingCredits = Number.parseInt(root?.dataset.remainingCredits ?? '', 10);
  const freeTierRemaining = Number.parseInt(root?.dataset.freeTierRemaining ?? '', 10);
  const planLabel = root?.dataset.planLabel?.trim() || '';
  const creditsTotal = Number.parseInt(root?.dataset.creditsTotal ?? '', 10);
  const resetDays = Number.parseInt(root?.dataset.creditsResetDays ?? '', 10);
  const dailyLimit = Number.parseInt(root?.dataset.dailyLimit ?? '', 10);
  const todayCreditsUsed = Number.parseInt(root?.dataset.todayCreditsUsed ?? '', 10);
  const dailyResetTime = root?.dataset.dailyResetTime?.trim() || '';
  return {
    remainingCredits: Number.isFinite(remainingCredits) ? remainingCredits : null,
    freeTierRemaining: Number.isFinite(freeTierRemaining) ? freeTierRemaining : null,
    planLabel: planLabel || null,
    isFreeTier: planLabel.toLowerCase() === 'free',
    creditsTotal: Number.isFinite(creditsTotal) ? creditsTotal : null,
    resetDays: Number.isFinite(resetDays) ? resetDays : null,
    dailyLimit: Number.isFinite(dailyLimit) ? dailyLimit : null,
    todayCreditsUsed: Number.isFinite(todayCreditsUsed) ? todayCreditsUsed : null,
    dailyResetTime
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCreditUsagePercent(remaining, total) {
  if (!Number.isFinite(remaining) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  const used = (total - remaining) / total;
  return clamp(used, 0, 1);
}

function getDailyUsagePercent(used, limit) {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }
  return clamp(used / limit, 0, 1);
}

function loadNudgeState(userId) {
  if (!userId || !window.localStorage) {
    return {
      user_id: userId || null,
      last_nudge_type: null,
      last_nudge_at: 0,
      dismissed_until: 0,
      throttle_hits: [],
      large_generations: []
    };
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(NUDGE_STATE_KEY) || '{}');
    if (stored.user_id !== userId) {
      return {
        user_id: userId,
        last_nudge_type: null,
        last_nudge_at: 0,
        dismissed_until: 0,
        throttle_hits: [],
        large_generations: []
      };
    }
    return {
      user_id: userId,
      last_nudge_type: stored.last_nudge_type ?? null,
      last_nudge_at: stored.last_nudge_at ?? 0,
      dismissed_until: stored.dismissed_until ?? 0,
      throttle_hits: Array.isArray(stored.throttle_hits) ? stored.throttle_hits : [],
      large_generations: Array.isArray(stored.large_generations) ? stored.large_generations : []
    };
  } catch {
    return {
      user_id: userId,
      last_nudge_type: null,
      last_nudge_at: 0,
      dismissed_until: 0,
      throttle_hits: [],
      large_generations: []
    };
  }
}

function saveNudgeState(state) {
  if (!state || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(NUDGE_STATE_KEY, JSON.stringify(state));
}

function pruneTimestamps(entries, windowMs) {
  const cutoff = Date.now() - windowMs;
  return entries.filter((timestamp) => timestamp >= cutoff);
}

function recordThrottleHit(userId) {
  if (!userId) {
    return null;
  }
  const state = loadNudgeState(userId);
  state.throttle_hits = pruneTimestamps(state.throttle_hits, THROTTLE_HIT_WINDOW_MS);
  state.throttle_hits.push(Date.now());
  saveNudgeState(state);
  return state;
}

function recordLargeGeneration(userId, tokenEstimate) {
  if (!userId) {
    return null;
  }
  if (!Number.isFinite(tokenEstimate) || tokenEstimate < LARGE_GENERATION_TOKEN_THRESHOLD) {
    return null;
  }
  const state = loadNudgeState(userId);
  state.large_generations = pruneTimestamps(state.large_generations, LARGE_GENERATION_WINDOW_MS);
  state.large_generations.push(Date.now());
  saveNudgeState(state);
  return state;
}

function hasNudgeCooldown(state) {
  if (!state) {
    return false;
  }
  return Number.isFinite(state.dismissed_until) && state.dismissed_until > Date.now();
}

function hasShownNudgeThisSession() {
  return Boolean(window.sessionStorage?.getItem(NUDGE_SESSION_KEY));
}

function markNudgeShown(state, type) {
  if (!state) {
    return;
  }
  state.last_nudge_type = type;
  state.last_nudge_at = Date.now();
  saveNudgeState(state);
  window.sessionStorage?.setItem(NUDGE_SESSION_KEY, 'true');
}

function markNudgeDismissed(state) {
  if (!state) {
    return;
  }
  state.dismissed_until = Date.now() + NUDGE_DISMISS_MS;
  saveNudgeState(state);
}

function computeThrottleState({
  creditsUsedToday,
  dailyLimit,
  estimatedNextCost
}) {
  if (creditsUsedToday >= dailyLimit) {
    return { state: 'blocked', remaining: 0, reason: 'daily_limit' };
  }

  if (creditsUsedToday + estimatedNextCost > dailyLimit) {
    return {
      state: 'warning',
      remaining: Math.max(0, dailyLimit - creditsUsedToday),
      reason: 'estimate_high'
    };
  }

  return {
    state: 'ok',
    remaining: dailyLimit - creditsUsedToday,
    reason: 'ok'
  };
}

function isSandboxExecuting() {
  return previewExecutionStatus?.classList.contains('running') || sandboxAnimationState === 'running';
}

function canShowPaywall() {
  return !isGenerating && !isSandboxExecuting();
}

const isFirstSession = (() => {
  if (!window.sessionStorage) {
    return false;
  }
  const hasSeen = sessionStorage.getItem(PAYWALL_FIRST_SESSION_KEY);
  if (hasSeen) {
    return false;
  }
  sessionStorage.setItem(PAYWALL_FIRST_SESSION_KEY, 'true');
  return true;
})();

function ensurePaywallFirstSeen() {
  if (!window.localStorage) {
    return null;
  }
  const existing = localStorage.getItem(PAYWALL_FIRST_SEEN_KEY);
  if (existing) {
    return Number(existing);
  }
  const now = Date.now();
  localStorage.setItem(PAYWALL_FIRST_SEEN_KEY, String(now));
  return now;
}

function isWithinFirstDay() {
  const firstSeen = ensurePaywallFirstSeen();
  if (!Number.isFinite(firstSeen)) {
    return false;
  }
  return Date.now() - firstSeen < 24 * 60 * 60 * 1000;
}

function hasPaywallUpgradeCompleted() {
  return window.localStorage?.getItem(PAYWALL_UPGRADE_KEY) === 'true';
}

function markPaywallUpgradeCompleted() {
  if (window.localStorage) {
    window.localStorage.setItem(PAYWALL_UPGRADE_KEY, 'true');
  }
}

function isPaywallDismissed() {
  const dismissedAt = Number(window.localStorage?.getItem(PAYWALL_DISMISS_KEY));
  return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < PAYWALL_DISMISS_MS;
}

function dismissPaywallForPeriod() {
  if (window.localStorage) {
    window.localStorage.setItem(PAYWALL_DISMISS_KEY, String(Date.now()));
  }
}

function suppressPaywallForSession() {
  if (window.sessionStorage) {
    window.sessionStorage.setItem(PAYWALL_SUPPRESS_SESSION_KEY, 'true');
  }
}

function isPaywallSuppressedForSession() {
  return window.sessionStorage?.getItem(PAYWALL_SUPPRESS_SESSION_KEY) === 'true';
}

function getStoredPaywallPlan() {
  return window.localStorage?.getItem(PAYWALL_SELECTED_PLAN_KEY);
}

function setStoredPaywallPlan(plan) {
  if (window.localStorage) {
    window.localStorage.setItem(PAYWALL_SELECTED_PLAN_KEY, plan);
  }
}

function updatePaywallPlanSelection(plan) {
  if (!paywallModal) {
    return;
  }
  const normalized = plan === 'pro' ? 'pro' : 'starter';
  setStoredPaywallPlan(normalized);
  paywallModal.dataset.selectedPlan = normalized;
  paywallPlanButtons.forEach((button) => {
    const isSelected = button.dataset.paywallPlan === normalized;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
  paywallPlanCells.forEach((cell) => {
    const isSelected = cell.dataset.paywallPlanCell === normalized;
    cell.classList.toggle('is-selected', isSelected);
  });
  paywallPlanCards.forEach((card) => {
    const isSelected = card.dataset.paywallPlanCard === normalized;
    card.classList.toggle('is-selected', isSelected);
    card.classList.toggle('hidden', !isSelected);
  });
}

function setPaywallVisibility(visible, { dismissable = false } = {}) {
  if (!paywallModal) {
    return;
  }
  paywallModal.classList.toggle('hidden', !visible);
  paywallModal.classList.toggle('dismissable', dismissable);
  isPaywallVisible = visible;
  if (visible) {
    document.body.style.overflow = 'hidden';
  } else if (!usageModal || usageModal.classList.contains('hidden')) {
    document.body.style.overflow = '';
  }
  if (isDev) {
    console.assert(
      !isGenerating || !isPaywallVisible,
      'Paywall must not show during generation'
    );
  }
}

function hidePaywall() {
  setPaywallVisibility(false, { dismissable: false });
}

function openStripeCheckout(mode) {
  const checkoutUrl = mode === 'subscription'
    ? '/checkout/subscription'
    : '/checkout/credits';
  window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
}

function setPaywallMode(mode) {
  if (!paywallModal) {
    return;
  }
  paywallModal.dataset.mode = mode;
  if (paywallCompactSection) {
    paywallCompactSection.classList.toggle('hidden', mode !== 'soft');
  }
  if (paywallCompareSection) {
    paywallCompareSection.classList.toggle('hidden', mode === 'soft');
  }
}

function updatePaywallCtas(mode, selectedPlan) {
  if (!paywallPrimaryButton || !paywallSecondaryButton || !paywallTertiaryButton) {
    return;
  }
  const planLabel = selectedPlan === 'pro' ? 'Pro' : 'Starter';
  if (mode === 'soft') {
    paywallPrimaryButton.textContent = 'View upgrade options';
    paywallPrimaryButton.onclick = () => {
      setPaywallMode('firm');
      updatePaywallCtas('firm', selectedPlan);
    };
  } else {
    paywallPrimaryButton.textContent = `Upgrade to ${planLabel}`;
    paywallPrimaryButton.onclick = () => openStripeCheckout('subscription');
  }

  paywallSecondaryButton.textContent = 'Compare plans';
  paywallSecondaryButton.onclick = () => {
    suppressPaywallForSession();
    setPaywallMode('firm');
    updatePaywallCtas('firm', selectedPlan);
  };

  paywallTertiaryButton.textContent = 'Maybe later';
  paywallTertiaryButton.classList.remove('hidden');
  paywallTertiaryButton.onclick = () => {
    dismissPaywallForPeriod();
    hidePaywall();
  };
}

function showPaywall({ reason, estimate, remaining, modeOverride } = {}) {
  if (!paywallModal || !canShowPaywall() || hasPaywallUpgradeCompleted()) {
    return false;
  }

  const creditState = getCreditState();
  const usagePercent = getCreditUsagePercent(creditState.remainingCredits, creditState.creditsTotal);
  const resetDays = creditState.resetDays ?? 0;
  const dailyResetTime = creditState.dailyResetTime || 'tomorrow';
  const isMonthlyExhausted = reason === 'monthly';
  const isDailyLimit = reason === 'daily_limit';
  const isPreventive = reason === 'estimate_high';
  const isHardStop = isMonthlyExhausted && creditState.isFreeTier;
  let mode = modeOverride;

  if (!mode) {
    if (isHardStop) {
      mode = 'hard';
    } else if (isDailyLimit || isPreventive || (usagePercent !== null && usagePercent >= MONTHLY_FIRM_USAGE_THRESHOLD)) {
      mode = 'firm';
    } else {
      mode = 'soft';
    }
  }

  setPaywallMode(mode);

  if (paywallTitle) {
    if (isHardStop) {
      paywallTitle.textContent = 'You’ve reached your monthly limit';
    } else if (isPreventive) {
      paywallTitle.textContent = 'This request exceeds your current plan';
    } else if (mode === 'firm') {
      paywallTitle.textContent = 'Upgrade for uninterrupted generation';
    } else {
      paywallTitle.textContent = 'You’re nearing your usage limit';
    }
  }

  if (paywallSubtext) {
    if (isHardStop) {
      paywallSubtext.textContent =
        'Upgrade to continue generating today, or wait until your credits reset.';
    } else if (usagePercent !== null) {
      const percent = Math.round(usagePercent * 100);
      paywallSubtext.textContent =
        `You’ve used ${percent}% of your monthly credits. Pro plans increase limits and reduce throttling.`;
    } else {
      paywallSubtext.textContent =
        `More credits unlock in ${dailyResetTime}.`;
    }
  }

  if (paywallCurrentPlan) {
    paywallCurrentPlan.textContent = creditState.planLabel || 'Free';
  }

  if (paywallCreditsRemaining) {
    const remainingText = Number.isFinite(creditState.remainingCredits)
      && Number.isFinite(creditState.creditsTotal)
      ? `${formatCreditNumber(creditState.remainingCredits)} / ${formatCreditNumber(creditState.creditsTotal)}`
      : '—';
    paywallCreditsRemaining.textContent = remainingText;
  }

  if (paywallDailyThrottle) {
    const dailyRemaining = Number.isFinite(creditState.dailyLimit)
      && Number.isFinite(creditState.todayCreditsUsed)
      ? Math.max(0, creditState.dailyLimit - creditState.todayCreditsUsed)
      : null;
    if (dailyRemaining !== null) {
      paywallDailyThrottle.textContent = `${formatCreditNumber(dailyRemaining)} credits left today`;
    } else {
      paywallDailyThrottle.textContent = '—';
    }
  }

  if (paywallCostLine) {
    const costTextNode = paywallCostLine.firstChild;
    const estimateText = estimate?.estimated && estimate?.reserved
      ? `Estimated cost: ~${formatCreditNumber(estimate.estimated)} credits (reserving ${formatCreditNumber(estimate.reserved)}).`
      : '';
    if (costTextNode && costTextNode.nodeType === Node.TEXT_NODE) {
      if (isPreventive && estimateText) {
        costTextNode.textContent = `${estimateText} `;
      } else if (isMonthlyExhausted) {
        costTextNode.textContent =
          `Credits reset in ${resetDays} days. `;
      } else if (isDailyLimit) {
        costTextNode.textContent =
          `More credits unlock in ${dailyResetTime}. `;
      } else {
        costTextNode.textContent =
          'Credits abstract API costs. On your usage, Starter covers ~10× more generations than Free. ';
      }
    }
  }

  if (paywallFooter) {
    paywallFooter.classList.toggle('hidden', !getUserContext().id);
  }

  const preferredPlan = (() => {
    const stored = getStoredPaywallPlan();
    if (stored === 'pro' || stored === 'starter') {
      return stored;
    }
    if (creditState.planLabel && creditState.planLabel.toLowerCase() !== 'free') {
      return 'pro';
    }
    if (usagePercent !== null && usagePercent >= 0.9) {
      return 'pro';
    }
    return 'starter';
  })();

  updatePaywallPlanSelection(preferredPlan);
  updatePaywallCtas(mode, preferredPlan);

  if (paywallCloseButton) {
    paywallCloseButton.classList.toggle('hidden', mode === 'hard');
  }

  setPaywallVisibility(true, { dismissable: mode !== 'hard' });
  return true;
}

function shouldSuppressPaywallNudge() {
  if (hasPaywallUpgradeCompleted()) {
    return true;
  }
  if (isFirstSession || isWithinFirstDay()) {
    return true;
  }
  if (isPaywallDismissed() || isPaywallSuppressedForSession()) {
    return true;
  }
  return false;
}

function maybeShowUsagePaywall({ reason = 'usage' } = {}) {
  if (!paywallModal || !canShowPaywall()) {
    return false;
  }
  const creditState = getCreditState();
  const usagePercent = getCreditUsagePercent(creditState.remainingCredits, creditState.creditsTotal);
  if (usagePercent === null || usagePercent < MONTHLY_SOFT_USAGE_THRESHOLD) {
    return false;
  }
  if (shouldSuppressPaywallNudge()) {
    return false;
  }
  const mode = usagePercent >= MONTHLY_FIRM_USAGE_THRESHOLD ? 'firm' : 'soft';
  return showPaywall({ reason, modeOverride: mode });
}

function getUserContext() {
  const root = document.getElementById('root');
  const remainingCredits = Number.parseInt(root?.dataset.remainingCredits ?? '', 10);
  const dailyLimit = Number.parseInt(root?.dataset.dailyLimit ?? '', 10);
  const todayCreditsUsed = Number.parseInt(root?.dataset.todayCreditsUsed ?? '', 10);
  return {
    id: root?.dataset.userId || '',
    email: root?.dataset.email || '',
    remainingCredits: Number.isFinite(remainingCredits) ? remainingCredits : null,
    dailyLimit: Number.isFinite(dailyLimit) ? dailyLimit : null,
    todayCreditsUsed: Number.isFinite(todayCreditsUsed) ? todayCreditsUsed : null
  };
}

function parseAnalyticsSummary(payload) {
  const summary = payload?.summary ?? payload?.analytics ?? payload?.data ?? payload ?? {};
  const dailyLimit = Number(summary.daily_limit ?? summary.dailyLimit);
  const creditsUsedToday = Number(
    summary.credits_used_today
    ?? summary.creditsUsedToday
    ?? summary.credits_used
    ?? summary.creditsUsed
  );
  return {
    dailyLimit: Number.isFinite(dailyLimit) ? dailyLimit : null,
    creditsUsedToday: Number.isFinite(creditsUsedToday) ? creditsUsedToday : null
  };
}

function applyAnalyticsSummary(summary) {
  const root = document.getElementById('root');
  if (!root || !summary) {
    return;
  }
  if (Number.isFinite(summary.dailyLimit)) {
    root.dataset.dailyLimit = `${summary.dailyLimit}`;
  }
  if (Number.isFinite(summary.creditsUsedToday)) {
    root.dataset.todayCreditsUsed = `${summary.creditsUsedToday}`;
  }
}

async function fetchUsageAnalytics({ force = false } = {}) {
  const now = Date.now();
  if (!force && analyticsCache.data && now - analyticsCache.fetchedAt < ANALYTICS_CACHE_TTL_MS) {
    return analyticsCache.data;
  }

  const context = getUserContext();
  if (!context.id) {
    return null;
  }

  try {
    const res = await withTimeout(
      fetch(`/usage/analytics?user_id=${encodeURIComponent(context.id)}&days=1`, {
        cache: 'no-store'
      }),
      ANALYTICS_TIMEOUT_MS,
      'Analytics request timed out'
    );

    if (!res.ok) {
      return null;
    }

    const data = await withTimeout(
      res.json(),
      ANALYTICS_TIMEOUT_MS,
      'Analytics response timed out'
    );
    analyticsCache.data = data;
    analyticsCache.fetchedAt = now;
    return data;
  } catch (error) {
    console.warn('Usage analytics fetch failed.', error);
    return null;
  }
}

function parseCsvRow(row) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function parseCsv(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const lines = trimmed.split(/\r?\n/);
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvRow(line);
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? '';
      return acc;
    }, {});
  });
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatSeconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s';
  }
  const seconds = ms / 1000;
  if (seconds >= 1) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${Math.round(value * 100)}%`;
}

function formatRequestId(id, isAdmin) {
  if (isAdmin || !id) {
    return id || 'n/a';
  }
  const suffix = id.slice(-4);
  return `req_••••${suffix}`;
}

function getFallbackUsageRows(userId, email) {
  const today = new Date();
  const intents = ['code', 'text'];
  return Array.from({ length: 28 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (27 - index));
    const daySeed = index + 1;
    const entries = Math.max(4, Math.round(6 + Math.sin(daySeed) * 4));
    return Array.from({ length: entries }, (__, entryIndex) => {
      const intent = intents[(entryIndex + index) % intents.length];
      const credits = intent === 'code' ? 60 + entryIndex * 6 : 24 + entryIndex * 2;
      return {
        timestamp_utc: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9 + entryIndex).toISOString(),
        user_id: userId,
        email,
        session_id: `session_${daySeed}`,
        request_id: `req_${daySeed}_${entryIndex}`,
        intent_type: intent,
        model: 'gpt-4.1-mini',
        input_chars: 1800,
        input_est_tokens: 450,
        output_chars: 820,
        output_est_tokens: 270,
        total_est_tokens: 720,
        credits_charged: credits,
        latency_ms: 1800 + entryIndex * 120,
        status: entryIndex % 6 === 0 ? 'error' : 'success'
      };
    });
  }).flat();
}

function getFallbackUserRows(userId, email) {
  return [
    {
      user_id: userId,
      email,
      display_name: 'Demo User',
      plan_tier: 'starter',
      credits_total: 5000,
      credits_remaining: 4182
    },
    {
      user_id: 'user_studio',
      email: 'studio@maya.dev',
      display_name: 'Studio',
      plan_tier: 'power',
      credits_total: 100000,
      credits_remaining: 86000
    }
  ];
}

async function loadUsageCsv() {
  const now = Date.now();
  if (usageCache.usageRows && now - usageCache.fetchedAt < USAGE_CACHE_TTL_MS) {
    return { usageRows: usageCache.usageRows, userRows: usageCache.userRows };
  }

  const [usageRes, usersRes] = await Promise.all([
    withTimeout(
      fetch('data/usage_log.csv', { cache: 'no-store' }),
      USAGE_FETCH_TIMEOUT_MS,
      'Usage log request timed out'
    ),
    withTimeout(
      fetch('data/users.csv', { cache: 'no-store' }),
      USAGE_FETCH_TIMEOUT_MS,
      'Usage users request timed out'
    )
  ]);

  const [usageText, usersText] = await Promise.all([
    usageRes.ok
      ? withTimeout(usageRes.text(), USAGE_FETCH_TIMEOUT_MS, 'Usage log response timed out')
      : '',
    usersRes.ok
      ? withTimeout(usersRes.text(), USAGE_FETCH_TIMEOUT_MS, 'Usage users response timed out')
      : ''
  ]);

  let usageRows = parseCsv(usageText);
  let userRows = parseCsv(usersText);

  const context = getUserContext();
  if (!usageRows.length) {
    usageRows = getFallbackUsageRows(context.id || 'user_demo', context.email || 'demo@maya.dev');
  }
  if (!userRows.length) {
    userRows = getFallbackUserRows(context.id || 'user_demo', context.email || 'demo@maya.dev');
  }

  usageCache.usageRows = usageRows;
  usageCache.userRows = userRows;
  usageCache.fetchedAt = now;
  return { usageRows, userRows };
}

function buildUsersById(userRows) {
  return userRows.reduce((acc, row) => {
    acc[row.user_id] = row;
    return acc;
  }, {});
}

function filterUsageRows(rows, filters, usersById, isAdmin) {
  return rows.filter((row) => {
    if (!isAdmin && filters.userId && row.user_id !== filters.userId) {
      return false;
    }
    if (filters.userId && filters.userId !== 'all' && row.user_id !== filters.userId) {
      return false;
    }
    if (filters.planTier && filters.planTier !== 'all') {
      const plan = usersById[row.user_id]?.plan_tier || 'free';
      if (plan !== filters.planTier) {
        return false;
      }
    }
    if (filters.startDate) {
      const day = row.timestamp_utc.slice(0, 10);
      if (day < filters.startDate) {
        return false;
      }
    }
    if (filters.endDate) {
      const day = row.timestamp_utc.slice(0, 10);
      if (day > filters.endDate) {
        return false;
      }
    }
    return true;
  });
}

function buildDailyAggregates(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const date = row.timestamp_utc.slice(0, 10);
    if (!map.has(date)) {
      map.set(date, {
        date,
        total_requests: 0,
        total_credits: 0,
        avg_latency_ms: 0,
        success_rate: 0,
        by_intent: { code: 0, text: 0 },
        entries: []
      });
    }
    const daily = map.get(date);
    const intent = row.intent_type || 'text';
    daily.total_requests += 1;
    daily.total_credits += toNumber(row.credits_charged);
    daily.avg_latency_ms += toNumber(row.latency_ms);
    daily.by_intent[intent] = (daily.by_intent[intent] || 0) + 1;
    daily.entries.push(row);
    if (row.status === 'success') {
      daily.success_rate += 1;
    }
  });

  return Array.from(map.values())
    .map((daily) => ({
      ...daily,
      avg_latency_ms: daily.total_requests ? daily.avg_latency_ms / daily.total_requests : 0,
      success_rate: daily.total_requests ? daily.success_rate / daily.total_requests : 0
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getMonthTotals(rows) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthRows = rows.filter((row) => row.timestamp_utc.startsWith(monthKey));
  const totalRequests = monthRows.length;
  const totalCredits = monthRows.reduce((sum, row) => sum + toNumber(row.credits_charged), 0);
  const totalLatency = monthRows.reduce((sum, row) => sum + toNumber(row.latency_ms), 0);
  const successCount = monthRows.filter((row) => row.status === 'success').length;
  return {
    totalRequests,
    totalCredits,
    avgLatency: totalRequests ? totalLatency / totalRequests : 0,
    successRate: totalRequests ? successCount / totalRequests : 0
  };
}

function getRangeLabel(days) {
  return `Last ${days} days`;
}

function clampDailyRange(dailyAggregates, rangeDays, startDate, endDate) {
  if (startDate || endDate) {
    return dailyAggregates;
  }
  const total = dailyAggregates.length;
  if (total <= rangeDays) {
    return dailyAggregates;
  }
  return dailyAggregates.slice(total - rangeDays);
}

function buildCreditsSplit(daily, freeRemaining) {
  let remaining = freeRemaining;
  return daily.map((entry) => {
    if (!Number.isFinite(remaining) || remaining <= 0) {
      return { free: 0, paid: entry.total_credits };
    }
    const free = Math.min(entry.total_credits, remaining);
    remaining -= free;
    return { free, paid: entry.total_credits - free };
  });
}

function buildUsageHistory(daily, isAdmin) {
  if (!usageHistoryBody || !usageHistoryEmpty) {
    return;
  }
  usageHistoryBody.innerHTML = '';
  if (!daily.length) {
    usageHistoryEmpty.classList.remove('hidden');
    return;
  }
  usageHistoryEmpty.classList.add('hidden');
  daily.slice().reverse().forEach((entry) => {
    const failures = entry.entries.filter((row) => row.status !== 'success').length;
    const rowEl = document.createElement('tr');
    rowEl.innerHTML = `
      <td>${entry.date}</td>
      <td>${formatNumber(entry.total_requests)}</td>
      <td>${formatNumber(entry.total_credits)}</td>
      <td>${formatSeconds(entry.avg_latency_ms)}</td>
      <td>${formatNumber(failures)}</td>
    `;
    usageHistoryBody.appendChild(rowEl);

    const detailsRow = document.createElement('tr');
    const detailsCell = document.createElement('td');
    detailsCell.colSpan = 5;
    const details = document.createElement('details');
    details.innerHTML = `<summary>View requests</summary>`;
    const list = document.createElement('div');
    list.className = 'usage-request-list';
    entry.entries.forEach((request) => {
      const item = document.createElement('div');
      item.className = 'usage-request-item';
      item.innerHTML = `
        <span class="usage-pill">${formatRequestId(request.request_id, isAdmin)}</span>
        <span>${request.intent_type || 'text'}</span>
        <span>${formatNumber(toNumber(request.credits_charged))} credits</span>
        <span>${formatSeconds(toNumber(request.latency_ms))}</span>
        <span class="usage-pill">${request.status}</span>
      `;
      list.appendChild(item);
    });
    details.appendChild(list);
    detailsCell.appendChild(details);
    detailsRow.appendChild(detailsCell);
    usageHistoryBody.appendChild(detailsRow);
  });
}

function destroyChart(chart) {
  if (chart) {
    chart.destroy();
  }
}

function renderCreditsChart(daily, creditState, isAdmin, planTier) {
  if (!usageCreditsChart || !window.Chart) {
    return;
  }
  destroyChart(usageState.charts.credits);
  const labels = daily.map((entry) => entry.date);
  const credits = daily.map((entry) => entry.total_credits);
  const cap = isAdmin
    ? (PLAN_DAILY_CAPS[planTier] || null)
    : creditState.dailyLimit;
  const freeRemaining = creditState.isFreeTier
    ? Number.MAX_SAFE_INTEGER
    : creditState.freeTierRemaining;
  const split = buildCreditsSplit(daily, freeRemaining);
  const freeData = split.map((entry) => entry.free);
  const paidData = split.map((entry) => entry.paid);
  usageState.charts.credits = new window.Chart(usageCreditsChart.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Free credits',
          data: freeData,
          fill: true,
          tension: 0.35,
          borderColor: 'rgba(106, 227, 190, 0.9)',
          backgroundColor: 'rgba(106, 227, 190, 0.25)',
          pointRadius: 2
        },
        {
          label: 'Paid credits',
          data: paidData,
          fill: true,
          tension: 0.35,
          borderColor: 'rgba(123, 169, 255, 0.9)',
          backgroundColor: 'rgba(123, 169, 255, 0.25)',
          pointRadius: 2
        },
        ...(Number.isFinite(cap) ? [{
          label: 'Daily cap',
          data: labels.map(() => cap),
          borderDash: [6, 6],
          borderColor: 'rgba(255, 255, 255, 0.4)',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false
        }] : [])
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#cfd4ff' } }
      },
      scales: {
        x: { ticks: { color: '#8c94c6' } },
        y: { ticks: { color: '#8c94c6' }, stacked: true }
      }
    }
  });
}

function renderRequestsChart(daily) {
  if (!usageRequestsChart || !window.Chart) {
    return;
  }
  destroyChart(usageState.charts.requests);
  const labels = daily.map((entry) => entry.date);
  const codeCounts = daily.map((entry) => entry.by_intent.code || 0);
  const textCounts = daily.map((entry) => entry.by_intent.text || 0);
  usageState.charts.requests = new window.Chart(usageRequestsChart.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Code',
          data: codeCounts,
          backgroundColor: 'rgba(114, 184, 255, 0.7)'
        },
        {
          label: 'Text',
          data: textCounts,
          backgroundColor: 'rgba(255, 199, 102, 0.7)'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#cfd4ff' } }
      },
      scales: {
        x: { stacked: true, ticks: { color: '#8c94c6' } },
        y: { stacked: true, ticks: { color: '#8c94c6' } }
      }
    }
  });
}

function renderLatencyChart(daily) {
  if (!usageLatencyChart || !window.Chart) {
    return;
  }
  destroyChart(usageState.charts.latency);
  const labels = daily.map((entry) => entry.date);
  const latencies = daily.map((entry) => entry.avg_latency_ms);
  usageState.charts.latency = new window.Chart(usageLatencyChart.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Avg latency',
          data: latencies,
          borderColor: 'rgba(255, 140, 140, 0.9)',
          backgroundColor: 'rgba(255, 140, 140, 0.2)',
          tension: 0.35,
          fill: true,
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#cfd4ff' } },
        tooltip: {
          callbacks: {
            title: (context) => context[0]?.label || '',
            label: (context) => `Avg latency: ${formatSeconds(context.parsed.y)}`,
            afterLabel: (context) => {
              const index = context.dataIndex;
              const entry = daily[index];
              return [
                `Requests: ${formatNumber(entry.total_requests)}`,
                `Credits: ${formatNumber(entry.total_credits)}`
              ];
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#8c94c6' } },
        y: { ticks: { color: '#8c94c6' } }
      }
    }
  });
}

function updateUsageCards(monthTotals, creditState) {
  if (!usageCreditsMonth || !usageRequestsMonth || !usageLatencyMonth || !usageSuccessMonth) {
    return;
  }
  const creditTotal = creditState.creditsTotal;
  const creditsText = creditTotal
    ? `${formatNumber(monthTotals.totalCredits)} / ${formatNumber(creditTotal)}`
    : formatNumber(monthTotals.totalCredits);
  usageCreditsMonth.textContent = creditsText;
  usageRequestsMonth.textContent = formatNumber(monthTotals.totalRequests);
  usageLatencyMonth.textContent = formatSeconds(monthTotals.avgLatency);
  usageSuccessMonth.textContent = formatPercent(monthTotals.successRate);
}

function updateUsageScopeLabel(isAdmin, filters) {
  if (!usageScopeLabel) {
    return;
  }
  if (isAdmin) {
    usageScopeLabel.textContent = 'Admin view · scoped by filters';
  } else if (filters.userId) {
    usageScopeLabel.textContent = 'Your usage this month';
  } else {
    usageScopeLabel.textContent = 'Usage summary';
  }
}

async function refreshUsageView() {
  if (analyticsModalState.open) {
    analyticsModalState.loading = true;
    analyticsModalState.error = null;
  }
  try {
    const { usageRows, userRows } = await loadUsageCsv();
    if (analyticsModalState.open) {
      analyticsModalState.data = { usageRows, userRows };
    }
    const isAdmin = window.location.pathname.startsWith('/admin/usage');
    const usersById = buildUsersById(userRows);
    const baseUserId = getUserContext().id;

    const filters = {
      userId: isAdmin ? (usageUserFilter?.value || 'all') : baseUserId,
      planTier: isAdmin ? (usagePlanFilter?.value || 'all') : 'all',
      startDate: isAdmin ? usageStartDate?.value : '',
      endDate: isAdmin ? usageEndDate?.value : ''
    };

    const filteredRows = filterUsageRows(usageRows, filters, usersById, isAdmin);
    const dailyAggregates = buildDailyAggregates(filteredRows);
    const rangeDays = USAGE_RANGE_STEPS[usageState.rangeIndex] || USAGE_RANGE_STEPS[0];
    const dailyRange = clampDailyRange(dailyAggregates, rangeDays, filters.startDate, filters.endDate);
    const monthTotals = getMonthTotals(filteredRows);

    updateUsageScopeLabel(isAdmin, filters);
    updateUsageCards(monthTotals, getCreditState());
    if (usageRangeLabel) {
      usageRangeLabel.textContent = filters.startDate || filters.endDate
        ? 'Custom range'
        : getRangeLabel(rangeDays);
    }

    renderCreditsChart(dailyRange, getCreditState(), isAdmin, filters.planTier);
    renderRequestsChart(dailyRange);
    renderLatencyChart(dailyRange);
    buildUsageHistory(dailyRange, isAdmin);

    if (usageLoadMore) {
      const canLoadMore = usageState.rangeIndex < USAGE_RANGE_STEPS.length - 1
        && !filters.startDate
        && !filters.endDate
        && dailyAggregates.length > dailyRange.length;
      usageLoadMore.disabled = !canLoadMore;
      usageLoadMore.textContent = canLoadMore ? 'Load more' : 'Showing all';
    }
  } catch (error) {
    console.warn('Usage analytics refresh failed.', error);
    if (analyticsModalState.open) {
      analyticsModalState.error = 'Usage analytics took too long to load.';
    }
  } finally {
    if (analyticsModalState.open) {
      analyticsModalState.loading = false;
    }
  }
}

async function initializeUsageFilters() {
  if (!usageUserFilter) {
    return;
  }
  const { userRows } = await loadUsageCsv();
  const isAdmin = window.location.pathname.startsWith('/admin/usage');
  if (!isAdmin) {
    return;
  }
  usageUserFilter.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All users';
  usageUserFilter.appendChild(allOption);
  userRows.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.user_id;
    option.textContent = row.display_name
      ? `${row.display_name} (${row.email || row.user_id})`
      : row.email || row.user_id;
    usageUserFilter.appendChild(option);
  });
}

function openUsageModal() {
  if (!usageModal || uiState !== UI_STATE.APP) {
    return;
  }
  if (analyticsModalState.open) {
    return;
  }
  analyticsModalState.open = true;
  analyticsModalState.loading = true;
  analyticsModalState.error = null;
  startAnalyticsModalWatchdog();
  usageModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  refreshUsageView();
}

function closeUsageModal() {
  if (!usageModal) {
    return;
  }
  showAnalytics = false;
  analyticsModalState.open = false;
  analyticsModalState.loading = false;
  analyticsModalState.error = null;
  clearAnalyticsModalWatchdog();
  usageModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function estimateTokensForRequest({ userInput, currentCode }) {
  const chars = (userInput?.length || 0) + (currentCode?.length || 0);
  if (chars <= 0) {
    return 0;
  }
  return Math.ceil(chars / 4);
}

function tokensToCredits(tokenCount) {
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) {
    return 0;
  }
  return Math.ceil(tokenCount / TOKENS_PER_CREDIT);
}

function estimateCreditsPreview({ userInput, currentCode }) {
  const totalTokens = estimateTokensForRequest({ userInput, currentCode });
  const estimatedCredits = tokensToCredits(totalTokens);
  const reservedCredits = estimatedCredits
    ? Math.ceil(estimatedCredits * CREDIT_RESERVE_MULTIPLIER)
    : 0;

  return {
    estimated: estimatedCredits,
    reserved: reservedCredits
  };
}

function getEstimatedNextCost() {
  if (!chatInput) {
    return 0;
  }
  const userText = chatInput.value.trim();
  if (!userText) {
    return 0;
  }
  const { reserved } = estimateCreditsPreview({
    userInput: userText,
    currentCode
  });
  return reserved;
}

function formatCreditPreview({ estimated, reserved, intentType, creditState }) {
  const intentLabel = intentType === 'code' ? 'visual generation' : 'chat';
  let text = `Estimated: ~${estimated} credits · Reserving ${reserved} · ${intentLabel}`;

  if (creditState.isFreeTier && creditState.freeTierRemaining !== null) {
    text += ` · free tier (${creditState.freeTierRemaining} left today)`;
  }

  return text;
}

function formatCreditWarning({ reserved, remainingCredits }) {
  if (!remainingCredits || remainingCredits <= 0) {
    return null;
  }
  const reserveFraction = Math.round((reserved / remainingCredits) * 100);
  return `⚠️ ~${reserveFraction}% of remaining credits`;
}

function updateCreditPreview({ force = false } = {}) {
  if (!creditPreviewEl || !chatInput) {
    return;
  }

  const userText = chatInput.value.trim();
  if (!userText) {
    creditPreviewEl.textContent = '';
    creditPreviewEl.classList.remove('warning');
    return;
  }

  if (chatState?.locked && !force) {
    return;
  }

  const resolvedIntent = resolveIntent(userText);
  const creditState = getCreditState();
  const { estimated, reserved } = estimateCreditsPreview({
    userInput: userText,
    currentCode
  });

  let previewText = formatCreditPreview({
    estimated,
    reserved,
    intentType: resolvedIntent.type,
    creditState
  });

  const warning = creditState.remainingCredits
    ? formatCreditWarning({
        reserved,
        remainingCredits: creditState.remainingCredits
      })
    : null;

  if (warning && reserved / creditState.remainingCredits >= CREDIT_WARNING_THRESHOLD) {
    creditPreviewEl.classList.add('warning');
    previewText += ` · ${warning}`;
  } else {
    creditPreviewEl.classList.remove('warning');
  }

  creditPreviewEl.textContent = previewText;
}

function formatCreditNumber(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function getCreditPercent(remaining, total) {
  if (!Number.isFinite(remaining) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(remaining / total, 1));
}

function updateCreditBadge({ remaining, total, plan }) {
  if (!creditBadge) {
    return;
  }
  const iconEl = creditBadge.querySelector('.icon');
  const countEl = creditBadge.querySelector('.count');
  const tooltipEl = creditBadge.querySelector('.credit-badge-tooltip');
  if (iconEl) {
    iconEl.textContent = plan?.toLowerCase() === 'free' ? '🟢' : '💎';
  }
  if (countEl && Number.isFinite(remaining)) {
    countEl.textContent = `${remaining.toLocaleString()} credits`;
  }
  const usagePercent = getCreditUsagePercent(remaining, total);
  if (usagePercent !== null) {
    creditBadge.classList.remove('badge-soft', 'badge-firm', 'badge-hard');
    if (usagePercent >= 1) {
      creditBadge.classList.add('badge-hard');
    } else if (usagePercent >= MONTHLY_FIRM_USAGE_THRESHOLD) {
      creditBadge.classList.add('badge-firm');
    } else if (usagePercent >= MONTHLY_SOFT_USAGE_THRESHOLD) {
      creditBadge.classList.add('badge-soft');
    }
    if (tooltipEl) {
      const percent = Math.round(usagePercent * 100);
      tooltipEl.textContent =
        `You’ve used ${percent}% of your monthly credits. Upgrade for uninterrupted generation.`;
    }
  } else {
    creditBadge.classList.remove('badge-soft', 'badge-firm', 'badge-hard');
    if (tooltipEl) {
      tooltipEl.textContent = 'Credits power generations. Resets monthly.';
    }
  }
}

function updateCreditMeter({ remaining, total }) {
  if (!creditMeterFill || !creditMeterLabel) {
    return;
  }
  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  creditMeterFill.style.width = `${pct * 100}%`;
  creditMeterLabel.textContent = `${remaining} / ${total}`;
}

function updateCreditPanel(state) {
  if (!creditPanel) {
    return;
  }
  if (Number.isFinite(state.remainingCredits) && Number.isFinite(state.creditsTotal)) {
    updateCreditMeter({
      remaining: state.remainingCredits,
      total: state.creditsTotal
    });
  }
  if (creditResetLabel && Number.isFinite(state.resetDays)) {
    creditResetLabel.textContent = `Resets in ${state.resetDays} days`;
  }
  if (creditDailyLimitLabel && Number.isFinite(state.dailyLimit)) {
    creditDailyLimitLabel.textContent = `Daily limit: ${formatCreditNumber(state.dailyLimit)} credits`;
  }
}

function getInlineNudgeCandidate(state, throttle) {
  const context = getUserContext();
  if (!context.id) {
    return null;
  }
  const nudgeState = loadNudgeState(context.id);
  nudgeState.throttle_hits = pruneTimestamps(nudgeState.throttle_hits, THROTTLE_HIT_WINDOW_MS);
  nudgeState.large_generations = pruneTimestamps(
    nudgeState.large_generations,
    LARGE_GENERATION_WINDOW_MS
  );
  saveNudgeState(nudgeState);

  if (hasShownNudgeThisSession() || hasNudgeCooldown(nudgeState)) {
    return null;
  }

  const usagePercent = getCreditUsagePercent(state.remainingCredits, state.creditsTotal);
  const dailyPercent = getDailyUsagePercent(state.todayCreditsUsed, state.dailyLimit);
  const throttleHits = nudgeState.throttle_hits.length;
  const largeGenerations = nudgeState.large_generations.length;

  let type = null;
  if (state.isFreeTier && usagePercent !== null && usagePercent >= 1) {
    type = 'hard_stop';
  } else if (usagePercent !== null && usagePercent >= MONTHLY_FIRM_USAGE_THRESHOLD) {
    type = 'monthly_firm';
  } else if (throttleHits >= 2) {
    type = 'daily_firm';
  } else if (usagePercent !== null && usagePercent >= MONTHLY_SOFT_USAGE_THRESHOLD) {
    type = 'monthly_soft';
  } else if (dailyPercent !== null && dailyPercent >= DAILY_SOFT_USAGE_THRESHOLD) {
    type = 'daily_soft';
  } else if (largeGenerations >= LARGE_GENERATION_COUNT_THRESHOLD) {
    type = 'large_soft';
  }

  if (!type || nudgeState.last_nudge_type === type) {
    return null;
  }

  const copy = NUDGE_COPY[type]?.inApp;
  if (!copy) {
    return null;
  }

  return {
    type,
    copy,
    state: nudgeState,
    throttle
  };
}

function buildInlineNudgeElement(nudge) {
  const wrapper = document.createElement('div');
  wrapper.className = 'usage-nudge';
  wrapper.dataset.nudgeType = nudge.type;

  const message = document.createElement('div');
  message.className = 'usage-nudge-message';
  message.textContent = nudge.copy.message;
  wrapper.appendChild(message);

  const actions = document.createElement('div');
  actions.className = 'usage-nudge-actions';

  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'ghost-button usage-nudge-primary';
  primary.textContent = nudge.copy.primaryCta;
  primary.addEventListener('click', () => openStripeCheckout('subscription'));
  actions.appendChild(primary);

  if (nudge.copy.secondaryCta) {
    const secondary = document.createElement('button');
    secondary.type = 'button';
    secondary.className = 'ghost-button usage-nudge-secondary';
    secondary.textContent = nudge.copy.secondaryCta;
    secondary.addEventListener('click', () => {
      markNudgeDismissed(nudge.state);
      wrapper.remove();
    });
    actions.appendChild(secondary);
  }

  wrapper.appendChild(actions);
  return wrapper;
}

function maybeShowInlineNudge(messageEl, { throttle } = {}) {
  if (!messageEl) {
    return;
  }
  const creditState = getCreditState();
  const candidate = getInlineNudgeCandidate(creditState, throttle);
  if (!candidate) {
    return;
  }
  const nudgeEl = buildInlineNudgeElement(candidate);
  messageEl.insertAdjacentElement('afterend', nudgeEl);
  markNudgeShown(candidate.state, candidate.type);
}

function shouldShowUpgradeNudge(state, throttle) {
  const usagePercent = getCreditUsagePercent(state.remainingCredits, state.creditsTotal);
  const dailyPercent = getDailyUsagePercent(state.todayCreditsUsed, state.dailyLimit);
  const blockedByThrottle = throttle?.state === 'blocked';
  if (blockedByThrottle) {
    return true;
  }
  return (usagePercent !== null && usagePercent >= MONTHLY_FIRM_USAGE_THRESHOLD)
    || (dailyPercent !== null && dailyPercent >= DAILY_SOFT_USAGE_THRESHOLD);
}

function updateCreditAlerts(state, throttle) {
  if (!creditInlineWarning || !creditBanner || !creditZero) {
    return;
  }
  const dailyCapHit = throttle?.state === 'blocked';
  const outOfCredits = state.remainingCredits !== null && state.remainingCredits <= 0;

  if (outOfCredits) {
    creditZero.classList.remove('hidden');
    creditBanner.classList.add('hidden');
    creditInlineWarning.classList.add('hidden');
    chatInput?.setAttribute('disabled', 'true');
    setSendDisabled(true);
  } else {
    creditZero.classList.add('hidden');
    chatInput?.removeAttribute('disabled');
    if (!chatState.locked) {
      setSendDisabled(false);
    }
  }

  creditInlineWarning.classList.add('hidden');
  creditBanner.classList.add('hidden');

  if (creditDailyMessage) {
    if (dailyCapHit) {
      const resetTime = state.dailyResetTime || 'tomorrow';
      creditDailyMessage.innerHTML = `⏳ Daily limit reached. More credits unlock in ${resetTime}.${!state.isFreeTier ? ' <span class="credit-link">Need more today? Buy a top-up →</span>' : ''}`;
      creditDailyMessage.classList.remove('hidden');
    } else {
      creditDailyMessage.classList.add('hidden');
    }
  }

  if (creditUpgradeNudge) {
    if (shouldShowUpgradeNudge(state, throttle)) {
      creditUpgradeNudge.classList.remove('hidden');
    } else if (!shouldShowUpgradeNudge(state, throttle)) {
      creditUpgradeNudge.classList.add('hidden');
    }
  }
}

function updateThrottleUI(throttle) {
  if (!throttleNotice) {
    return;
  }

  if (!lastRequestThrottled || throttle.state === 'ok') {
    throttleNotice.classList.add('hidden');
    return;
  }

  throttleNotice.classList.remove('hidden');
  throttleNotice.textContent = '';
  const message = document.createElement('span');
  const upgrade = document.createElement('button');
  upgrade.type = 'button';
  upgrade.className = 'inline-cta';
  upgrade.textContent = 'Upgrade';
  upgrade.addEventListener('click', () => openStripeCheckout('subscription'));

  if (throttle.state === 'warning') {
    message.textContent = 'This request was slowed due to your daily limit. Pro plans remove most throttles.';
  }

  if (throttle.state === 'blocked') {
    message.textContent = 'This request was blocked due to your daily limit. Pro plans remove most throttles.';
  }

  throttleNotice.appendChild(message);
  throttleNotice.appendChild(upgrade);
}

function updateSendButton(throttle) {
  if (!sendButton) {
    return;
  }

  if (chatState?.locked) {
    sendButton.disabled = true;
    return;
  }

  const creditState = getCreditState();
  if (creditState.remainingCredits !== null && creditState.remainingCredits <= 0) {
    sendButton.disabled = true;
    sendButton.title = 'Out of credits';
    return;
  }

  if (throttle.state === 'blocked') {
    sendButton.disabled = true;
    sendButton.title = 'Daily credit limit reached';
  } else {
    sendButton.disabled = false;
    sendButton.title = '';
  }

  if (isDev) {
    console.assert(
      throttle.state !== 'blocked' || sendButton.disabled,
      'Blocked throttle must disable send'
    );
  }
}

function updateThrottleState({ estimatedNextCost = 0 } = {}) {
  const state = getCreditState();
  if (!Number.isFinite(state.dailyLimit) || state.dailyLimit <= 0) {
    lastThrottleState = { state: 'ok', remaining: 0 };
    updateThrottleUI(lastThrottleState);
    updateSendButton(lastThrottleState);
    return lastThrottleState;
  }

  const throttle = computeThrottleState({
    creditsUsedToday: Number.isFinite(state.todayCreditsUsed) ? state.todayCreditsUsed : 0,
    dailyLimit: state.dailyLimit,
    estimatedNextCost
  });

  lastThrottleState = throttle;
  updateThrottleUI(throttle);
  updateSendButton(throttle);
  return throttle;
}

async function refreshAnalyticsAndThrottle({ force = false } = {}) {
  if (uiState !== UI_STATE.APP) {
    return null;
  }
  const data = await fetchUsageAnalytics({ force });
  if (!data) {
    return null;
  }
  const summary = parseAnalyticsSummary(data);
  applyAnalyticsSummary(summary);
  updateThrottleState({ estimatedNextCost: 0 });
  updateCreditUI();
  return summary;
}

function updateCreditUI() {
  const state = getCreditState();
  updateCreditBadge({
    remaining: state.remainingCredits ?? 0,
    total: state.creditsTotal ?? 0,
    plan: state.planLabel
  });
  updateCreditPanel(state);
  updateCreditAlerts(state, lastThrottleState);
}

function debounce(fn, delayMs) {
  let timerId;
  return (...args) => {
    if (timerId) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      fn(...args);
    }, delayMs);
  };
}

const requestCreditPreviewUpdate = debounce(() => updateCreditPreview(), 250);
const requestThrottleUpdate = debounce(() => {
  updateThrottleState({ estimatedNextCost: getEstimatedNextCost() });
}, 200);

codeEditor.value = defaultInterfaceCode;
let currentCode = defaultInterfaceCode;
let baselineCode = defaultInterfaceCode;
let previousCode = null;
let loadingStartTime = null;
let loadingInterval = null;
let isGenerating = false;
let isPaywallVisible = false;
let lastLLMCode = null;
let userHasEditedCode = false;
let baseExecutionWarnings = [];
let sandboxMode = 'finite';
let sandboxAnimationState = 'idle';
let lastRunCode = null;
let lastRunSource = null;
let lastCodeSource = null;
let chatFinalized = false;
let currentTurnMessageId = null;
let pendingAssistantProposal = null;
let intentAnchor = null;
const DEBUG_INTENT = false;
const chatState = {
  locked: false,
  unlockTimerId: null
};

const sandbox = createSandboxController({
  iframe: sandboxFrame,
  statusEl: sandboxStatus,
  maxFiniteMs: SANDBOX_TIMEOUT_MS
});

function resetSandboxFrame() {
  if (!previewFrameHost) {
    return sandboxFrame;
  }
  previewFrameHost.innerHTML = '';
  const nextFrame = document.createElement('iframe');
  nextFrame.id = 'sandbox';
  nextFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  nextFrame.style.width = '100%';
  nextFrame.style.height = '100%';
  previewFrameHost.appendChild(nextFrame);
  sandboxFrame = nextFrame;
  sandbox.setIframe(nextFrame);
  preview.attach(nextFrame);
  return nextFrame;
}

const preview = {
  ready: false,
  listeners: new Set(),
  attach(frame) {
    this.ready = false;
    this.listeners.clear();

    frame.addEventListener('load', () => {
      this.ready = true;
      this.listeners.forEach((listener) => listener());
      this.listeners.clear();
    });

    if (frame.contentDocument?.readyState === 'complete') {
      this.ready = true;
    }
  },
  isReady() {
    return this.ready;
  },
  once(eventName, listener) {
    if (eventName !== 'ready') {
      return;
    }
    if (this.ready) {
      listener();
      return;
    }
    this.listeners.add(listener);
  }
};

if (sandboxFrame) {
  preview.attach(sandboxFrame);
}

const tts = (() => {
  if (!('speechSynthesis' in window)) {
    return null;
  }

  let currentUtterance = null;
  let currentButton = null;

  function applyPreferredVoice(utterance) {
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find((voice) =>
      /en/i.test(voice.lang) && /natural|google|neural/i.test(voice.name)
    );
    if (preferred) {
      utterance.voice = preferred;
    }
  }

  function resetButton() {
    if (!currentButton) {
      return;
    }
    currentButton.dataset.playing = 'false';
    currentButton.textContent = '🔊 Listen';
  }

  function speak(text, button) {
    if (!text || !text.trim()) {
      return;
    }
    stop();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    applyPreferredVoice(utterance);

    currentUtterance = utterance;
    currentButton = button || null;

    utterance.addEventListener('end', () => {
      resetButton();
      currentUtterance = null;
      currentButton = null;
    });
    utterance.addEventListener('error', () => {
      resetButton();
      currentUtterance = null;
      currentButton = null;
    });

    speechSynthesis.speak(utterance);
  }

  function stop() {
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
    }
    resetButton();
    currentUtterance = null;
    currentButton = null;
  }

  return { speak, stop };
})();

const stt = (() => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;

  let listening = false;
  let onFinalText = null;
  let onStateChange = null;

  recognition.onstart = () => {
    listening = true;
    onStateChange?.(true);
  };

  recognition.onend = () => {
    listening = false;
    onStateChange?.(false);
  };

  recognition.onerror = (event) => {
    console.warn('STT error:', event.error);
    listening = false;
    onStateChange?.(false);
  };

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += transcript;
      } else {
        interim += transcript;
      }
    }

    if (finalText && onFinalText) {
      onFinalText(finalText.trim());
    } else if (interim && onFinalText) {
      onFinalText(interim.trim(), { interim: true });
    }
  };

  function start() {
    if (!listening) {
      recognition.start();
    }
  }

  function stop() {
    if (listening) {
      recognition.stop();
    }
  }

  function bind({ onText, onListeningChange }) {
    onFinalText = onText;
    onStateChange = onListeningChange;
  }

  return { start, stop, bind };
})();

updateLineNumbers();

if (stt && micButton && chatInput) {
  stt.bind({
    onText: (text, opts = {}) => {
      if (opts.interim) {
        chatInput.value = text;
        return;
      }

      chatInput.value = text;
    },
    onListeningChange: (isListening) => {
      micButton.classList.toggle('listening', isListening);
      micButton.textContent = isListening ? '🛑' : '🎙️';
    }
  });

  micButton.addEventListener('click', () => {
    if (micButton.classList.contains('listening')) {
      stt.stop();
    } else {
      stt.start();
    }
  });
} else if (micButton) {
  micButton.style.display = 'none';
}

if (copyCodeBtn && codeEditor) {
  copyCodeBtn.addEventListener('click', async () => {
    const success = await copyToClipboard(codeEditor.value);
    if (!success) {
      return;
    }
    if (navigator.vibrate) {
      navigator.vibrate(15);
    }
    copyCodeBtn.classList.add('copied');
    copyCodeBtn.textContent = '✓';
    copyCodeBtn.title = 'Copied!';
    setTimeout(() => {
      copyCodeBtn.textContent = '📋';
      copyCodeBtn.classList.remove('copied');
      copyCodeBtn.title = 'Copy code';
    }, 1200);
  });
}

function setStatusOnline(isOnline) {
  statusLabel.textContent = isOnline ? 'API online' : 'Offline';
  statusLabel.classList.toggle('online', isOnline);
}

function setStatus(status, source) {
  if (!interfaceStatus) {
    return;
  }
  const label = source ? `${status} · ${source}` : status;
  interfaceStatus.textContent = label;
  const isUpdated = /running|compiling|baseline|rolled|promoted|reset/i.test(status);
  interfaceStatus.classList.toggle('updated', isUpdated);
  interfaceStatus.classList.toggle('unchanged', !isUpdated);
}

function addMessage(role, html, options = {}) {
  const message = document.createElement('div');
  message.className = `message ${role}${options.className ? ` ${options.className}` : ''}`;
  message.innerHTML = html;

  if (options.pending) {
    message.dataset.pending = 'true';
  }

  const id = crypto.randomUUID();
  message.dataset.id = id;

  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return id;
}

function attachCopyButton(messageEl, getTextFn) {
  if (!messageEl || messageEl.querySelector('.chat-copy-btn')) {
    return;
  }
  const btn = document.createElement('button');
  btn.className = 'chat-copy-btn';
  btn.innerHTML = '📋';
  btn.title = 'Copy';

  btn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const success = await copyToClipboard(getTextFn());
    if (!success) {
      return;
    }
    if (navigator.vibrate) {
      navigator.vibrate(15);
    }
    btn.innerHTML = '✓';
    btn.classList.add('copied');
    btn.title = 'Copied!';
    setTimeout(() => {
      btn.innerHTML = '📋';
      btn.classList.remove('copied');
      btn.title = 'Copy';
    }, 1200);
  });

  messageEl.appendChild(btn);
}

function getMessageCopyText(messageEl) {
  const clone = messageEl.cloneNode(true);
  clone.querySelectorAll('.assistant-meta, .chat-copy-btn').forEach((el) => el.remove());
  return clone.innerText.replace(/✓|📋/g, '').trim();
}

function appendMessage(role, content, options = {}) {
  const message = document.createElement('div');
  message.className = `message ${role}${options.className ? ` ${options.className}` : ''}`;
  message.textContent = content;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (role === 'user') {
    attachCopyButton(message, () => content);
  }
  return message;
}

function createGenerationNarrator({
  addMessage,
  minInterval = 1000,
  maxInterval = 2500
}) {
  let startTime = null;
  let timerId = null;
  let stopped = false;

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function scheduleNext() {
    const delay =
      minInterval + Math.random() * (maxInterval - minInterval);

    timerId = setTimeout(tick, delay);
  }

  function tick() {
    if (stopped || chatFinalized) {
      return;
    }

    const elapsed = performance.now() - startTime;

    let phaseIndex = -1;
    for (let i = 0; i < GENERATION_PHASES.length; i += 1) {
      if (elapsed >= GENERATION_PHASES[i].afterMs) {
        phaseIndex = i;
      }
    }

    if (phaseIndex >= 0) {
      const pool = GENERATION_PHASES[phaseIndex].messages;
      const text = pick(pool);
      const messageId = addMessage('assistant', `<em>${text}</em>`, { className: 'thinking' });
      const messageEl = document.querySelector(`[data-id="${messageId}"]`);
      if (messageEl) {
        messageEl.dataset.ephemeral = 'true';
      }
    }

    scheduleNext();
  }

  return {
    start() {
      startTime = performance.now();
      stopped = false;
      scheduleNext();
    },
    stop() {
      stopped = true;
      if (timerId) {
        clearTimeout(timerId);
      }
      document
        .querySelectorAll('.message.assistant.thinking[data-ephemeral="true"]')
        .forEach((el) => el.remove());
    }
  };
}

function createProgressDots({ addMessage, updateMessage }) {
  let messageId = null;
  let dots = 0;
  let timerId = null;

  function render() {
    dots = (dots + 1) % 4;
    const text = `Thinking${'.'.repeat(dots)}`;
    updateMessage(messageId, `<em>${text}</em>`);
  }

  return {
    start() {
      messageId = addMessage(
        'assistant',
        '<em>Thinking</em>',
        { className: 'thinking', pending: true }
      );
      timerId = setInterval(render, 500);
    },
    stop() {
      if (timerId) {
        clearInterval(timerId);
      }
      if (messageId) {
        const messageEl = document.querySelector(`[data-id="${messageId}"]`);
        if (messageEl) {
          messageEl.remove();
        }
      }
    }
  };
}

function createGenerationFeedback({ addMessage, updateMessage }) {
  const dots = createProgressDots({ addMessage, updateMessage });
  const narrator = createGenerationNarrator({ addMessage });

  let dotsTimer = null;
  let narratorTimer = null;
  let stopped = false;

  return {
    start() {
      stopped = false;
      dotsTimer = setTimeout(() => {
        if (stopped) {
          return;
        }
        dots.start();
      }, 2500);

      narratorTimer = setTimeout(() => {
        if (stopped) {
          return;
        }
        dots.stop();
        narrator.start();
      }, 6000);
    },
    stop() {
      stopped = true;
      clearTimeout(dotsTimer);
      clearTimeout(narratorTimer);
      dots.stop();
      narrator.stop();
    }
  };
}

function renderAssistantMessage(messageId, text, metadataParts = []) {
  const safeText =
    (typeof text === 'string' && text.trim().length)
      ? text.trim()
      : '';

  let messageEl = null;
  if (messageId) {
    updateMessage(messageId, safeText ? formatAssistantHtml(safeText) : '');
    messageEl = document.querySelector(`[data-id="${messageId}"]`);
  } else if (safeText) {
    messageEl = appendMessage('assistant', safeText);
  }

  let metaEl = null;
  if (metadataParts.length) {
    metaEl = renderAssistantMeta(messageId, metadataParts);
  } else if (messageEl) {
    metaEl = ensureAssistantMeta(messageEl);
  }

  if (metaEl) {
    const button = createTTSButton(safeText);
    if (button) {
      metaEl.appendChild(button);
    }
  }

  if (messageEl) {
    attachCopyButton(messageEl, () => getMessageCopyText(messageEl));
  }
  return messageEl;
}

function ensureAssistantMeta(message) {
  if (!message) {
    return null;
  }
  let meta = message.querySelector('.assistant-meta');
  if (!meta) {
    meta = document.createElement('div');
    meta.className = 'assistant-meta';
    message.appendChild(meta);
  }
  return meta;
}

function renderAssistantMeta(messageId, parts = []) {
  if (!parts.length) {
    return null;
  }

  const message = messageId
    ? document.querySelector(`[data-id="${messageId}"]`)
    : null;
  const meta = message ? ensureAssistantMeta(message) : document.createElement('div');
  meta.classList.add('assistant-meta');
  meta.textContent = '';

  parts.forEach((part) => {
    if (!part?.text) {
      return;
    }
    const span = document.createElement('span');
    span.textContent = part.text;
    if (part.className) {
      span.classList.add(part.className);
    }
    meta.appendChild(span);
  });

  if (message) {
    message.appendChild(meta);
    delete message.dataset.pending;
  } else {
    const wrapper = document.createElement('div');
    wrapper.className = 'message assistant';
    wrapper.appendChild(meta);
    chatMessages.appendChild(wrapper);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
  return meta;
}

function createTTSButton(text) {
  if (!tts || !text || !text.trim()) {
    return null;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tts-btn';
  button.textContent = '🔊 Listen';
  button.dataset.playing = 'false';

  button.addEventListener('click', () => {
    const isPlaying = button.dataset.playing === 'true';
    if (!isPlaying) {
      tts.speak(text, button);
      button.dataset.playing = 'true';
      button.textContent = '⏹ Stop';
    } else {
      tts.stop();
    }
  });

  return button;
}

function finalizeChatOnce(fn) {
  if (chatFinalized) {
    return false;
  }
  chatFinalized = true;
  fn();
  return true;
}

function runWhenPreviewReady(runFn) {
  if (preview.isReady()) {
    runFn();
    return;
  }

  let hasRun = false;
  const runOnce = () => {
    if (hasRun) {
      return;
    }
    hasRun = true;
    runFn();
  };

  preview.once('ready', runOnce);
  setTimeout(() => {
    if (!preview.isReady()) {
      console.warn('⚠️ Preview readiness timeout; running anyway.');
      runOnce();
    }
  }, 500);
}

function waitForIframeReady(frame, timeoutMs = 800) {
  return new Promise((resolve) => {
    if (!frame) {
      resolve(false);
      return;
    }

    try {
      if (frame.contentDocument?.readyState === 'complete') {
        resolve(true);
        return;
      }
    } catch (_) {
      // sandboxed iframe may throw; ignore and fall back to load event
    }

    let done = false;
    const finish = (ok) => {
      if (done) {
        return;
      }
      done = true;
      frame.removeEventListener('load', onLoad);
      clearTimeout(timer);
      resolve(ok);
    };

    const onLoad = () => finish(true);
    frame.addEventListener('load', onLoad, { once: true });

    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

function updateMessage(id, newHtml) {
  const message = document.querySelector(`[data-id="${id}"]`);
  if (!message) {
    return;
  }
  message.innerHTML = newHtml;
  delete message.dataset.pending;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function formatAssistantHtml(text) {
  const match = text.match(/^(.*?)(\s*\([^)]*\))$/);
  if (!match) {
    return escapeHtml(text);
  }

  const [, main, aside] = match;
  const mainText = main.trim();
  const asideText = aside.trim();

  if (!mainText) {
    return `<span class="assistant-aside">${escapeHtml(asideText)}</span>`;
  }

  return `${escapeHtml(mainText)} <span class="assistant-aside">${escapeHtml(asideText)}</span>`;
}

function setPreviewStatus(message) {
  if (!previewStatus) {
    return;
  }

  previewStatus.textContent = message;
}

function setExecutionWarnings(warnings = []) {
  if (!executionWarnings) {
    return;
  }

  if (!warnings.length) {
    executionWarnings.classList.add('hidden');
    executionWarnings.textContent = '';
    return;
  }

  executionWarnings.textContent = warnings.map((warning) => `⚠️ ${warning}`).join(' ');
  executionWarnings.classList.remove('hidden');
}

function applyExecutionWarnings(warnings = []) {
  baseExecutionWarnings = warnings;
  setExecutionWarnings(warnings);
}

function addExecutionWarning(warning) {
  const nextWarnings = [...baseExecutionWarnings];
  if (!nextWarnings.includes(warning)) {
    nextWarnings.push(warning);
  }
  setExecutionWarnings(nextWarnings);
}

function getSandboxModeForExecution(executionProfile) {
  return executionProfile === 'animation' || executionProfile === 'canvas-sim'
    ? 'animation'
    : 'finite';
}

function updateExecutionWarningsFor(code) {
  const warnings = [];
  if (!code) {
    applyExecutionWarnings(warnings);
    return { executionProfile: 'finite' };
  }

  if (code.includes('while(true)') || code.includes('for(;;)')) {
    warnings.push('Potential infinite loop detected.');
  }

  if (code.includes('setInterval')) {
    warnings.push('setInterval can create runaway execution in finite mode.');
  }

  const executionProfile = code.includes('requestAnimationFrame') || code.includes('<canvas')
    ? 'animation'
    : 'finite';

  applyExecutionWarnings(warnings);
  return { executionProfile };
}

function setSandboxControlsVisible(isVisible) {
  if (!sandboxControls) {
    return;
  }
  sandboxControls.classList.toggle('hidden', !isVisible);
}

function setSandboxAnimationState(state) {
  sandboxAnimationState = state;
  if (!sandboxPauseButton || !sandboxResumeButton) {
    return;
  }
  const isPaused = state === 'paused';
  sandboxPauseButton.classList.toggle('hidden', isPaused);
  sandboxResumeButton.classList.toggle('hidden', !isPaused);
}

function setPreviewExecutionStatus(state, message) {
  if (!previewExecutionStatus) {
    return;
  }

  previewExecutionStatus.textContent = message;
  previewExecutionStatus.className = `preview-execution-status ${state}`;
}

function formatGenerationMetadata(durationMs) {
  if (durationMs > 1500) {
    const seconds = (durationMs / 1000).toFixed(1);
    return `Generated in ${seconds} s · Auto-run enabled`;
  }
  return `Generated in ${Math.round(durationMs)} ms · Auto-run enabled`;
}

function formatUsageMetadata(usage, context, throttle) {
  if (!usage) {
    return { usageText: '', warningText: '' };
  }
  const creditsCharged = Number(usage.creditsCharged ?? usage.credits_charged);
  const actualCredits = Number(usage.actualCredits ?? usage.actual_credits ?? creditsCharged);
  if (!Number.isFinite(actualCredits)) {
    return { usageText: '', warningText: '' };
  }
  const reservedCredits = Number(usage.reservedCredits ?? usage.reserved_credits);
  const refundedCredits = Number(usage.refundedCredits ?? usage.refunded_credits);
  const creditsRemaining = Number.isFinite(usage.remainingCredits)
    ? usage.remainingCredits
    : Number.isFinite(context?.remainingCredits)
      ? context.remainingCredits
      : null;

  const metadataParts = [`— Used ${actualCredits} credits`];
  if (Number.isFinite(reservedCredits)) {
    metadataParts.push(`Reserved ${reservedCredits}`);
  }
  if (Number.isFinite(refundedCredits) && refundedCredits > 0) {
    metadataParts.push(`Refunded +${refundedCredits}`);
  }
  if (Number.isFinite(creditsRemaining)) {
    metadataParts.push(`${creditsRemaining} remaining`);
  }
  if (Number.isFinite(creditsCharged) && creditsCharged !== actualCredits) {
    metadataParts.push(`Charged ${creditsCharged}`);
  }

  const usageText = metadataParts.join(' · ');

  let warningText = '';
  if (throttle?.state === 'warning' || throttle?.state === 'blocked') {
    const remainingToday = Math.max(
      0,
      (context?.dailyLimit ?? 0) - (context?.todayCreditsUsed ?? 0)
    );
    warningText = `⚠️ ${remainingToday} credits left today`;
  }

  return { usageText, warningText };
}

function applyUsageToCredits(usage) {
  if (!usage) {
    return;
  }
  const remainingCredits = Number(usage.remainingCredits ?? usage.credits_remaining);
  const creditsCharged = Number(
    usage.creditsCharged
    ?? usage.credits_charged
    ?? usage.actualCredits
    ?? usage.actual_credits
  );
  if (!Number.isFinite(remainingCredits)) {
    return;
  }
  const root = document.getElementById('root');
  if (root) {
    root.dataset.remainingCredits = `${remainingCredits}`;
    if (Number.isFinite(creditsCharged)) {
      const currentUsed = Number.parseInt(root.dataset.todayCreditsUsed ?? '0', 10);
      const updatedUsed = Number.isFinite(currentUsed) ? currentUsed + creditsCharged : creditsCharged;
      root.dataset.todayCreditsUsed = `${updatedUsed}`;
    }
  }
}

function appendOutput(content, variant = 'success') {
  const line = document.createElement('div');
  line.className = `output-line ${variant}`;
  line.textContent = content;
  consoleLog.appendChild(line);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

function handleConsoleLog(...args) {
  appendOutput(args.map((item) => String(item)).join(' '), 'success');
}

function isOverlyLiteral(code, text) {
  if (!text || text.length > 120) {
    return false;
  }

  const normalizedText = text.toLowerCase().replace(/\W+/g, '');
  const normalizedCode = code.toLowerCase().replace(/\W+/g, '');

  return normalizedCode.includes(normalizedText);
}

function extractTextAndCode(raw) {
  const s = String(raw ?? '').trim();

  const fence = s.match(/```(?:html|xml|svg|javascript|js|css)?\s*([\s\S]*?)```/i);
  if (fence) {
    const code = fence[1].trim();
    const text = s.slice(0, fence.index).trim();
    return { text, code };
  }

  const looksLikeHtml = /<!doctype html>|<html[\s>]|<script[\s>]/i.test(s);
  if (looksLikeHtml) {
    let text = '';
    let code = s;

    const chatMatch = code.match(/^<!--\s*CHAT:\s*([\s\S]*?)\s*-->\s*/i);
    if (chatMatch) {
      text = (chatMatch[1] || '').trim();
      code = code.slice(chatMatch[0].length).trim();
    }

    return { text, code };
  }

  return { text: s, code: '' };
}

function inferIntentFromText(userText) {
  const normalized = userText.trim().toLowerCase();
  if (!normalized) {
    return { type: 'text', inferred: false };
  }
  const creativeSignals = /express|explore|improvise|interpret|reflect|play|dream|invent|yourself/i.test(normalized)
    || normalized.length <= 20; // short, open-ended prompts

  const wantsExplicitUI = /\b(draw|build|render|interface|canvas|ui|prototype)\b/.test(normalized);

  if (creativeSignals && !wantsExplicitUI) {
    return { type: 'creative', inferred: true };
  }

  if (wantsExplicitUI) {
    return { type: 'code', inferred: false };
  }

  return { type: 'text', inferred: false };
}

function resolveIntent(userText) {
  if (
    pendingAssistantProposal
    && intentAnchor === pendingAssistantProposal.type
    && /^(yes|ok|sure|do it|go ahead)$/i.test(userText.trim())
  ) {
    return {
      type: pendingAssistantProposal.type,
      inferred: true
    };
  }

  return inferIntentFromText(userText);
}

function getAssistantProposal(text) {
  if (!text) {
    return null;
  }
  const proposalMatch = text.match(
    /\b(would you like me to|should I|do you want me to)\s+(create|build|generate)\s+([^.\n]+)/i
  );
  if (!proposalMatch) {
    return null;
  }
  const description = proposalMatch[3]?.trim();
  if (!description) {
    return null;
  }
  return {
    type: 'code',
    description
  };
}

function buildWrappedPrompt(userInput, currentCode, resolvedIntent) {
  const intentHint = resolvedIntent?.type === 'code'
    ? '\nIntent: generate code.'
    : '';
  const creativeHint = resolvedIntent?.type === 'creative'
    ? `
Creative mode:
- Interpret ambiguity as an invitation to invent.
- Prefer expressive, surprising, or poetic visuals.
- Avoid generic UI patterns (forms, buttons, landing pages).
- You may use motion, color, metaphor, or generative structure.
- Output must still be runnable HTML.
`
    : '';
  if (!currentCode) {
    return `
Output Contract:
- Never respond with JSON, YAML, or structured objects.
- If code is required, output raw HTML directly, without code fences or wrappers.
- Otherwise, output plain conversational text only.

${creativeHint}

User message:
${userInput}${intentHint}
`;
  }

  return `
You are continuing an ongoing interaction.

Output Contract:
- Never respond with JSON, YAML, or structured objects.
- If code is required, output raw HTML directly, without code fences or wrappers.
- Otherwise, output plain conversational text only.

${creativeHint}

Current interface (may be reused unchanged):
${currentCode}

User message:
${userInput}${intentHint}
`;
}

function pauseSandbox() {
  if (sandboxMode !== 'animation') {
    return;
  }
  sandbox.pause();
  setSandboxAnimationState('paused');
  setPreviewExecutionStatus('paused', 'PAUSED');
  setPreviewStatus('Animation paused');
}

function resumeSandbox() {
  if (sandboxMode !== 'animation') {
    return;
  }
  sandbox.resume();
  setSandboxAnimationState('running');
  setPreviewExecutionStatus('running', 'RUNNING · ANIMATION MODE');
  setPreviewStatus('Running animation…');
}

function resetSandbox() {
  if (!lastRunCode) {
    return;
  }
  handleUserRun(lastRunCode, lastRunSource ?? 'reset', 'Resetting animation…');
}

function stopSandboxFromUser() {
  sandbox.stop('user');
  setSandboxAnimationState('stopped');
  setSandboxControlsVisible(false);
  setPreviewExecutionStatus('stopped', '🛑 Stopped');
  setPreviewStatus('Sandbox stopped by user.');
}

async function handleLLMOutput(code, source = 'generated') {
  setStatus('COMPILING');

  const analysis = updateExecutionWarningsFor(code);
  sandboxMode = getSandboxModeForExecution(analysis.executionProfile);
  lastRunCode = code;
  lastRunSource = source;
  const activeFrame = resetSandboxFrame();
  if (!activeFrame) {
    appendOutput('Sandbox iframe missing.', 'error');
    return;
  }

  outputPanel?.classList.add('loading');
  setSandboxControlsVisible(sandboxMode === 'animation');
  setSandboxAnimationState('running');
  await waitForIframeReady(activeFrame, 900);
  if (sandboxFrame !== activeFrame) {
    console.warn('Iframe swapped during compile; aborting run.');
    return;
  }
  const codeWithSession = injectSessionBridge(code);
  sandbox.run(codeWithSession);
  syncSessionToSandbox();
  outputPanel?.classList.remove('loading');
  setStatus('RUNNING', source);
}

function updateGenerationIndicator() {
  if (!generationIndicator) {
    return;
  }
  const isModifying = Boolean(currentCode);
  generationIndicator.textContent = isModifying
    ? '🧠 Modifying existing UI'
    : '✨ Creating new UI';
  generationIndicator.classList.toggle('active', isModifying);
}

function markPreviewStale() {
  setPreviewStatus('✏️ Code modified — click Run Code to apply');
  setPreviewExecutionStatus('stale', 'MODIFIED · not running');
  updatePromoteVisibility();
}

function resetExecutionPreparation() {
  applyExecutionWarnings([]);
}

function updateRunButtonVisibility() {
  if (!runButton) {
    return;
  }
  runButton.style.display = userHasEditedCode ? 'inline-flex' : 'none';
}

function updateRollbackVisibility() {
  if (!rollbackButton) {
    return;
  }
  rollbackButton.style.display =
    userHasEditedCode && lastLLMCode ? 'inline-flex' : 'none';
}

function updatePromoteVisibility() {
  if (!promoteButton) {
    return;
  }
  const isRunning = previewExecutionStatus?.classList.contains('running');
  promoteButton.style.display =
    userHasEditedCode && isRunning ? 'inline-flex' : 'none';
}

function setCodeFromLLM(code) {
  lastLLMCode = code;
  codeEditor.value = code;
  baselineCode = code;
  userHasEditedCode = false;
  lastCodeSource = 'llm';
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  updateLineNumbers();
  setPreviewStatus('Preview updated by assistant');
}

function handleUserRun(code, source = 'user', statusMessage = 'Applying your edits…') {
  currentCode = code;
  baselineCode = code;
  userHasEditedCode = false;
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  setPreviewStatus(statusMessage);
  handleLLMOutput(code, source);
}

function simpleLineDiff(oldCode, newCode) {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');

  return newLines
    .map((line, i) => {
      if (oldLines[i] !== line) {
        return `+ ${line}`;
      }
      return `  ${line}`;
    })
    .join('\n');
}

function startLoading() {
  if (!loadingIndicator) {
    return;
  }
  isGenerating = true;
  if (isDev) {
    console.assert(
      !isGenerating || !isPaywallVisible,
      'Paywall must not show during generation'
    );
  }
  const timerEl = loadingIndicator.querySelector('.timer');
  if (!timerEl) {
    return;
  }

  if (loadingInterval) {
    clearInterval(loadingInterval);
  }

  loadingStartTime = performance.now();
  loadingIndicator.classList.remove('hidden');
  timerEl.textContent = '0.0s';

  loadingInterval = setInterval(() => {
    const elapsed = (performance.now() - loadingStartTime) / 1000;
    timerEl.textContent = `${elapsed.toFixed(1)}s`;
  }, 100);
}

function stopLoading() {
  if (!loadingIndicator) {
    return;
  }
  isGenerating = false;
  loadingIndicator.classList.add('hidden');

  if (loadingInterval) {
    clearInterval(loadingInterval);
  }
  loadingInterval = null;
  loadingStartTime = null;
}

function setSendDisabled(isDisabled) {
  if (!sendButton) {
    return;
  }
  sendButton.disabled = isDisabled;
}

function unlockChat() {
  chatState.locked = false;
  if (chatState.unlockTimerId) {
    clearTimeout(chatState.unlockTimerId);
    chatState.unlockTimerId = null;
  }
  updateSendButton(lastThrottleState);
}

function lockChat() {
  chatState.locked = true;
  setSendDisabled(true);
  if (chatState.unlockTimerId) {
    clearTimeout(chatState.unlockTimerId);
  }
  chatState.unlockTimerId = setTimeout(() => {
    if (chatState.locked) {
      console.warn('Chat lock recovered');
      unlockChat();
    }
  }, 15000);
}

async function sendChat() {
  if (chatState.locked) {
    return;
  }

  const userInput = chatInput.value.trim();
  if (!userInput) {
    return;
  }

  const estimatedNextCost = getEstimatedNextCost();
  const throttle = updateThrottleState({ estimatedNextCost });
  lastRequestThrottled = throttle.state !== 'ok';
  updateThrottleUI(throttle);
  const creditState = getCreditState();

  if (throttle.state === 'blocked') {
    recordThrottleHit(getUserContext().id);
    updateCreditUI();
    showPaywall({
      reason: throttle.reason,
      estimate: null,
      remaining: throttle.remaining
    });
    return;
  }

  if (creditState.remainingCredits !== null && creditState.remainingCredits <= 0) {
    updateCreditUI();
    showPaywall({ reason: 'monthly' });
    return;
  }

  if (throttle.state === 'warning') {
    const remainingToday = Math.max(
      0,
      (creditState.dailyLimit ?? 0) - (creditState.todayCreditsUsed ?? 0)
    );
    if (estimatedNextCost > remainingToday) {
      const estimate = estimateCreditsPreview({
        userInput,
        currentCode
      });
      showPaywall({
        reason: throttle.reason,
        estimate,
        remaining: remainingToday
      });
      return;
    }
  }

  const startedAt = performance.now();
  const resolvedIntent = resolveIntent(userInput);
  if (!intentAnchor && !resolvedIntent.inferred) {
    intentAnchor = resolvedIntent.type;
  }
  if (DEBUG_INTENT) {
    console.log('[intent]', {
      userText: userInput,
      pendingAssistantProposal,
      resolvedIntent
    });
  }

  let intentAdjustedInput = userInput;
  if (
    resolvedIntent.inferred
    && pendingAssistantProposal
    && intentAnchor === pendingAssistantProposal.type
  ) {
    const description = pendingAssistantProposal.description || 'the proposed experience';
    intentAdjustedInput = `Yes — please proceed with ${description}.`;
  }

  lockChat();
  chatInput.value = '';
  updateCreditPreview({ force: true });
  appendMessage('user', userInput);

  const tokenEstimate = estimateTokensForRequest({ userInput, currentCode });
  recordLargeGeneration(getUserContext().id, tokenEstimate);

  const pendingMessageId = addMessage(
    'assistant',
    '<em>Generating text + code…</em>',
    { pending: true }
  );
  currentTurnMessageId = pendingMessageId;
  chatFinalized = false;

  setStatusOnline(false);
  startLoading();
  const generationFeedback = createGenerationFeedback({ addMessage, updateMessage });
  generationFeedback.start();

  let generationMetadata = '';
  let rawReply = '';
  let usageMetadata = { usageText: '', warningText: '' };
  let throttleSnapshot = throttle;
  try {
    const llmStartTime = performance.now();
    const systemPrompt = `You are a coding assistant.

Output rules:
- Never output JSON, YAML, or code fences.
- If you return HTML, the FIRST line must be:
  <!--CHAT: <a short conversational message for the user> -->
  Then output a complete HTML document.
- If no HTML is needed, output plain conversational text only.
- If a visual is requested as part of a technical discussion, prioritize correctness and demonstration over expressiveness or celebration.`;

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: buildWrappedPrompt(intentAdjustedInput, currentCode, resolvedIntent)
      }
    ];

    console.log('LLM REQUEST:', { model: 'gpt-4.1-mini', messages });

    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        sessionId,
        intentType: resolvedIntent.type,
        user: getUserContext()
      })
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const llmEndTime = performance.now();
    generationMetadata = formatGenerationMetadata(llmEndTime - llmStartTime);

    if (!res.ok) {
      throw new Error(data?.message || data?.error || 'Unable to reach the chat service.');
    }

    setStatusOnline(true);
    let textReply = data?.choices?.[0]?.message?.content;
    if (!textReply && data?.candidates?.length) {
      textReply = data.candidates[0].content;
    }
    rawReply = textReply ?? 'No response.';
    applyUsageToCredits(data?.usage);
    throttleSnapshot = updateThrottleState({ estimatedNextCost: 0 });
    usageMetadata = formatUsageMetadata(data?.usage, getCreditState(), throttleSnapshot);
    updateCreditPreview({ force: true });
    updateCreditUI();
    await refreshAnalyticsAndThrottle({ force: true });
    generationFeedback.stop();
  } catch (error) {
    generationFeedback.stop();
    finalizeChatOnce(() => {
      renderAssistantMessage(
        pendingMessageId,
        '⚠️ Something went wrong while generating the response.',
        [{ text: formatGenerationMetadata(performance.now() - startedAt) }]
      );
    });
    unlockChat();
    stopLoading();
    return;
  }

  let extractedText = '';
  let extractedCode = '';
  try {
    const { text, code } = extractTextAndCode(rawReply);
    extractedText = text;
    extractedCode = code;
  } catch (error) {
    console.error('Post-generation parsing failed.', error);
    extractedText = String(rawReply ?? '');
  }

  const hasCode = Boolean(extractedCode && extractedCode.trim());
  console.assert(
    hasCode || !extractedText.includes('<'),
    'Text-only response attempted to modify UI'
  );
  if (hasCode && (!extractedText || !extractedText.trim())) {
    extractedText = `Okay — I generated and ran an updated interface for: “${userInput}”.`;
  }
  if (!hasCode) {
    const assistantProposal = getAssistantProposal(extractedText);
    if (assistantProposal) {
      pendingAssistantProposal = assistantProposal;
    }
  }

  const elapsed = performance.now() - startedAt;
  const baseMetadata = generationMetadata || formatGenerationMetadata(elapsed);
  const metadataParts = [{ text: baseMetadata }];
  if (usageMetadata.usageText) {
    metadataParts.push({ text: usageMetadata.usageText, className: 'assistant-meta-usage' });
  }
  if (usageMetadata.warningText) {
    metadataParts.push({ text: usageMetadata.warningText, className: 'assistant-meta-warning' });
  }
  if (!hasCode) {
    finalizeChatOnce(() => {
      renderAssistantMessage(pendingMessageId, extractedText, metadataParts);
    });
    unlockChat();
    stopLoading();
    return;
  }

  finalizeChatOnce(() => {
    const messageEl = renderAssistantMessage(pendingMessageId, extractedText, metadataParts);
    maybeShowInlineNudge(messageEl, { throttle: throttleSnapshot });
  });

  try {
    if (hasCode) {
      currentCode = extractedCode;
      setCodeFromLLM(extractedCode);
      pendingAssistantProposal = null;
      runWhenPreviewReady(() => {
        handleLLMOutput(extractedCode, 'generated').catch((error) => {
          console.error('Auto-run failed after generation.', error);
          addExecutionWarning('Preview auto-run failed. Try Run Code.');
          setPreviewExecutionStatus('error', 'PREVIEW ERROR');
        });
      });
    }
    updateGenerationIndicator();
  } catch (error) {
    console.error('Post-generation UI update failed.', error);
  }

  unlockChat();
  stopLoading();
  maybeShowUsagePaywall({ reason: 'usage' });
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChat();
});

if (chatInput) {
  chatInput.addEventListener('input', () => {
    requestCreditPreviewUpdate();
    requestThrottleUpdate();
  });
}

if (creditBadge && creditPanel) {
  const closeCreditPanel = () => {
    creditPanel.classList.add('hidden');
    creditBadge.setAttribute('aria-expanded', 'false');
  };

  const openCreditPanel = () => {
    creditPanel.classList.remove('hidden');
    creditBadge.setAttribute('aria-expanded', 'true');
  };

  creditBadge.addEventListener('click', (event) => {
    event.stopPropagation();
    if (creditPanel.classList.contains('hidden')) {
      openCreditPanel();
    } else {
      closeCreditPanel();
    }
  });

  creditBadge.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (creditPanel.classList.contains('hidden')) {
        openCreditPanel();
      } else {
        closeCreditPanel();
      }
    }
  });

  document.addEventListener('click', (event) => {
    if (!creditPanel.contains(event.target) && !creditBadge.contains(event.target)) {
      closeCreditPanel();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCreditPanel();
    }
  });
}

let closeUserMenu = null;

if (userMenuTrigger && userMenu) {
  closeUserMenu = () => {
    userMenu.style.display = 'none';
  };

  const openUserMenu = () => {
    userMenu.style.display = 'block';
  };

  userMenuTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (userMenu.style.display !== 'block') {
      openUserMenu();
    } else {
      closeUserMenu();
    }
  });

  document.addEventListener('click', () => {
    closeUserMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeUserMenu();
    }
  });
}

if (pricingModal) {
  const closePricingModal = () => {
    pricingModal.classList.add('hidden');
  };

  const openPricingModal = () => {
    pricingModal.classList.remove('hidden');
  };

  pricingOpenButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeUserMenu?.();
      openPricingModal();
    });
  });

  upgradePlanButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeUserMenu?.();
    openPricingModal();
  });

  pricingCloseButton?.addEventListener('click', () => {
    closePricingModal();
  });

  pricingModal.addEventListener('click', (event) => {
    if (event.target === pricingModal) {
      closePricingModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePricingModal();
    }
  });

  if (pricingCollapseButton && pricingModalBody) {
    const updateCollapseState = (collapsed) => {
      pricingModalBody.classList.toggle('collapsed', collapsed);
      pricingCollapseButton.setAttribute('aria-expanded', String(!collapsed));
      pricingCollapseButton.textContent = collapsed ? 'Expand' : 'Collapse';
    };

    pricingCollapseButton.addEventListener('click', () => {
      updateCollapseState(!pricingModalBody.classList.contains('collapsed'));
    });
  }
}

const signOutButton = document.getElementById('signOutBtn');

if (signOutButton) {
  signOutButton.addEventListener('click', () => {
    ModalManager.open(`
      <h3>Sign out?</h3>
      <p>You’ll need to sign in again to continue.</p>
      <div class="modal-actions">
        <button class="secondary" onclick="ModalManager.close()">Cancel</button>
        <button class="danger" id="confirmSignOut">Sign Out</button>
      </div>
    `, { dismissible: true });

    requestAnimationFrame(() => {
      const confirmButton = document.getElementById('confirmSignOut');
      if (confirmButton) {
        confirmButton.onclick = signOut;
      }
    });
  });
}

if (usageOpenButtons.length && usageModal) {
  usageOpenButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      creditPanel?.classList.add('hidden');
      creditBadge?.setAttribute('aria-expanded', 'false');
      onAnalyticsClick();
    });
  });
}

if (usageCloseButton) {
  usageCloseButton.addEventListener('click', closeUsageModal);
}

if (usageModal) {
  usageModal.addEventListener('click', (event) => {
    if (event.target === usageModal) {
      closeUsageModal();
    }
  });
}

if (paywallBackdrop) {
  paywallBackdrop.addEventListener('click', () => {
    if (paywallModal?.classList.contains('dismissable')) {
      hidePaywall();
    }
  });
}

if (paywallCloseButton) {
  paywallCloseButton.addEventListener('click', () => {
    if (paywallModal?.classList.contains('dismissable')) {
      hidePaywall();
    }
  });
}

paywallPlanButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const plan = button.dataset.paywallPlan;
    if (!plan) {
      return;
    }
    updatePaywallPlanSelection(plan);
    const currentMode = paywallModal?.dataset.mode || 'firm';
    updatePaywallCtas(currentMode, plan);
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !isPaywallVisible) {
    return;
  }
  if (paywallModal?.classList.contains('dismissable')) {
    hidePaywall();
  }
});

const initialSelectedPlan = getStoredPaywallPlan() || 'starter';
updatePaywallPlanSelection(initialSelectedPlan);

if (window.location?.search) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('upgrade') === 'success') {
    markPaywallUpgradeCompleted();
  }
}

if (usageTabs.length) {
  usageTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      if (!target) {
        return;
      }
      usageTabs.forEach((item) => {
        const isActive = item === tab;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      usageTabPanels.forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.tabPanel === target);
      });
      usageState.activeTab = target;
    });
  });
}

if (usageLoadMore) {
  usageLoadMore.addEventListener('click', () => {
    usageState.rangeIndex = Math.min(usageState.rangeIndex + 1, USAGE_RANGE_STEPS.length - 1);
    refreshUsageView();
  });
}

if (usageApplyFilters) {
  usageApplyFilters.addEventListener('click', () => {
    usageState.rangeIndex = 0;
    refreshUsageView();
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeAllModals();
    unlockUI();
  }
});

if (usageFilters) {
  const isAdmin = window.location.pathname.startsWith('/admin/usage');
  if (isAdmin) {
    usageFilters.classList.remove('hidden');
    initializeUsageFilters().then(() => {
      refreshUsageView();
    });
  }
}

window.addEventListener('resize', () => {
  const state = getCreditState();
  updateCreditBadge({
    remaining: state.remainingCredits ?? 0,
    total: state.creditsTotal ?? 0,
    plan: state.planLabel
  });
});

codeEditor.addEventListener('input', () => {
  const hasEdits = codeEditor.value !== baselineCode;
  userHasEditedCode = hasEdits;
  if (hasEdits) {
    lastCodeSource = 'user';
  }
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  if (hasEdits) {
    markPreviewStale();
  }
  resetExecutionPreparation();
  updateLineNumbers();
  requestCreditPreviewUpdate();
});

codeEditor.addEventListener('scroll', () => {
  if (!lineNumbersEl) {
    return;
  }
  lineNumbersEl.scrollTop = codeEditor.scrollTop;
});

document.addEventListener('DOMContentLoaded', () => {
  bootstrapApp();
});

document.addEventListener('DOMContentLoaded', () => {
  if (!runButton) {
    console.warn('⚠️ Run Code button not found');
    return;
  }
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  console.log('✅ Run Code listener attached');
  runButton.addEventListener('click', () => {
    console.log('🟢 Run Code clicked');
    if (!userHasEditedCode || lastCodeSource !== 'user') {
      return;
    }
    handleUserRun(codeEditor.value);
  });
  if (!rollbackButton) {
    console.warn('⚠️ Rollback button not found');
    return;
  }
  rollbackButton.addEventListener('click', () => {
    if (!lastLLMCode) {
      return;
    }
    userHasEditedCode = false;
    lastCodeSource = 'llm';
    codeEditor.value = lastLLMCode;
    baselineCode = lastLLMCode;
    updateRunButtonVisibility();
    updateRollbackVisibility();
    updatePromoteVisibility();
    updateLineNumbers();
    handleUserRun(lastLLMCode, 'rolled back', 'Rolling back to last generated…');
    setStatus('RUNNING', 'rolled back');
  });
  if (!promoteButton) {
    console.warn('⚠️ Promote button not found');
    return;
  }
  promoteButton.addEventListener('click', () => {
    const currentCode = codeEditor.value;
    lastLLMCode = currentCode;
    baselineCode = currentCode;
    userHasEditedCode = false;
    lastCodeSource = 'user';
    updateRunButtonVisibility();
    updateRollbackVisibility();
    updatePromoteVisibility();
    setStatus('BASELINE · promoted');
  });

  setSandboxControlsVisible(false);
  if (sandboxPauseButton) {
    sandboxPauseButton.addEventListener('click', pauseSandbox);
  }
  if (sandboxResumeButton) {
    sandboxResumeButton.addEventListener('click', resumeSandbox);
  }
  if (sandboxResetButton) {
    sandboxResetButton.addEventListener('click', resetSandbox);
  }
  if (sandboxStopButton) {
    sandboxStopButton.addEventListener('click', stopSandboxFromUser);
  }

});

codeEditor.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    if (!userHasEditedCode || lastCodeSource !== 'user') {
      return;
    }
    handleUserRun(codeEditor.value);
  }
});

if (splitter && rightPane && codePanel && outputPanel) {
  let isDragging = false;

  splitter.addEventListener('mousedown', () => {
    isDragging = true;
    document.body.style.cursor = 'row-resize';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.cursor = '';
  });

  document.addEventListener('mousemove', (event) => {
    if (!isDragging) {
      return;
    }

    const rect = rightPane.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const min = 140;
    const max = rect.height - 140;
    const clamped = Math.max(min, Math.min(max, offsetY));

    codePanel.style.flex = `0 0 ${clamped}px`;
    outputPanel.style.flex = '1 1 auto';
  });
}

if (fullscreenToggle && consolePane) {
  const enterFullscreen = () => {
    consolePane.classList.add('preview-fullscreen');
    outputPanel?.classList.add('preview-fullscreen');
    document.body.style.overflow = 'hidden';
    fullscreenToggle.textContent = '⤡ Exit Fullscreen';
    fullscreenToggle.classList.add('fullscreen-exit');
  };

  const exitFullscreen = () => {
    consolePane.classList.remove('preview-fullscreen');
    outputPanel?.classList.remove('preview-fullscreen');
    document.body.style.overflow = '';
    fullscreenToggle.textContent = '⤢ Fullscreen';
    fullscreenToggle.classList.remove('fullscreen-exit');
  };

  fullscreenToggle.addEventListener('click', () => {
    const isFullscreen = consolePane.classList.contains('preview-fullscreen');
    if (isFullscreen) {
      exitFullscreen();
      return;
    }
    enterFullscreen();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && consolePane.classList.contains('preview-fullscreen')) {
      exitFullscreen();
    }
  });

  consolePane.addEventListener('dblclick', (event) => {
    event.preventDefault();
    const isFullscreen = consolePane.classList.contains('preview-fullscreen');
    if (isFullscreen) {
      exitFullscreen();
      return;
    }
    enterFullscreen();
  });

}

const upgradeModal = document.getElementById('upgradeModal');
const upgradeCloseButton = document.querySelector('[data-upgrade-close]');

const openUpgradeModal = () => {
  if (!upgradeModal) {
    return;
  }
  upgradeModal.classList.remove('hidden');
};

const closeUpgradeModal = () => {
  if (!upgradeModal) {
    return;
  }
  upgradeModal.classList.add('hidden');
};

if (upgradeCloseButton) {
  upgradeCloseButton.addEventListener('click', () => closeUpgradeModal());
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && upgradeModal && !upgradeModal.classList.contains('hidden')) {
    closeUpgradeModal();
  }
});

setStatusOnline(false);
updateGenerationIndicator();
setPreviewStatus('Ready — auto-run enabled');
setPreviewExecutionStatus('ready', 'Ready');

if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  preview.once('ready', () => {
    console.assert(
      !currentTurnMessageId || chatFinalized,
      'Preview ready before chat finalized'
    );
  });
}
