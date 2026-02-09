"use strict";

import { createSandboxController } from './sandboxController.js';
import { formatNumber } from './utils/formatNumber.js';

if (!window.GOOGLE_CLIENT_ID) {
  console.warn('Missing GOOGLE_CLIENT_ID. Google auth disabled.');
}

const API_BASE =
  location.hostname.includes('localhost')
    ? 'http://localhost:8080'
    : 'https://maya-api-136741418395.us-central1.run.app';


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
const sessionTurnsEl = document.getElementById('session-turns');
const sessionCreditsEl = document.getElementById('session-credits');
const sessionDurationEl = document.getElementById('session-duration');
const sessionPreviousEl = document.getElementById('session-previous');
const creditInlineWarning = document.getElementById('credit-inline-warning');
const creditBanner = document.getElementById('credit-banner');
const creditZero = document.getElementById('credit-zero');
const creditDailyMessage = document.getElementById('credit-daily-message');
const creditUpgradeNudge = document.getElementById('credit-upgrade-nudge');
const userMenuTrigger = document.getElementById('userMenuTrigger');
const userMenu = document.getElementById('userMenu');
const accountLink = document.getElementById('accountLink');
const galleryLink = document.getElementById('galleryLink');
const publicGalleryButton = document.getElementById('publicGalleryButton');
const accountPage = document.getElementById('account-page');
const accountBackButton = document.getElementById('accountBack');
const accountProfileEditButton = document.getElementById('accountProfileEdit');
const accountEmailEl = document.getElementById('accountEmail');
const accountAuthMethodsEl = document.getElementById('accountAuthMethods');
const accountCreatedDateEl = document.getElementById('accountCreatedDate');
const accountAgeEl = document.getElementById('accountAge');
const accountUserIdEl = document.getElementById('accountUserId');
const accountCopyUserIdButton = document.getElementById('accountCopyUserId');
const accountPlanTierEl = document.getElementById('accountPlanTier');
const accountBillingStatusEl = document.getElementById('accountBillingStatus');
const accountRenewalDateEl = document.getElementById('accountRenewalDate');
const accountCreditsRemainingEl = document.getElementById('accountCreditsRemaining');
const accountCreditsTotalEl = document.getElementById('accountCreditsTotal');
const accountCreditsResetEl = document.getElementById('accountCreditsReset');
const accountPrimaryActionButton = document.getElementById('accountPrimaryAction');
const accountBuyCreditsButton = document.getElementById('accountBuyCredits');
const accountSessionStartedEl = document.getElementById('accountSessionStarted');
const accountSessionTurnsEl = document.getElementById('accountSessionTurns');
const accountSessionCreditsEl = document.getElementById('accountSessionCredits');
const accountSessionTokensEl = document.getElementById('accountSessionTokens');
const accountClearSessionButton = document.getElementById('accountClearSession');
const accountSaveSessionButton = document.getElementById('accountSaveSession');
const accountArtifactsPrivateEl = document.getElementById('accountArtifactsPrivate');
const accountArtifactsPublicEl = document.getElementById('accountArtifactsPublic');
const accountViewGalleryButton = document.getElementById('accountViewGallery');
const accountViewPublicGalleryButton = document.getElementById('accountViewPublicGallery');
const accountViewProfileButton = document.getElementById('accountViewProfile');
const accountSessionHistoryBody = document.getElementById('accountSessionHistoryBody');
const accountSessionHistoryEmpty = document.getElementById('accountSessionHistoryEmpty');
const accountHistoryRangeLabel = document.getElementById('accountHistoryRange');
const accountHistoryLoadMore = document.getElementById('accountHistoryLoadMore');
const accountMonthCreditsEl = document.getElementById('accountMonthCredits');
const accountMonthSessionsEl = document.getElementById('accountMonthSessions');
const accountMonthAvgCreditsEl = document.getElementById('accountMonthAvgCredits');
const accountDownloadLatestButton = document.getElementById('accountDownloadLatest');
const accountSignOutButton = document.getElementById('accountSignOut');
const accountDeleteButton = document.getElementById('accountDelete');
const upgradePlanButton = document.getElementById('upgradePlan');
const profileEditLink = document.getElementById('profileEditLink');
const publicProfilePage = document.getElementById('public-profile-page');
const profileEditPage = document.getElementById('profile-edit-page');
const profileBackButton = document.getElementById('profileBackButton');
const profileEditBackButton = document.getElementById('profileEditBackButton');
const profileAvatar = document.getElementById('profileAvatar');
const profileDisplayName = document.getElementById('profileDisplayName');
const profileHandle = document.getElementById('profileHandle');
const profileBio = document.getElementById('profileBio');
const profileLocation = document.getElementById('profileLocation');
const profileStatArtifacts = document.getElementById('profileStatArtifacts');
const profileStatLikes = document.getElementById('profileStatLikes');
const profileStatComments = document.getElementById('profileStatComments');
const profileStatForks = document.getElementById('profileStatForks');
const profileTabs = document.querySelectorAll('[data-profile-tab]');
const profileTabArtifacts = document.getElementById('profileTabArtifacts');
const profileTabForks = document.getElementById('profileTabForks');
const profileTabAbout = document.getElementById('profileTabAbout');
const profileArtifactsGrid = document.getElementById('profileArtifactsGrid');
const profileForksGrid = document.getElementById('profileForksGrid');
const profileArtifactsEmpty = document.getElementById('profileArtifactsEmpty');
const profileForksEmpty = document.getElementById('profileForksEmpty');
const profileAboutBio = document.getElementById('profileAboutBio');
const profileAboutDemographics = document.getElementById('profileAboutDemographics');
const profileAboutCreated = document.getElementById('profileAboutCreated');
const profileEditForm = document.getElementById('profileEditForm');
const profileAvatarInput = document.getElementById('profileAvatarInput');
const profileEditAvatarPreview = document.getElementById('profileEditAvatarPreview');
const profileHandleInput = document.getElementById('profileHandleInput');
const profileHandleStatus = document.getElementById('profileHandleStatus');
const profileDisplayNameInput = document.getElementById('profileDisplayNameInput');
const profileBioInput = document.getElementById('profileBioInput');
const profileBioCount = document.getElementById('profileBioCount');
const profileAgeInput = document.getElementById('profileAgeInput');
const profileGenderInput = document.getElementById('profileGenderInput');
const profileCityInput = document.getElementById('profileCityInput');
const profileCountryInput = document.getElementById('profileCountryInput');
const profileSaveButton = document.getElementById('profileSaveButton');
const profileCancelButton = document.getElementById('profileCancelButton');
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
const saveCodeButton = document.getElementById('saveCodeBtn');
const galleryPage = document.getElementById('gallery-page');
const publicGalleryPage = document.getElementById('public-gallery-page');
const galleryGrid = document.getElementById('galleryGrid');
const publicGalleryGrid = document.getElementById('publicGalleryGrid');
const galleryEmpty = document.getElementById('galleryEmpty');
const publicGalleryEmpty = document.getElementById('publicGalleryEmpty');
const galleryBackButton = document.getElementById('galleryBackButton');
const publicGalleryBackButton = document.getElementById('publicGalleryBackButton');
const publicGallerySortButtons = document.querySelectorAll('#public-gallery-page [data-sort]');
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
const clearChatButton = document.getElementById('clearChatButton');
const toast = document.getElementById('toast');
const lineNumbersEl = document.getElementById('line-numbers');
const lineCountEl = document.getElementById('line-count');
const consoleLog = document.getElementById('console-output-log');
const consolePane = document.getElementById('consoleOutput');
const root = document.getElementById('root');
const workspace = document.getElementById('workspace');
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
const revertButton = document.getElementById('revertButton');
const forwardButton = document.getElementById('forwardButton');
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
const runtimeState = {
  status: 'idle',
  started_at: null
};
let navigationInProgress = false;
let revertModalOpen = false;
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

const DEFAULT_MODEL = 'gpt-4.1-mini';
const SYSTEM_BASE = 'You are Maya, an AI assistant embedded in a real-time creative and technical workspace.';
const PERSONALITY_LAYER = `Default behavior:
- Be proactive and demonstrate capability when possible.
- If the user input is underspecified, choose a reasonable, concrete task and execute it.
- Prefer generating working code, UI components, or functional examples over discussion.

Tone constraints:
- Use a grounded, professional, and direct tone.
- Avoid whimsical, mystical, or anthropomorphic language.
- Avoid filler phrases, metaphors, or performative enthusiasm.
- Do not narrate your own process or intent.

Creativity guidelines:
- Be creative in *solutions*, structure, and execution.
- Do not be creative in *tone* unless explicitly requested.

Assume the user is evaluating capability unless stated otherwise.`;
const CHAT_PROMPT_CONTENT = `Output rules:
- Never output JSON, YAML, or code fences.
- If you return HTML, the FIRST line must be:
  <!--CHAT: <a short conversational message for the user> -->
  Then output a complete HTML document.
- If no HTML is needed, output plain conversational text only.
- If a visual is requested as part of a technical discussion, prioritize correctness and demonstration over expressiveness or celebration.`;
const EXECUTION_PROMPT_CONTENT = `Respond with correct, production-quality code.
Do not explain unless asked.
Do not use conversational language.
No metaphors. No encouragement. No emojis. No hedging language.
Avoid: “Here’s”, “Let’s”, “You can”, “This helps”, “In this example”, “We”.

Output rules:
- Never output JSON, YAML, or code fences.
- If you return HTML, the FIRST line must be:
  <!--CHAT: <a short neutral status message> -->
  Then output a complete HTML document.
- If no HTML is needed, output plain text only.`;

function buildPrompt({ role, content }) {
  const base = SYSTEM_BASE;

  if (role === 'metadata' || role === 'execution') {
    return [
      base,
      'Disable conversational tone.',
      'Prioritize precision over friendliness.',
      content
    ].join('\n\n');
  }

  return [base, PERSONALITY_LAYER, content].join('\n\n');
}

function getSystemPromptForIntent(resolvedIntent) {
  if (resolvedIntent?.type === 'code') {
    return buildPrompt({ role: 'execution', content: EXECUTION_PROMPT_CONTENT });
  }
  return buildPrompt({ role: 'chat', content: CHAT_PROMPT_CONTENT });
}

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
const ANALYTICS_CACHE_TTL_MS = 45 * 1000;
const ANALYTICS_TIMEOUT_MS = 3000;
const USAGE_FETCH_TIMEOUT_MS = 5000;
const USAGE_RANGE_STEPS = [14, 30, 60, 90];
const ACCOUNT_RANGE_STEPS = [30, 60, 90];
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

const accountState = {
  user: null,
  plan: null,
  credits: null,
  currentSession: null,
  sessionHistory: [],
  rangeIndex: 0,
  loading: false
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
  accountState.user = user;

  uiState = UI_STATE.APP;
  showAnalytics = false;

  document.body.classList.remove('unauthenticated');
  document.getElementById('modal-root')?.classList.add('hidden');
  document.getElementById('root')?.classList.remove('hidden');

  renderUserHeader();
  renderCredits();
  updateAccountOverview();
  updateAccountPlan();
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

function updateCreditsUI(remaining, total) {
  const resolvedTotal = Number.isFinite(total)
    ? total
    : Number.isFinite(remaining)
      ? remaining
      : 500;
  const resolvedRemaining = Number.isFinite(remaining)
    ? clamp(remaining, 0, resolvedTotal)
    : resolvedTotal;
  if (currentUser) {
    currentUser.creditsRemaining = resolvedRemaining;
    currentUser.creditsTotal = resolvedTotal;
  }
  if (root) {
    root.dataset.remainingCredits = `${resolvedRemaining}`;
    root.dataset.creditsTotal = `${resolvedTotal}`;
  }
  if (window.localStorage) {
    window.localStorage.setItem('maya_credits_remaining', `${resolvedRemaining}`);
    window.localStorage.setItem('maya_credits_total', `${resolvedTotal}`);
  }
  updateCreditUI();
  renderCredits();
  updateAccountPlan();
}

function hydrateCreditState() {
  if (!window.localStorage) {
    return;
  }
  const storedRemaining = Number(
    window.localStorage.getItem('maya_credits_remaining')
    ?? window.localStorage.getItem('maya_credits')
  );
  const storedTotal = Number(window.localStorage.getItem('maya_credits_total'));
  if (Number.isFinite(storedRemaining)) {
    updateCreditsUI(storedRemaining, Number.isFinite(storedTotal) ? storedTotal : storedRemaining);
  }
}

function resolveCredits(credits) {
  if (Number.isFinite(credits)) {
    return credits;
  }
  const storedCredits = Number(
    window.localStorage?.getItem('maya_credits_remaining')
    ?? window.localStorage?.getItem('maya_credits')
  );
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
  const resolvedRemaining = resolveCredits(
    credits
    ?? user?.credits_remaining
    ?? user?.creditsRemaining
  );
  const resolvedTotal = Number(
    user?.credits_total
    ?? user?.creditsTotal
    ?? resolvedRemaining
  );
  const clampedRemaining = clamp(
    resolvedRemaining,
    0,
    Number.isFinite(resolvedTotal) ? resolvedTotal : resolvedRemaining
  );
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
    creditsRemaining: clampedRemaining,
    creditsTotal: Number.isFinite(resolvedTotal) ? resolvedTotal : clampedRemaining
  };
  accountState.user = user;

  if (window.localStorage) {
    window.localStorage.setItem('maya_credits_remaining', `${clampedRemaining}`);
    window.localStorage.setItem(
      'maya_credits_total',
      `${Number.isFinite(resolvedTotal) ? resolvedTotal : clampedRemaining}`
    );
    window.localStorage.setItem('maya_credits', `${clampedRemaining}`);
  }

  document.body.classList.remove('unauthenticated');
  applyAuthToRoot();
  updateCreditsUI(clampedRemaining, resolvedTotal);
  renderUserHeader();
  renderCredits();
  updateAccountOverview();
  updateAccountPlan();

  uiState = UI_STATE.APP;
  showAnalytics = false;
  if (!deferRender) {
    renderUI();
    ModalManager.close();
  }

  syncSessionToSandbox();
}

async function handleGoogleCredential(response) {
  const res = await fetch(`${API_BASE}/api/auth/google`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    // Google Identity Services returns a JWT ID token via response.credential.
    // Send as id_token to align with backend expectations.
    body: JSON.stringify({ id_token: response.credential })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn('Google auth failed.', data);
    return;
  }

  const meRes = await fetch(`${API_BASE}/api/me`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!meRes.ok) {
    console.error('Failed to fetch /me', meRes.status);
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
  const totalCredits = Number(user?.creditsTotal ?? user?.credits_total ?? user?.creditsRemaining ?? 500);
  updateCreditsUI(user?.creditsRemaining ?? 500, totalCredits);
  bootstrapAuthenticatedUI({
    ...user,
    plan: user?.plan ?? 'Free',
    creditsRemaining: user?.creditsRemaining ?? 500,
    creditsTotal: totalCredits
  });
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
    const res = await window.AppleID.auth.signIn();
    const auth = res.authorization;

    const server = await fetch(`${API_BASE}/api/auth/apple`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_token: auth.id_token || auth.idToken,
        code: auth.code
      })
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

let toastTimerId = null;

function showToast(message, { variant = 'error', duration = 4000 } = {}) {
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.classList.toggle('error', variant === 'error');
  toast.classList.remove('hidden');
  if (toastTimerId) {
    clearTimeout(toastTimerId);
  }
  toastTimerId = setTimeout(() => {
    toast.classList.add('hidden');
    toast.classList.remove('error');
  }, duration);
}

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

function updateClearChatButtonState() {
  if (!clearChatButton) {
    return;
  }
  const hasMessages = Boolean(chatMessages?.querySelector('.message'));
  clearChatButton.disabled = !hasMessages;
}

function clearChatState() {
  if (chatMessages) {
    chatMessages.innerHTML = '';
    chatMessages.scrollTop = 0;
  }
  if (chatInput) {
    chatInput.value = '';
  }
  chatFinalized = false;
  currentTurnMessageId = null;
  pendingAssistantProposal = null;
  intentAnchor = null;
  chatState.locked = false;
  if (sessionState) {
    sessionState.messages = [];
    scheduleSessionStatePersist();
  }
  if (chatState.unlockTimerId) {
    clearTimeout(chatState.unlockTimerId);
    chatState.unlockTimerId = null;
  }
  updateClearChatButtonState();
}

const SESSION_STATE_SCHEMA_VERSION = '1.2';
const SESSION_STATE_STORAGE_KEY_PREFIX = 'maya_session_state:';
const SESSION_STATE_DB_NAME = 'maya_dev_ui';
const SESSION_STATE_DB_VERSION = 3;
const SESSION_STATE_STORE_NAME = 'sessions';
const SESSION_MESSAGES_STORE_NAME = 'messages';
const SESSION_CODE_STORE_NAME = 'code_versions';
const SESSION_EDITOR_STORE_NAME = 'editor_state';
const SESSION_ARTIFACTS_STORE_NAME = 'artifacts';
const SESSION_KV_STORE_NAME = 'local_kv';
const SESSION_STATE_PERSIST_DEBOUNCE_MS = 500;

let sessionState = null;
let sessionStatePersistTimer = null;
let sessionStateDbPromise = null;

function requestToPromise(request, fallback = null) {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result ?? fallback);
    request.onerror = () => resolve(fallback);
  });
}

function getSessionIndexRange(sessionId, value) {
  if (!window.IDBKeyRange) {
    return null;
  }
  return window.IDBKeyRange.bound([sessionId, value], [sessionId, '\uffff']);
}

function getVersionStorageKey(id = sessionId) {
  return `maya_code_versions:${id || 'default'}`;
}

function getSessionStateStorageKey(id = sessionId) {
  return `${SESSION_STATE_STORAGE_KEY_PREFIX}${id || 'default'}`;
}

function generateVersionId() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `version-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generateMessageId() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createInitialSessionState() {
  return {
    session_id: sessionId,
    started_at: sessionStartedAt || new Date().toISOString(),
    current_editor: {
      language: 'html',
      content: codeEditor?.value ?? defaultInterfaceCode,
      version_id: ''
    },
    messages: [],
    code_versions: [],
    active_version_index: -1
  };
}

function openSessionStateDb() {
  if (!window.indexedDB) {
    return Promise.resolve(null);
  }
  if (sessionStateDbPromise) {
    return sessionStateDbPromise;
  }
  sessionStateDbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(SESSION_STATE_DB_NAME, SESSION_STATE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STATE_STORE_NAME)) {
        const sessions = db.createObjectStore(SESSION_STATE_STORE_NAME, { keyPath: 'session_id' });
        sessions.createIndex('active', 'active');
        sessions.createIndex('started_at', 'started_at');
      }
      if (!db.objectStoreNames.contains(SESSION_MESSAGES_STORE_NAME)) {
        const messages = db.createObjectStore(SESSION_MESSAGES_STORE_NAME, { keyPath: 'id' });
        messages.createIndex('session_id', 'session_id');
        messages.createIndex('timestamp', 'timestamp');
        messages.createIndex('session_time', ['session_id', 'timestamp']);
      }
      if (!db.objectStoreNames.contains(SESSION_CODE_STORE_NAME)) {
        const code = db.createObjectStore(SESSION_CODE_STORE_NAME, { keyPath: 'id' });
        code.createIndex('session_id', 'session_id');
        code.createIndex('created_at', 'created_at');
        code.createIndex('session_time', ['session_id', 'created_at']);
      }
      if (!db.objectStoreNames.contains(SESSION_EDITOR_STORE_NAME)) {
        db.createObjectStore(SESSION_EDITOR_STORE_NAME, { keyPath: 'session_id' });
      }
      if (!db.objectStoreNames.contains(SESSION_ARTIFACTS_STORE_NAME)) {
        const artifacts = db.createObjectStore(SESSION_ARTIFACTS_STORE_NAME, { keyPath: 'artifact_id' });
        artifacts.createIndex('user_id', 'user_id');
        artifacts.createIndex('visibility', 'visibility');
        artifacts.createIndex('created_at', 'created_at');
      }
      if (!db.objectStoreNames.contains(SESSION_KV_STORE_NAME)) {
        db.createObjectStore(SESSION_KV_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return sessionStateDbPromise;
}

async function getSessionMessagesFromIndexedDb(db, id) {
  const tx = db.transaction(SESSION_MESSAGES_STORE_NAME, 'readonly');
  const store = tx.objectStore(SESSION_MESSAGES_STORE_NAME);
  if (store.indexNames.contains('session_time')) {
    const range = getSessionIndexRange(id, '');
    if (range) {
      return requestToPromise(store.index('session_time').getAll(range), []);
    }
  }
  if (store.indexNames.contains('session_id')) {
    const records = await requestToPromise(store.index('session_id').getAll(id), []);
    return records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }
  return [];
}

async function getSessionCodeVersionsFromIndexedDb(db, id) {
  const tx = db.transaction(SESSION_CODE_STORE_NAME, 'readonly');
  const store = tx.objectStore(SESSION_CODE_STORE_NAME);
  if (store.indexNames.contains('session_time')) {
    const range = getSessionIndexRange(id, '');
    if (range) {
      return requestToPromise(store.index('session_time').getAll(range), []);
    }
  }
  if (store.indexNames.contains('session_id')) {
    const records = await requestToPromise(store.index('session_id').getAll(id), []);
    return records.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  return [];
}

async function loadLastOpenSessionId(db) {
  const tx = db.transaction(SESSION_KV_STORE_NAME, 'readonly');
  const store = tx.objectStore(SESSION_KV_STORE_NAME);
  const record = await requestToPromise(store.get('last_open_session'), null);
  return record?.value || null;
}

async function findActiveSessionId(db) {
  const tx = db.transaction(SESSION_STATE_STORE_NAME, 'readonly');
  const store = tx.objectStore(SESSION_STATE_STORE_NAME);
  if (!store.indexNames.contains('active')) {
    return null;
  }
  const activeSessions = await requestToPromise(store.index('active').getAll(true), []);
  if (!activeSessions.length) {
    return null;
  }
  activeSessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  return activeSessions[0]?.session_id || null;
}

async function loadSessionStateFromIndexedDb(id) {
  const db = await openSessionStateDb();
  if (!db) {
    return null;
  }
  const tx = db.transaction([
    SESSION_STATE_STORE_NAME,
    SESSION_EDITOR_STORE_NAME
  ], 'readonly');
  const sessionStore = tx.objectStore(SESSION_STATE_STORE_NAME);
  const editorStore = tx.objectStore(SESSION_EDITOR_STORE_NAME);
  const sessionRecord = await requestToPromise(sessionStore.get(id), null);
  if (!sessionRecord) {
    return null;
  }
  const [messages, codeVersions, editorState] = await Promise.all([
    getSessionMessagesFromIndexedDb(db, id),
    getSessionCodeVersionsFromIndexedDb(db, id),
    requestToPromise(editorStore.get(id), null)
  ]);
  const activeVersionId = editorState?.active_version_id || '';
  const activeIndex = activeVersionId
    ? codeVersions.findIndex((entry) => entry.id === activeVersionId)
    : -1;
  const latestVersion = codeVersions.at(-1);
  return {
    session_id: sessionRecord.session_id,
    started_at: sessionRecord.started_at,
    current_editor: {
      language: editorState?.language || latestVersion?.language || 'html',
      content: latestVersion?.content ?? (codeEditor?.value ?? defaultInterfaceCode),
      version_id: activeVersionId
    },
    messages,
    code_versions: codeVersions,
    active_version_index: activeIndex
  };
}

async function saveSessionSnapshotToIndexedDb(state) {
  const db = await openSessionStateDb();
  if (!db) {
    return;
  }
  const sessionRecord = {
    session_id: state.session_id,
    user_id: getUserContext().id || null,
    started_at: state.started_at || new Date().toISOString(),
    ended_at: null,
    model: DEFAULT_MODEL,
    plan: currentUser?.plan || currentUser?.planTier || null,
    turns: sessionStats.turns,
    credits_used_estimate: sessionStats.creditsUsedEstimate,
    token_input_estimate: sessionStats.tokensIn,
    token_output_estimate: sessionStats.tokensOut,
    active: true
  };
  const editorState = {
    session_id: state.session_id,
    active_version_id: state.current_editor?.version_id || '',
    language: state.current_editor?.language || 'html'
  };
  const tx = db.transaction([
    SESSION_STATE_STORE_NAME,
    SESSION_EDITOR_STORE_NAME,
    SESSION_KV_STORE_NAME
  ], 'readwrite');
  tx.objectStore(SESSION_STATE_STORE_NAME).put(sessionRecord);
  tx.objectStore(SESSION_EDITOR_STORE_NAME).put(editorState);
  tx.objectStore(SESSION_KV_STORE_NAME).put({
    key: 'last_open_session',
    value: state.session_id,
    updated_at: new Date().toISOString()
  });
}

async function appendMessageToIndexedDb(message) {
  const db = await openSessionStateDb();
  if (!db) {
    return;
  }
  const tx = db.transaction(SESSION_MESSAGES_STORE_NAME, 'readwrite');
  const store = tx.objectStore(SESSION_MESSAGES_STORE_NAME);
  try {
    store.add(message);
  } catch {
    // Ignore duplicate inserts to honor append-only constraints.
  }
}

async function appendCodeVersionToIndexedDb(version) {
  const db = await openSessionStateDb();
  if (!db) {
    return;
  }
  const tx = db.transaction(SESSION_CODE_STORE_NAME, 'readwrite');
  const store = tx.objectStore(SESSION_CODE_STORE_NAME);
  try {
    store.add(version);
  } catch {
    // Ignore duplicate inserts to honor append-only constraints.
  }
}

async function saveEditorStateToIndexedDb(state) {
  const db = await openSessionStateDb();
  if (!db) {
    return;
  }
  const tx = db.transaction(SESSION_EDITOR_STORE_NAME, 'readwrite');
  tx.objectStore(SESSION_EDITOR_STORE_NAME).put({
    session_id: state.session_id,
    active_version_id: state.current_editor?.version_id || '',
    language: state.current_editor?.language || 'html'
  });
}

function normalizeSessionState(raw) {
  if (!raw) {
    return null;
  }
  const state = raw.session_state || raw;
  if (!state || typeof state !== 'object') {
    return null;
  }
  return {
    session_id: state.session_id || sessionId,
    started_at: state.started_at || sessionStartedAt || new Date().toISOString(),
    current_editor: {
      language: state.current_editor?.language || 'html',
      content: typeof state.current_editor?.content === 'string'
        ? state.current_editor.content
        : (codeEditor?.value ?? defaultInterfaceCode),
      version_id: state.current_editor?.version_id || ''
    },
    messages: Array.isArray(state.messages) ? state.messages : [],
    code_versions: Array.isArray(state.code_versions) ? state.code_versions : [],
    active_version_index: Number.isFinite(state.active_version_index)
      ? state.active_version_index
      : -1
  };
}

function persistSessionStateNow() {
  if (!sessionState || !window.localStorage) {
    return;
  }
  const payload = {
    schema_version: SESSION_STATE_SCHEMA_VERSION,
    saved_at: new Date().toISOString(),
    session_state: sessionState
  };
  const key = getSessionStateStorageKey();
  window.localStorage.setItem(key, JSON.stringify(payload));
  saveSessionSnapshotToIndexedDb(sessionState);
}

function scheduleSessionStatePersist() {
  if (sessionStatePersistTimer) {
    clearTimeout(sessionStatePersistTimer);
  }
  sessionStatePersistTimer = setTimeout(() => {
    persistSessionStateNow();
    sessionStatePersistTimer = null;
  }, SESSION_STATE_PERSIST_DEBOUNCE_MS);
}

function loadSessionStateFromLocalStorage() {
  if (!window.localStorage) {
    return null;
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(getSessionStateStorageKey()) || 'null');
    return normalizeSessionState(stored);
  } catch {
    return null;
  }
}

async function initializeSessionState() {
  const localState = loadSessionStateFromLocalStorage();
  if (localState) {
    sessionState = localState;
    return;
  }
  const indexed = await loadSessionStateFromIndexedDb(sessionId);
  const normalized = normalizeSessionState(indexed);
  if (normalized) {
    sessionState = normalized;
    persistSessionStateNow();
    return;
  }
  const db = await openSessionStateDb();
  if (db) {
    const lastOpenId = await loadLastOpenSessionId(db);
    const activeId = lastOpenId || await findActiveSessionId(db);
    if (activeId && activeId !== sessionId) {
      const recovered = await loadSessionStateFromIndexedDb(activeId);
      const recoveredNormalized = normalizeSessionState(recovered);
      if (recoveredNormalized) {
        sessionId = activeId;
        window.sessionStorage?.setItem('mayaSessionId', sessionId);
        sessionState = recoveredNormalized;
        persistSessionStateNow();
        return;
      }
    }
  }
  sessionState = createInitialSessionState();
  persistSessionStateNow();
}

function persistVersionStack() {
  if (!window.localStorage) {
    return;
  }
  const key = getVersionStorageKey();
  window.localStorage.setItem(key, JSON.stringify(codeVersionStack));
}

function normalizeStoredVersion(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  if (typeof entry.content === 'string') {
    return {
      session_id: entry.session_id || sessionId,
      ...entry
    };
  }
  if (typeof entry.code === 'string') {
    return {
      id: entry.id || generateVersionId(),
      session_id: entry.session_id || sessionId,
      created_at: entry.createdAt || new Date().toISOString(),
      source: entry.source || 'user',
      message_id: entry.message_id || null,
      language: entry.language || 'html',
      content: entry.code,
      diff_from_previous: entry.diff_from_previous || null
    };
  }
  return null;
}

function loadVersionStack() {
  if (!window.localStorage) {
    return [];
  }
  const key = getVersionStorageKey();
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) || '[]');
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored.map(normalizeStoredVersion).filter(Boolean);
  } catch {
    return [];
  }
}

function setActiveVersionByIndex(index) {
  if (!sessionState || !Number.isFinite(index)) {
    return;
  }
  const version = codeVersionStack[index];
  if (!version) {
    return;
  }
  sessionState.active_version_index = index;
  sessionState.current_editor = {
    language: version.language || 'html',
    content: version.content,
    version_id: version.id
  };
  saveEditorStateToIndexedDb(sessionState);
  scheduleSessionStatePersist();
}

function upsertMessageEvent({
  messageId,
  role,
  contentText,
  timestamp,
  producedCodeVersionId = null
}) {
  if (!sessionState || (role !== 'user' && role !== 'assistant')) {
    return;
  }
  const existing = sessionState.messages.find((entry) => entry.id === messageId);
  const content_blocks = role === 'assistant'
    ? extractContentBlocks(contentText)
    : undefined;
  const next = {
    id: messageId,
    session_id: sessionId,
    role,
    timestamp: timestamp || new Date().toISOString(),
    content_text: contentText || '',
    content_blocks,
    tokens_estimated: estimateTokensForContent(contentText || ''),
    produced_code_version_id: producedCodeVersionId || undefined
  };
  if (existing) {
    Object.assign(existing, next);
  } else {
    sessionState.messages.push(next);
    appendMessageToIndexedDb(next);
  }
  scheduleSessionStatePersist();
}

function linkMessageToCodeVersion(messageId, versionId) {
  if (!sessionState || !messageId || !versionId) {
    return;
  }
  const existing = sessionState.messages.find((entry) => entry.id === messageId);
  if (existing) {
    existing.produced_code_version_id = versionId;
    scheduleSessionStatePersist();
  }
}

function addCodeVersion({
  content,
  source = 'user',
  messageId = null,
  language = 'html'
}) {
  const normalizedCode = typeof content === 'string' ? content : '';
  const lastVersion = codeVersionStack.at(-1);
  if (lastVersion?.content === normalizedCode) {
    return lastVersion;
  }
  const version = {
    id: generateVersionId(),
    session_id: sessionId,
    created_at: new Date().toISOString(),
    source,
    message_id: messageId || undefined,
    language,
    content: normalizedCode,
    diff_from_previous: lastVersion?.content
      ? simpleLineDiff(lastVersion.content, normalizedCode)
      : null
  };
  codeVersionStack.push(version);
  if (sessionState) {
    sessionState.code_versions = codeVersionStack;
  }
  appendCodeVersionToIndexedDb(version);
  setActiveVersionByIndex(codeVersionStack.length - 1);
  persistVersionStack();
  if (messageId) {
    linkMessageToCodeVersion(messageId, version.id);
  }
  updateUndoRedoState();
  return version;
}

function ensureCurrentCodeVersion(source = 'user') {
  if (!codeEditor) {
    return;
  }
  addCodeVersion({
    content: codeEditor.value,
    source
  });
}

function scheduleUserCodeVersionSave() {
  if (!codeEditor) {
    return;
  }
  if (userEditVersionTimer) {
    clearTimeout(userEditVersionTimer);
  }
  userEditVersionTimer = setTimeout(() => {
    addCodeVersion({
      content: codeEditor.value,
      source: 'user'
    });
    userEditVersionTimer = null;
  }, 2000);
}

function initializeVersionStack() {
  codeVersionStack.length = 0;
  const stored = sessionState?.code_versions?.length
    ? sessionState.code_versions
    : loadVersionStack();
  if (stored.length) {
    codeVersionStack.push(...stored.map(normalizeStoredVersion).filter(Boolean));
  }
  if (codeEditor && !codeVersionStack.length) {
    addCodeVersion({
      content: codeEditor.value,
      source: lastCodeSource === 'llm' ? 'llm' : 'user'
    });
  }
  if (sessionState?.active_version_index >= 0) {
    setActiveVersionByIndex(Math.min(sessionState.active_version_index, codeVersionStack.length - 1));
  } else if (codeVersionStack.length) {
    setActiveVersionByIndex(codeVersionStack.length - 1);
  }
  updateUndoRedoState();
}

function resetCodeHistory() {
  codeVersionStack.length = 0;
  persistVersionStack();
  if (sessionState) {
    sessionState.code_versions = [];
    sessionState.active_version_index = -1;
    sessionState.current_editor = {
      language: 'html',
      content: codeEditor?.value ?? defaultInterfaceCode,
      version_id: ''
    };
    scheduleSessionStatePersist();
  }
  updateUndoRedoState();
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
  resetCodeHistory();
  addCodeVersion({
    content: codeEditor.value,
    source: 'user'
  });
  updateLineNumbers();
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  updateSaveCodeButtonState();
}

function clearPreviewState() {
  if (sandboxFrame) {
    sandboxFrame.src = 'about:blank';
  }
}

function abortActiveChat({ silent = false } = {}) {
  if (!chatAbortController || !isGenerating) {
    return;
  }
  chatAbortSilent = silent;
  chatAbortController.abort();
}

function resetSessionStats() {
  sessionStats.turns = 0;
  sessionStats.creditsUsedEstimate = 0;
  sessionStats.tokensIn = 0;
  sessionStats.tokensOut = 0;
}

function buildSessionSummary(endedAt = new Date()) {
  const startedAt = sessionStartedAt || new Date().toISOString();
  const creditsUsed = Number.isFinite(sessionStats.creditsUsedEstimate)
    ? sessionStats.creditsUsedEstimate
    : 0;
  return {
    session_id: sessionId,
    started_at: startedAt,
    ended_at: endedAt.toISOString(),
    turns: sessionStats.turns,
    credits_used_estimate: creditsUsed,
    tokens_in: sessionStats.tokensIn,
    tokens_out: sessionStats.tokensOut
  };
}

function formatSessionDuration(startedAt) {
  if (!startedAt) {
    return '0 min';
  }
  const elapsedMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const minutes = Math.max(0, Math.round(elapsedMs / 60000));
  if (minutes < 1) {
    return '0 min';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

function formatDurationBetween(startedAt, endedAt) {
  if (!startedAt || !endedAt) {
    return formatSessionDuration(startedAt);
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return '—';
  }
  const elapsedMs = Math.max(0, end - start);
  const minutes = Math.max(0, Math.round(elapsedMs / 60000));
  if (minutes < 1) {
    return '0 min';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

function formatDateLong(value) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatRelativeDuration(value) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 1) {
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  const hours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
  if (hours >= 1) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const minutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function formatAuthProviders(value) {
  const providers = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((entry) => entry.trim())
      : [];
  const normalized = providers.filter(Boolean).map((provider) => {
    const lower = provider.toLowerCase();
    if (lower === 'google') return 'Google';
    if (lower === 'apple') return 'Apple';
    if (lower === 'email' || lower === 'magic') return 'Email';
    return provider;
  });
  if (!normalized.length) {
    return '—';
  }
  return normalized.join(' · ');
}

function normalizePlanTier(value) {
  if (!value) {
    return 'Free';
  }
  const lower = value.toString().toLowerCase();
  if (lower === 'starter') return 'Starter';
  if (lower === 'pro') return 'Pro';
  if (lower === 'power') return 'Power';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function resolveAccountUser() {
  return accountState.user || currentUser || Auth.user;
}

function updateAccountOverview() {
  if (!accountPage) {
    return;
  }
  const user = resolveAccountUser();
  if (accountEmailEl) {
    accountEmailEl.textContent = user?.email || '—';
  }
  if (accountAuthMethodsEl) {
    const providers = user?.auth_providers || user?.authProviders || user?.providers || user?.provider;
    accountAuthMethodsEl.textContent = formatAuthProviders(providers);
  }
  if (accountCreatedDateEl) {
    accountCreatedDateEl.textContent = formatDateLong(user?.created_at || user?.createdAt);
  }
  if (accountAgeEl) {
    accountAgeEl.textContent = formatRelativeDuration(user?.created_at || user?.createdAt);
  }
  if (accountUserIdEl) {
    accountUserIdEl.textContent = user?.user_id || user?.id || '—';
  }
}

function updateAccountPlan() {
  if (!accountPage) {
    return;
  }
  const user = resolveAccountUser();
  const planTierValue = user?.plan_tier || user?.planTier || user?.plan;
  const planTier = normalizePlanTier(planTierValue);
  if (accountPlanTierEl) {
    accountPlanTierEl.textContent = planTier;
  }
  if (accountBillingStatusEl) {
    const status = user?.billing_status || user?.billingStatus || '—';
    accountBillingStatusEl.textContent = status ? status.toString().replace(/_/g, ' ') : '—';
  }
  const resetAt = user?.monthly_reset_at || user?.monthlyResetAt;
  if (accountRenewalDateEl) {
    const isPaid = ['Pro', 'Power'].includes(planTier);
    accountRenewalDateEl.textContent = isPaid ? formatDateLong(resetAt) : '—';
  }
  const creditState = getCreditState();
  const remaining = Number(
    user?.credits_remaining
    ?? user?.creditsRemaining
    ?? creditState.remainingCredits
  );
  const total = Number(
    user?.credits_total
    ?? user?.creditsTotal
    ?? creditState.creditsTotal
  );
  if (accountCreditsRemainingEl) {
    accountCreditsRemainingEl.textContent = Number.isFinite(remaining)
      ? formatCreditNumber(remaining)
      : '—';
  }
  if (accountCreditsTotalEl) {
    accountCreditsTotalEl.textContent = Number.isFinite(total)
      ? formatCreditNumber(total)
      : '—';
  }
  if (accountCreditsResetEl) {
    if (resetAt) {
      const diffDays = Math.max(
        0,
        Math.ceil((new Date(resetAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      );
      accountCreditsResetEl.textContent = `${diffDays} day${diffDays === 1 ? '' : 's'}`;
    } else {
      accountCreditsResetEl.textContent = '—';
    }
  }
  updateAccountActions(planTierValue);
}

function updateAccountSessionSnapshot() {
  if (!accountPage) {
    return;
  }
  if (accountSessionStartedEl) {
    const relative = formatRelativeDuration(sessionStartedAt);
    accountSessionStartedEl.textContent = relative === '—' ? '—' : `${relative} ago`;
  }
  if (accountSessionTurnsEl) {
    accountSessionTurnsEl.textContent = `${sessionStats.turns}`;
  }
  if (accountSessionCreditsEl) {
    accountSessionCreditsEl.textContent = `~${formatCreditNumber(sessionStats.creditsUsedEstimate)}`;
  }
  if (accountSessionTokensEl) {
    accountSessionTokensEl.textContent = `${formatNumber(sessionStats.tokensIn)} / ${formatNumber(sessionStats.tokensOut)}`;
  }
}

function updateAccountActions(planTierValue) {
  if (!accountPage) {
    return;
  }
  const resolvedPlan = (planTierValue || '').toString().toLowerCase();
  const isPaid = ['pro', 'power'].includes(resolvedPlan);
  if (accountPrimaryActionButton) {
    accountPrimaryActionButton.textContent = isPaid ? 'Manage subscription' : 'Upgrade plan';
    accountPrimaryActionButton.onclick = () => {
      if (isPaid) {
        openBillingPortal();
      } else {
        openStripeCheckout('subscription');
      }
    };
  }
  if (accountBuyCreditsButton) {
    accountBuyCreditsButton.onclick = () => openStripeCheckout('credits');
  }
}

function updateSessionAnalyticsPanel() {
  if (sessionTurnsEl) {
    sessionTurnsEl.textContent = `${sessionStats.turns}`;
  }
  if (sessionCreditsEl) {
    sessionCreditsEl.textContent = `~${formatCreditNumber(sessionStats.creditsUsedEstimate)}`;
  }
  if (sessionDurationEl) {
    sessionDurationEl.textContent = formatSessionDuration(sessionStartedAt);
  }
  if (sessionPreviousEl) {
    if (lastSessionSummary) {
      sessionPreviousEl.textContent =
        `Previous session used ~${formatCreditNumber(lastSessionSummary.credits_used_estimate)} credits.`;
      sessionPreviousEl.classList.remove('hidden');
    } else {
      sessionPreviousEl.classList.add('hidden');
    }
  }
  updateAccountSessionSnapshot();
}

function updateSessionStatsFromUsage({ usage, inputTokensEstimate, outputTokensEstimate }) {
  const creditsCharged = Number(
    usage?.creditsCharged
    ?? usage?.credits_charged
    ?? usage?.actualCredits
    ?? usage?.actual_credits
  );
  const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
  const outputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
  const resolvedInputTokens = Number.isFinite(inputTokens) ? inputTokens : inputTokensEstimate;
  const resolvedOutputTokens = Number.isFinite(outputTokens) ? outputTokens : outputTokensEstimate;
  const resolvedCredits = Number.isFinite(creditsCharged)
    ? creditsCharged
    : tokensToCredits((resolvedInputTokens || 0) + (resolvedOutputTokens || 0));

  sessionStats.turns += 1;
  sessionStats.tokensIn += resolvedInputTokens || 0;
  sessionStats.tokensOut += resolvedOutputTokens || 0;
  sessionStats.creditsUsedEstimate += resolvedCredits || 0;
  updateSessionAnalyticsPanel();
}

async function postSessionClose(summary) {
  if (!summary?.session_id || !API_BASE) {
    return;
  }
  try {
    await fetch(`${API_BASE}/api/session/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        session_id: summary.session_id,
        ended_at: summary.ended_at,
        client_estimate: {
          credits_used: summary.credits_used_estimate,
          turns: summary.turns
        }
      })
    });
  } catch (error) {
    console.warn('Session close event failed.', error);
  }
}

function startNewSession() {
  systemPrompt = getSystemPromptForIntent({ type: 'chat' });
  sessionId = startNewSessionId();
  sessionStartedAt = startNewSessionStartedAt();
  sessionState = createInitialSessionState();
  persistSessionStateNow();
  resetSessionStats();
  chatAbortController = null;
  chatAbortSilent = false;
  clearChatState();
  clearEditorState();
  clearPreviewState();
  resetExecutionPreparation();
  updateGenerationIndicator();
  updateSessionAnalyticsPanel();
  activeArtifactId = null;
  chatInput?.focus();
}

function setClearChatModalButtonsDisabled(disabled) {
  ['clearChatSave', 'clearChatDiscard', 'clearChatCancel'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.disabled = disabled;
    }
  });
}

async function handleClearChat(mode) {
  if (clearChatInProgress) {
    return;
  }
  clearChatInProgress = true;
  setClearChatModalButtonsDisabled(true);
  try {
    abortActiveChat({ silent: true });
    const summary = buildSessionSummary(new Date());
    lastSessionSummary = summary;
    if (mode === 'save') {
      await saveChatToJSON(summary);
    }
    await postSessionClose(summary);
    startNewSession();
    ModalManager.close();
  } catch (error) {
    console.error('Failed to save chat export.', error);
    showToast('Unable to save this chat. Please try again.');
    setClearChatModalButtonsDisabled(false);
    clearChatInProgress = false;
    return;
  }
  clearChatInProgress = false;
}

function openClearChatModal() {
  if (!chatMessages?.querySelector('.message')) {
    return;
  }
  if (isGenerating) {
    abortActiveChat({ silent: true });
  }
  const html = `
    <h2>Start a new chat?</h2>
    <p>This will clear the current chat and editor. You can save it first.</p>
    <div class="modal-actions">
      <button id="clearChatSave" type="button">Save &amp; Clear</button>
      <button id="clearChatDiscard" class="danger" type="button">Clear Without Saving</button>
      <button id="clearChatCancel" class="secondary" type="button">Cancel</button>
    </div>
  `;
  ModalManager.open(html, { dismissible: true, onClose: () => {
    clearChatInProgress = false;
  } });

  document.getElementById('clearChatSave')?.addEventListener('click', () => {
    handleClearChat('save');
  });
  document.getElementById('clearChatDiscard')?.addEventListener('click', () => {
    handleClearChat('discard');
  });
  document.getElementById('clearChatCancel')?.addEventListener('click', () => {
    if (clearChatInProgress) {
      return;
    }
    ModalManager.close();
  });
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
  updateSessionAnalyticsPanel();
  refreshAnalyticsAndThrottle({ force: false }).catch((error) => {
    console.warn('Usage analytics refresh failed.', error);
  });
}

function renderApp() {
  document.body.classList.remove('unauthenticated');
  ModalManager.close();
  root?.classList.remove('hidden');
  initializeAppForAuthenticatedUser();
  updateRouteView();
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

function isAccountRoute() {
  return window.location.pathname === '/account';
}

function isGalleryRoute() {
  return window.location.pathname === '/gallery';
}

function isPublicGalleryRoute() {
  return window.location.pathname === '/gallery/public';
}

function isProfileEditRoute() {
  return window.location.pathname === '/account/profile';
}

function isPublicProfileRoute() {
  return /^\/u\/[^/]+$/.test(window.location.pathname);
}

function updateRouteView() {
  const showAccount = isAccountRoute();
  const showGallery = isGalleryRoute();
  const showPublicGallery = isPublicGalleryRoute();
  const showProfileEdit = isProfileEditRoute();
  const showPublicProfile = isPublicProfileRoute();
  if (accountPage) {
    accountPage.classList.toggle('hidden', !showAccount);
  }
  if (workspace) {
    workspace.classList.toggle(
      'hidden',
      showAccount || showGallery || showPublicGallery || showProfileEdit || showPublicProfile
    );
  }
  if (galleryPage) {
    galleryPage.classList.toggle('hidden', !showGallery);
  }
  if (publicGalleryPage) {
    publicGalleryPage.classList.toggle('hidden', !showPublicGallery);
  }
  if (profileEditPage) {
    profileEditPage.classList.toggle('hidden', !showProfileEdit);
  }
  if (publicProfilePage) {
    publicProfilePage.classList.toggle('hidden', !showPublicProfile);
  }
  if (showAccount) {
    updateAccountOverview();
    updateAccountPlan();
    updateAccountSessionSnapshot();
    loadAccountArtifactSummary().catch((error) => {
      console.warn('Failed to load account artifact summary.', error);
    });
    loadAccountUsageHistory().catch((error) => {
      console.warn('Failed to load account usage history.', error);
    });
  }
  if (showGallery) {
    loadPrivateGallery().catch((error) => {
      console.warn('Failed to load private gallery.', error);
    });
  }
  if (showPublicGallery) {
    loadPublicGallery().catch((error) => {
      console.warn('Failed to load public gallery.', error);
    });
  }
  if (showProfileEdit) {
    loadProfileEditor().catch((error) => {
      console.warn('Failed to load profile editor.', error);
    });
  }
  if (showPublicProfile) {
    const handle = window.location.pathname.replace('/u/', '');
    loadPublicProfile(handle).catch((error) => {
      console.warn('Failed to load public profile.', error);
    });
  }
}

function setRoute(path) {
  if (window.location.pathname === path) {
    updateRouteView();
    return;
  }
  window.history.pushState({}, '', path);
  updateRouteView();
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
  updateRouteView();
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
  unlockEditor();
  stopLoading();
  document.body.style.overflow = '';
}

function generateSessionId() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateSessionId() {
  if (typeof window === 'undefined') {
    return '';
  }
  const stored = window.sessionStorage?.getItem('mayaSessionId');
  if (stored) {
    return stored;
  }
  const created = generateSessionId();
  window.sessionStorage?.setItem('mayaSessionId', created);
  return created;
}

function getOrCreateSessionStartedAt() {
  if (typeof window === 'undefined') {
    return '';
  }
  const stored = window.sessionStorage?.getItem('mayaSessionStartedAt');
  if (stored) {
    return stored;
  }
  const created = new Date().toISOString();
  window.sessionStorage?.setItem('mayaSessionStartedAt', created);
  return created;
}

function startNewSessionId() {
  if (typeof window === 'undefined') {
    return '';
  }
  const created = generateSessionId();
  window.sessionStorage?.setItem('mayaSessionId', created);
  return created;
}

function startNewSessionStartedAt() {
  if (typeof window === 'undefined') {
    return '';
  }
  const startedAt = new Date().toISOString();
  window.sessionStorage?.setItem('mayaSessionStartedAt', startedAt);
  return startedAt;
}

let sessionId = getOrCreateSessionId();
let sessionStartedAt = getOrCreateSessionStartedAt();
const sessionStats = {
  turns: 0,
  creditsUsedEstimate: 0,
  tokensIn: 0,
  tokensOut: 0
};
let lastSessionSummary = null;
let systemPrompt = getSystemPromptForIntent({ type: 'chat' });

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

function updateSaveCodeButtonState() {
  if (!saveCodeButton || !codeEditor) {
    return;
  }
  const hasContent = Boolean(codeEditor.value.trim());
  saveCodeButton.disabled = !hasContent || saveArtifactInProgress;
}

function lockEditor() {
  if (!codeEditor) {
    return;
  }
  codeEditor.disabled = true;
  codeEditor.classList.add('is-locked');
}

function unlockEditor() {
  if (!codeEditor) {
    return;
  }
  codeEditor.disabled = false;
  codeEditor.classList.remove('is-locked');
}

async function loadHtml2Canvas() {
  if (window.__HTML2CANVAS__) {
    return window.__HTML2CANVAS__;
  }
  const module = await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm');
  window.__HTML2CANVAS__ = module.default || module;
  return window.__HTML2CANVAS__;
}

async function captureArtifactScreenshot() {
  const target = document.querySelector('[data-artifact-screenshot="true"]');
  if (!target) {
    return '';
  }
  const shouldResume = sandboxMode === 'animation' && sandboxAnimationState === 'running';
  if (shouldResume) {
    pauseSandbox();
  }
  try {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const html2canvas = await loadHtml2Canvas();
    const canvas = await html2canvas(target, {
      backgroundColor: '#0b0d12',
      scale: 2,
      useCORS: true,
      logging: false
    });
    const maxWidth = 1600;
    if (canvas.width <= maxWidth) {
      return canvas.toDataURL('image/png');
    }
    const ratio = maxWidth / canvas.width;
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = maxWidth;
    scaledCanvas.height = Math.round(canvas.height * ratio);
    const ctx = scaledCanvas.getContext('2d');
    ctx?.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
    return scaledCanvas.toDataURL('image/png');
  } finally {
    if (shouldResume) {
      resumeSandbox();
    }
  }
}

function formatArtifactDate(dateValue) {
  if (!dateValue) {
    return '—';
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function getArtifactOwnerHandle(artifact) {
  if (!artifact) {
    return 'unknown';
  }
  return (
    artifact.owner_handle
    || artifact.owner?.handle
    || artifact.owner_user_id
    || 'unknown'
  );
}

function getArtifactOwnerDisplay(artifact) {
  const handle = getArtifactOwnerHandle(artifact);
  return handle.startsWith('@') ? handle : `@${handle}`;
}

function getArtifactStats(artifact) {
  const stats = artifact?.stats || {};
  return {
    likes: Number.isFinite(stats.likes) ? stats.likes : 0,
    comments: Number.isFinite(stats.comments) ? stats.comments : 0,
    forks: Number.isFinite(stats.forks) ? stats.forks : 0
  };
}

function normalizeHandle(value) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function isValidHandle(handle) {
  return /^[a-z0-9_]{3,}$/.test(handle);
}

const RESERVED_HANDLES = new Set(['admin', 'system', 'maya', 'support', 'staff']);

function isReservedHandle(handle) {
  return RESERVED_HANDLES.has(handle);
}

function formatLocation(city, country) {
  if (city && country) {
    return `${city}, ${country}`;
  }
  return city || country || '';
}

function formatDisplayAge(age) {
  if (!Number.isFinite(age) || age < 18) {
    return null;
  }
  return `Age ${age}`;
}

function formatDemographics(profile) {
  if (!profile) {
    return 'Not shared';
  }
  const ageValue = formatDisplayAge(profile?.demographics?.age);
  const genderValue = profile?.demographics?.gender?.trim() || null;
  const locationValue = formatLocation(
    profile?.demographics?.city?.trim() || '',
    profile?.demographics?.country?.trim() || ''
  );
  const parts = [ageValue, genderValue, locationValue].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Not shared';
}

function getInitials(name, handle) {
  const source = (name || handle || '').trim();
  if (!source) {
    return '??';
  }
  const words = source.replace('@', '').split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

function buildAvatarPlaceholder(initials) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
      <rect width="100%" height="100%" fill="#202534" />
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-size="42" fill="#fff" font-family="Inter, Arial, sans-serif">
        ${initials}
      </text>
    </svg>
  `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function fetchArtifacts(path) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error('Failed to load artifacts');
  }
  const data = await res.json();
  return data.artifacts || [];
}

function renderGalleryCards(artifacts, { mode }) {
  if (!Array.isArray(artifacts)) {
    return '';
  }
  const publicArtifactMap = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  return artifacts.map((artifact) => {
    const derived = artifact.derived_from?.artifact_id;
    const source = derived ? publicArtifactMap.get(derived) : null;
    const sourceTitle = source?.title || artifact.derived_from?.title || 'Artifact';
    const sourceHandle = source?.owner_handle
      || artifact.derived_from?.owner_handle
      || artifact.derived_from?.owner_user_id
      || 'unknown';
    const derivedVersionLabel = artifact.derived_from?.version_label;
    const forkLabel = derived
      ? `Forked from ${derivedVersionLabel ? `${derivedVersionLabel} of ` : ''}<a href="/gallery/public#artifact-${derived}" data-route>@${sourceHandle} / ${sourceTitle}</a>`
      : '';
    const stats = getArtifactStats(artifact);
    const visibilityBadge = artifact.visibility === 'public' ? 'Public' : 'Private';
    const showEngagement = mode === 'public' || mode === 'profile';
    const isLiked = Boolean(artifact.viewer_has_liked || artifact.has_liked);
    const ownerHandle = getArtifactOwnerHandle(artifact);
    const canBrowseVersions = mode === 'private'
      || (artifact.visibility === 'public' && artifact.versioning?.enabled);
    return `
      <article class="artifact-card" id="artifact-${artifact.artifact_id}" data-artifact-id="${artifact.artifact_id}">
        <div class="artifact-thumb">
          ${artifact.screenshot_url ? `<img src="${artifact.screenshot_url}" alt="${artifact.title || 'Artifact'} screenshot" />` : '<div class="artifact-placeholder">No screenshot</div>'}
          ${mode === 'private' ? `<span class="artifact-visibility">${visibilityBadge}</span>` : ''}
        </div>
        <div class="artifact-body">
          <h3>${artifact.title || 'Untitled artifact'}</h3>
          ${mode !== 'private' ? `<div class="artifact-author"><a href="/u/${ownerHandle}" data-route>${getArtifactOwnerDisplay(artifact)}</a></div>` : ''}
          <p>${artifact.description || 'No description provided.'}</p>
          ${forkLabel ? `<div class="artifact-fork-label">${forkLabel}</div>` : ''}
          <div class="artifact-meta">
            <span>${artifact.code?.language || 'code'}</span>
            <span>${formatArtifactDate(artifact.created_at)}</span>
            ${mode !== 'private' ? `<span>${formatNumber(stats.forks)} forks</span>` : ''}
          </div>
          ${showEngagement ? `
            <div class="artifact-engagement">
              <button type="button" data-action="like" class="${isLiked ? 'is-liked' : ''}">
                ♥ ${formatNumber(stats.likes)}
              </button>
              <button type="button" data-action="comments">
                💬 ${formatNumber(stats.comments)}
              </button>
            </div>
          ` : ''}
          <div class="artifact-actions">
            <button class="ghost-button small" data-action="open">Open</button>
            ${canBrowseVersions ? '<button class="ghost-button small" data-action="versions">Versions</button>' : ''}
            ${mode === 'private' ? `
              <button class="ghost-button small" data-action="edit">Edit metadata</button>
              <button class="ghost-button small" data-action="toggle-visibility">
                ${artifact.visibility === 'public' ? 'Make private' : 'Make public'}
              </button>
              <button class="ghost-button small" data-action="duplicate">Duplicate</button>
              <button class="ghost-button small danger" data-action="delete">Delete</button>
            ` : `
              <button class="ghost-button small" data-action="import">Fork / Import</button>
            `}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function applyArtifactToEditor(artifact) {
  if (!artifact?.code?.content || !codeEditor) {
    return;
  }
  codeEditor.value = artifact.code.content;
  currentCode = artifact.code.content;
  baselineCode = artifact.code.content;
  lastLLMCode = artifact.code.content;
  userHasEditedCode = false;
  resetCodeHistory();
  addCodeVersion({
    content: artifact.code.content,
    source: 'system'
  });
  lastCodeSource = 'artifact';
  activeArtifactId = artifact.artifact_id || null;
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  updateLineNumbers();
  updateSaveCodeButtonState();
  setPreviewStatus('Artifact loaded — click Run Code to apply');
}

async function loadPrivateGallery() {
  const artifacts = await fetchArtifacts('/api/artifacts/private');
  galleryState.privateArtifacts = artifacts;
  if (galleryGrid) {
    galleryGrid.innerHTML = renderGalleryCards(artifacts, { mode: 'private' });
  }
  const hasItems = artifacts.length > 0;
  galleryEmpty?.classList.toggle('hidden', hasItems);
}

function getPublicGalleryPath(sort) {
  const params = new URLSearchParams();
  if (sort) {
    params.set('sort', sort);
  }
  const query = params.toString();
  return `/api/artifacts/public${query ? `?${query}` : ''}`;
}

async function loadPublicGallery() {
  if (publicGallerySortButtons.length) {
    publicGallerySortButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.sort === galleryState.publicSort);
    });
  }
  const artifacts = await fetchArtifacts(getPublicGalleryPath(galleryState.publicSort));
  galleryState.publicArtifacts = artifacts;
  if (publicGalleryGrid) {
    publicGalleryGrid.innerHTML = renderGalleryCards(artifacts, { mode: 'public' });
  }
  const hasItems = artifacts.length > 0;
  publicGalleryEmpty?.classList.toggle('hidden', hasItems);
}

async function loadAccountArtifactSummary() {
  const artifacts = await fetchArtifacts('/api/artifacts/private');
  const privateCount = artifacts.filter((artifact) => artifact.visibility === 'private').length;
  const publicCount = artifacts.filter((artifact) => artifact.visibility === 'public').length;
  if (accountArtifactsPrivateEl) {
    accountArtifactsPrivateEl.textContent = String(privateCount);
  }
  if (accountArtifactsPublicEl) {
    accountArtifactsPublicEl.textContent = String(publicCount);
  }
}

async function fetchPublicProfile(handle) {
  const res = await fetch(`${API_BASE}/api/profile/${handle}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error('Profile fetch failed');
  }
  const data = await res.json();
  return data?.profile || data;
}

async function fetchCurrentProfile() {
  const res = await fetch(`${API_BASE}/api/profile`, { credentials: 'include' });
  if (res.ok) {
    const data = await res.json();
    return data?.profile || data;
  }
  if (res.status === 404) {
    return null;
  }
  throw new Error('Profile fetch failed');
}

async function fetchPublicArtifactsByHandle(handle) {
  const params = new URLSearchParams();
  if (galleryState.publicSort) {
    params.set('sort', galleryState.publicSort);
  }
  if (handle) {
    params.set('handle', handle);
  }
  const path = `/api/artifacts/public${params.toString() ? `?${params}` : ''}`;
  try {
    const artifacts = await fetchArtifacts(path);
    if (artifacts.length) {
      return artifacts;
    }
  } catch (error) {
    console.warn('Failed to load filtered public artifacts.', error);
  }
  const all = await fetchArtifacts(getPublicGalleryPath(galleryState.publicSort));
  return all.filter((artifact) => getArtifactOwnerHandle(artifact) === handle);
}

function setProfileTab(tab) {
  profileState.activeTab = tab;
  profileTabs.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.profileTab === tab);
  });
  profileTabArtifacts?.classList.toggle('hidden', tab !== 'artifacts');
  profileTabForks?.classList.toggle('hidden', tab !== 'forks');
  profileTabAbout?.classList.toggle('hidden', tab !== 'about');
}

function renderProfileArtifacts(artifacts) {
  if (!profileArtifactsGrid || !profileArtifactsEmpty) {
    return;
  }
  profileArtifactsGrid.innerHTML = renderGalleryCards(artifacts, { mode: 'profile' });
  profileArtifactsEmpty.classList.toggle('hidden', artifacts.length > 0);
}

function renderProfileForks(artifacts) {
  if (!profileForksGrid || !profileForksEmpty) {
    return;
  }
  profileForksGrid.innerHTML = renderGalleryCards(artifacts, { mode: 'profile' });
  profileForksEmpty.classList.toggle('hidden', artifacts.length > 0);
}

function updateProfileOverview(profile) {
  if (!profile) {
    return;
  }
  const handle = profile.handle || 'unknown';
  const displayName = profile.display_name || handle;
  const bio = profile.bio || 'No bio yet.';
  const location = formatLocation(
    profile?.demographics?.city?.trim() || '',
    profile?.demographics?.country?.trim() || ''
  );
  if (profileDisplayName) {
    profileDisplayName.textContent = displayName;
  }
  if (profileHandle) {
    profileHandle.textContent = handle.startsWith('@') ? handle : `@${handle}`;
  }
  if (profileBio) {
    profileBio.textContent = bio;
  }
  if (profileLocation) {
    profileLocation.textContent = location;
    profileLocation.classList.toggle('hidden', !location);
  }
  if (profileAvatar) {
    const initials = getInitials(displayName, handle);
    profileAvatar.src = profile.avatar_url || buildAvatarPlaceholder(initials);
  }
  if (profileStatArtifacts) {
    profileStatArtifacts.textContent = formatNumber(profile?.stats?.public_artifacts || 0);
  }
  if (profileStatLikes) {
    profileStatLikes.textContent = formatNumber(profile?.stats?.total_likes || 0);
  }
  if (profileStatComments) {
    profileStatComments.textContent = formatNumber(profile?.stats?.total_comments || 0);
  }
  if (profileStatForks) {
    profileStatForks.textContent = formatNumber(profile?.stats?.forks_received || 0);
  }
  if (profileAboutBio) {
    profileAboutBio.textContent = bio;
  }
  if (profileAboutDemographics) {
    profileAboutDemographics.textContent = formatDemographics(profile);
  }
  if (profileAboutCreated) {
    profileAboutCreated.textContent = formatArtifactDate(profile.created_at);
  }
}

async function loadPublicProfile(handle) {
  if (!handle) {
    return;
  }
  profileState.handle = handle;
  const profile = await fetchPublicProfile(handle);
  profileState.profile = profile;
  updateProfileOverview(profile);
  const artifacts = await fetchPublicArtifactsByHandle(handle);
  profileState.artifacts = artifacts;
  profileState.forks = artifacts.filter((artifact) => artifact.derived_from?.artifact_id);
  renderProfileArtifacts(profileState.artifacts);
  renderProfileForks(profileState.forks);
  profileState.activeTab = 'artifacts';
  setProfileTab(profileState.activeTab);
}

function updateProfileHandleStatus({ message, isError }) {
  if (!profileHandleStatus) {
    return;
  }
  profileHandleStatus.textContent = message;
  profileHandleStatus.classList.toggle('is-error', Boolean(isError));
}

async function checkHandleAvailability(handle, currentHandle) {
  if (!handle || handle === currentHandle) {
    return { available: true, message: handle ? 'Handle is unchanged.' : '' };
  }
  try {
    const res = await fetch(`${API_BASE}/api/profile/${handle}`, { credentials: 'include' });
    if (res.status === 404) {
      return { available: true, message: 'Handle is available.' };
    }
    if (res.ok) {
      return { available: false, message: 'Handle is already taken.' };
    }
  } catch (error) {
    console.warn('Handle availability check failed.', error);
  }
  return { available: true, message: 'Handle availability could not be confirmed.' };
}

async function loadProfileEditor() {
  if (!profileEditForm) {
    return;
  }
  const profile = await fetchCurrentProfile();
  profileState.profile = profile;
  const handle = profile?.handle || '';
  const displayName = profile?.display_name || '';
  const bio = profile?.bio || '';
  if (profileHandleInput) {
    profileHandleInput.value = handle;
  }
  if (profileDisplayNameInput) {
    profileDisplayNameInput.value = displayName;
  }
  if (profileBioInput) {
    profileBioInput.value = bio;
  }
  if (profileBioCount) {
    profileBioCount.textContent = `${bio.length} / 280`;
  }
  if (profileAgeInput) {
    profileAgeInput.value = profile?.demographics?.age ?? '';
  }
  if (profileGenderInput) {
    profileGenderInput.value = profile?.demographics?.gender ?? '';
  }
  if (profileCityInput) {
    profileCityInput.value = profile?.demographics?.city ?? '';
  }
  if (profileCountryInput) {
    profileCountryInput.value = profile?.demographics?.country ?? '';
  }
  if (profileEditAvatarPreview) {
    const initials = getInitials(displayName, handle);
    profileEditAvatarPreview.src = profile?.avatar_url || buildAvatarPlaceholder(initials);
  }
  updateProfileHandleStatus({ message: 'Handles are lowercase and use letters, numbers, or _.', isError: false });
}

async function openOwnProfile() {
  try {
    const profile = profileState.profile || await fetchCurrentProfile();
    const handle = profile?.handle;
    if (!handle) {
      showToast('Set a public handle first.', { variant: 'warning', duration: 2500 });
      return;
    }
    setRoute(`/u/${handle}`);
  } catch (error) {
    console.error('Failed to open public profile.', error);
    showToast('Unable to open public profile.');
  }
}

async function inferArtifactMetadata({ chat, code }) {
  try {
    const res = await fetch(`${API_BASE}/api/artifacts/metadata`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat,
        code
      })
    });
    if (!res.ok) {
      throw new Error('Metadata inference failed');
    }
    const data = await res.json();
    return {
      title: data?.title || 'Untitled artifact',
      description: data?.description || 'Description unavailable.'
    };
  } catch (error) {
    console.warn('Metadata inference failed.', error);
    return {
      title: 'Untitled artifact',
      description: 'Description unavailable.'
    };
  }
}

async function createArtifact(payload) {
  const res = await fetch(`${API_BASE}/api/artifacts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Artifact save failed');
  }
  const data = await res.json();
  return data?.artifact;
}

async function createArtifactVersion(artifactId, payload) {
  const res = await fetch(`${API_BASE}/api/artifacts/${artifactId}/versions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Artifact version save failed');
  }
  const data = await res.json();
  return data?.artifact;
}

async function fetchArtifactVersions(artifactId) {
  const res = await fetch(`${API_BASE}/api/artifacts/${artifactId}/versions`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error('Failed to load versions');
  }
  const data = await res.json();
  return data?.versions || [];
}

async function fetchArtifactVersion(artifactId, versionId) {
  const res = await fetch(`${API_BASE}/api/artifacts/${artifactId}/versions/${versionId}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error('Failed to load version');
  }
  const data = await res.json();
  return data?.version;
}

function renderMarkdownLite(text = '') {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br />');
}

function renderArtifactChatHistory(messages = []) {
  const filtered = messages.filter((entry) => entry?.role === 'user' || entry?.role === 'assistant');
  if (!filtered.length) {
    return '<div class="artifact-chat-empty">No chat history available.</div>';
  }
  return filtered.map((entry) => `
    <div class="artifact-chat-message ${entry.role}">
      <span class="artifact-chat-role">${entry.role}</span>
      <div class="artifact-chat-content">${renderMarkdownLite(entry.content || '')}</div>
    </div>
  `).join('');
}

function openArtifactVersionsModal(artifactId) {
  const currentArtifact = findArtifactInState(artifactId);
  if (!currentArtifact) {
    showToast('Artifact not found.');
    return;
  }
  fetchArtifactVersions(artifactId).then((versions) => {
    const versionRows = versions.map((version) => {
      const label = version.label || `v${version.version_number || 1}`;
      const chatHtml = version.chat?.included
        ? `
          <details class="artifact-chat-history">
            <summary>Chat history</summary>
            <div class="artifact-chat-body">${renderArtifactChatHistory(version.chat.messages || [])}</div>
          </details>
        `
        : '';
      return `
        <div class="artifact-version-row" data-version-id="${version.version_id}">
          <div class="artifact-version-meta">
            <div class="artifact-version-title">${label}</div>
            <div class="artifact-version-date">${formatArtifactDate(version.created_at)}</div>
          </div>
          <div class="artifact-version-actions">
            <button class="ghost-button small" data-version-action="open">Open version</button>
          </div>
          ${chatHtml}
        </div>
      `;
    }).join('');

    const html = `
      <h2>Artifact versions</h2>
      <p>Browse saved sessions for this artifact.</p>
      <div class="artifact-version-list">
        ${versionRows || '<div class="artifact-version-empty">No versions saved yet.</div>'}
      </div>
      <div class="modal-actions">
        <button id="artifactVersionsClose" class="secondary" type="button">Close</button>
      </div>
    `;
    ModalManager.open(html, { dismissible: true });

    document.getElementById('artifactVersionsClose')?.addEventListener('click', () => {
      ModalManager.close();
    });

    document.querySelectorAll('.artifact-version-row [data-version-action="open"]').forEach((button) => {
      button.addEventListener('click', () => {
        const row = button.closest('.artifact-version-row');
        const versionId = row?.dataset.versionId;
        if (!versionId) {
          return;
        }
        fetchArtifactVersion(artifactId, versionId).then((version) => {
          if (!version) {
            return;
          }
          applyArtifactToEditor({
            ...currentArtifact,
            code: version.code
          });
          ModalManager.close();
        }).catch((error) => {
          console.error('Failed to load version.', error);
          showToast('Unable to load version.');
        });
      });
    });
  }).catch((error) => {
    console.error('Failed to load artifact versions.', error);
    showToast('Unable to load versions.');
  });
}

function openArtifactModal({ title, description, screenshotDataUrl, onConfirm, onCancel }) {
  const html = `
    <h2>Save code artifact</h2>
    <p>Review the inferred details before saving this artifact.</p>
    ${screenshotDataUrl ? `<img class="artifact-modal-preview" src="${screenshotDataUrl}" alt="Artifact preview" />` : ''}
    <label class="modal-field">
      <span>Title</span>
      <input id="artifactTitleInput" type="text" value="${title.replace(/"/g, '&quot;')}" />
    </label>
    <label class="modal-field">
      <span>Description</span>
      <textarea id="artifactDescriptionInput" rows="3">${description}</textarea>
    </label>
    <label class="modal-field">
      <span>Visibility</span>
      <select id="artifactVisibilityInput">
        <option value="private" selected>Private</option>
        <option value="public">Public</option>
      </select>
    </label>
    <div class="modal-actions">
      <button id="artifactConfirmButton" type="button">Save artifact</button>
      <button id="artifactCancelButton" class="secondary" type="button">Cancel</button>
    </div>
  `;
  ModalManager.open(html, { dismissible: true, onClose: onCancel });

  document.getElementById('artifactConfirmButton')?.addEventListener('click', () => {
    const titleInput = document.getElementById('artifactTitleInput');
    const descriptionInput = document.getElementById('artifactDescriptionInput');
    const visibilityInput = document.getElementById('artifactVisibilityInput');
    onConfirm({
      title: titleInput?.value.trim() || 'Untitled artifact',
      description: descriptionInput?.value.trim() || '',
      visibility: visibilityInput?.value === 'public' ? 'public' : 'private'
    });
  });

  document.getElementById('artifactCancelButton')?.addEventListener('click', () => {
    ModalManager.close();
    onCancel();
  });
}

async function handleSaveCodeArtifact() {
  if (!codeEditor || saveArtifactInProgress) {
    return;
  }
  const content = codeEditor.value.trim();
  if (!content) {
    return;
  }
  saveArtifactInProgress = true;
  updateSaveCodeButtonState();
  abortActiveChat({ silent: true });
  stopLoading();
  lockChat();
  lockEditor();

  let screenshotDataUrl = '';
  try {
    screenshotDataUrl = await captureArtifactScreenshot();
  } catch (error) {
    console.warn('Screenshot capture failed.', error);
  }

  const chat = getChatExportMessages().map((entry) => ({
    role: entry.role,
    content: entry.content
  }));
  let metadata = { title: 'Untitled artifact', description: '' };
  try {
    startLoading('Inferring details…');
    metadata = await inferArtifactMetadata({
      chat,
      code: {
        language: 'html',
        content
      }
    });
  } finally {
    stopLoading();
  }

  openArtifactModal({
    title: metadata.title,
    description: metadata.description,
    screenshotDataUrl,
    onConfirm: async ({ title, description, visibility }) => {
      try {
        if (!title.trim()) {
          showToast('Title is required.');
          return;
        }
        if (!description.trim()) {
          showToast('Description is required.');
          return;
        }
        if (!screenshotDataUrl) {
          showToast('Screenshot capture failed. Please try again.');
          return;
        }
        const payload = {
          title,
          description,
          visibility,
          code: { language: 'html', content },
          screenshot_data_url: screenshotDataUrl,
          chat,
          source_session: {
            session_id: sessionId,
            credits_used_estimate: sessionStats.creditsUsedEstimate || 0
          }
        };
        const currentArtifact = activeArtifactId
          ? await createArtifactVersion(activeArtifactId, payload)
          : await createArtifact(payload);
        activeArtifactId = currentArtifact?.artifact_id || activeArtifactId;
        showToast('Artifact saved.', { variant: 'success', duration: 2500 });
        ModalManager.close();
        if (currentArtifact?.visibility === 'public') {
          await loadPublicGallery();
        }
        await loadPrivateGallery();
        await loadAccountArtifactSummary();
      } catch (error) {
        console.error('Artifact save failed.', error);
        showToast(error?.message || 'Unable to save artifact.');
      } finally {
        saveArtifactInProgress = false;
        updateSaveCodeButtonState();
        unlockChat();
        unlockEditor();
      }
    },
    onCancel: () => {
      saveArtifactInProgress = false;
      updateSaveCodeButtonState();
      unlockChat();
      unlockEditor();
    }
  });
}

function findArtifactInState(id) {
  return (
    galleryState.privateArtifacts.find((artifact) => artifact.artifact_id === id)
    || galleryState.publicArtifacts.find((artifact) => artifact.artifact_id === id)
    || profileState.artifacts.find((artifact) => artifact.artifact_id === id)
    || profileState.forks.find((artifact) => artifact.artifact_id === id)
  );
}

async function handleArtifactOpen(artifactId) {
  const currentArtifact = findArtifactInState(artifactId);
  if (!currentArtifact) {
    return;
  }
  applyArtifactToEditor(currentArtifact);
  setRoute('/');
}

async function handleArtifactEdit(artifactId) {
  const currentArtifact = findArtifactInState(artifactId);
  if (!currentArtifact) {
    return;
  }
  const html = `
    <h2>Edit artifact metadata</h2>
    <label class="modal-field">
      <span>Title</span>
      <input id="artifactEditTitle" type="text" value="${(currentArtifact.title || '').replace(/"/g, '&quot;')}" />
    </label>
    <label class="modal-field">
      <span>Description</span>
      <textarea id="artifactEditDescription" rows="3">${currentArtifact.description || ''}</textarea>
    </label>
    <div class="modal-actions">
      <button id="artifactEditSave" type="button">Save</button>
      <button id="artifactEditCancel" class="secondary" type="button">Cancel</button>
    </div>
  `;
  ModalManager.open(html, { dismissible: true, onClose: () => {} });
  document.getElementById('artifactEditSave')?.addEventListener('click', async () => {
    const titleInput = document.getElementById('artifactEditTitle');
    const descriptionInput = document.getElementById('artifactEditDescription');
    try {
      await fetch(`${API_BASE}/api/artifacts/${artifactId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleInput?.value.trim() || currentArtifact.title,
          description: descriptionInput?.value.trim() || currentArtifact.description
        })
      });
      ModalManager.close();
      await loadPrivateGallery();
      await loadAccountArtifactSummary();
      showToast('Artifact updated.', { variant: 'success', duration: 2000 });
    } catch (error) {
      console.error('Artifact update failed.', error);
      showToast('Unable to update artifact.');
    }
  });
  document.getElementById('artifactEditCancel')?.addEventListener('click', () => {
    ModalManager.close();
  });
}

async function handleArtifactDelete(artifactId) {
  const html = `
    <h2>Delete this artifact?</h2>
    <p>This will permanently remove the artifact.</p>
    <div class="modal-actions">
      <button id="artifactDeleteConfirm" class="danger" type="button">Delete</button>
      <button id="artifactDeleteCancel" class="secondary" type="button">Cancel</button>
    </div>
  `;
  ModalManager.open(html, { dismissible: true, onClose: () => {} });
  document.getElementById('artifactDeleteConfirm')?.addEventListener('click', async () => {
    try {
      await fetch(`${API_BASE}/api/artifacts/${artifactId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      ModalManager.close();
      await loadPrivateGallery();
      await loadAccountArtifactSummary();
      showToast('Artifact deleted.', { variant: 'success', duration: 2000 });
    } catch (error) {
      console.error('Artifact delete failed.', error);
      showToast('Unable to delete artifact.');
    }
  });
  document.getElementById('artifactDeleteCancel')?.addEventListener('click', () => {
    ModalManager.close();
  });
}

async function handleArtifactVisibilityToggle(artifactId) {
  const currentArtifact = findArtifactInState(artifactId);
  if (!currentArtifact) {
    return;
  }
  const makePublic = currentArtifact.visibility !== 'public';
  const versioningEnabled = Boolean(currentArtifact.versioning?.enabled);
  const chatHistoryPublic = Boolean(currentArtifact.versioning?.chat_history_public);
  const html = `
    <h2>${makePublic ? 'Publish' : 'Make private'}?</h2>
    <p>${makePublic ? 'Public artifacts cannot have their metadata edited later.' : 'Only you will be able to view this artifact.'}</p>
    ${makePublic ? `
      <label class="modal-field checkbox">
        <input id="artifactVersioningToggle" type="checkbox" ${versioningEnabled ? 'checked' : ''} />
        <span>Make version history public</span>
      </label>
      <label class="modal-field checkbox">
        <input id="artifactChatHistoryToggle" type="checkbox" ${chatHistoryPublic ? 'checked' : ''} ${versioningEnabled ? '' : 'disabled'} />
        <span>Include chat history in versions</span>
      </label>
      <p class="modal-helper">Version history shows how this code evolved over time. Chat history may include prompts and reasoning.</p>
    ` : ''}
    <div class="modal-actions">
      <button id="artifactVisibilityConfirm" type="button">${makePublic ? 'Publish' : 'Make private'}</button>
      <button id="artifactVisibilityCancel" class="secondary" type="button">Cancel</button>
    </div>
  `;
  ModalManager.open(html, { dismissible: true, onClose: () => {} });
  const versioningToggle = document.getElementById('artifactVersioningToggle');
  const chatToggle = document.getElementById('artifactChatHistoryToggle');
  versioningToggle?.addEventListener('change', () => {
    if (!chatToggle) {
      return;
    }
    chatToggle.disabled = !versioningToggle.checked;
    if (!versioningToggle.checked) {
      chatToggle.checked = false;
    }
  });
  document.getElementById('artifactVisibilityConfirm')?.addEventListener('click', async () => {
    try {
      if (makePublic) {
        await fetch(`${API_BASE}/api/artifacts/${artifactId}/publish_settings`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: Boolean(versioningToggle?.checked),
            chat_history_public: Boolean(chatToggle?.checked)
          })
        });
      }
      await fetch(`${API_BASE}/api/artifacts/${artifactId}/visibility`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: makePublic ? 'public' : 'private' })
      });
      ModalManager.close();
      await loadPrivateGallery();
      await loadAccountArtifactSummary();
      if (makePublic) {
        await loadPublicGallery();
      }
      showToast(`Artifact ${makePublic ? 'published' : 'made private'}.`, {
        variant: 'success',
        duration: 2000
      });
    } catch (error) {
      console.error('Artifact visibility update failed.', error);
      showToast('Unable to update visibility.');
    }
  });
  document.getElementById('artifactVisibilityCancel')?.addEventListener('click', () => {
    ModalManager.close();
  });
}

async function handleArtifactDuplicate(artifactId) {
  try {
    const currentArtifact = findArtifactInState(artifactId);
    const res = await fetch(`${API_BASE}/api/artifacts/${artifactId}/fork`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        credits_used_estimate: sessionStats.creditsUsedEstimate || 0,
        version_id: currentArtifact?.current_version_id || null
      })
    });
    if (!res.ok) {
      throw new Error('Fork failed');
    }
    await loadPrivateGallery();
    await loadAccountArtifactSummary();
    showToast('Artifact duplicated.', { variant: 'success', duration: 2000 });
  } catch (error) {
    console.error('Artifact duplicate failed.', error);
    showToast('Unable to duplicate artifact.');
  }
}

async function handleArtifactImport(artifactId) {
  try {
    const sourceArtifact = findArtifactInState(artifactId);
    const res = await fetch(`${API_BASE}/api/artifacts/${artifactId}/fork`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        credits_used_estimate: sessionStats.creditsUsedEstimate || 0,
        version_id: sourceArtifact?.current_version_id || null
      })
    });
    if (!res.ok) {
      throw new Error('Import failed');
    }
    const data = await res.json();
    const importedArtifact = data?.artifact;
    startNewSession();
    applyArtifactToEditor(importedArtifact);
    setRoute('/');
    showToast('Artifact imported to workspace.', { variant: 'success', duration: 2000 });
  } catch (error) {
    console.error('Artifact import failed.', error);
    showToast('Unable to import artifact.');
  }
}

function updateArtifactState(artifactId, updater) {
  const updateList = (list) => {
    const index = list.findIndex((artifact) => artifact.artifact_id === artifactId);
    if (index === -1) {
      return;
    }
    list[index] = updater(list[index]);
  };
  updateList(galleryState.privateArtifacts);
  updateList(galleryState.publicArtifacts);
  updateList(profileState.artifacts);
  updateList(profileState.forks);
}

function refreshArtifactViews() {
  if (publicGalleryGrid) {
    publicGalleryGrid.innerHTML = renderGalleryCards(galleryState.publicArtifacts, { mode: 'public' });
  }
  if (profileArtifactsGrid) {
    profileArtifactsGrid.innerHTML = renderGalleryCards(profileState.artifacts, { mode: 'profile' });
  }
  if (profileForksGrid) {
    profileForksGrid.innerHTML = renderGalleryCards(profileState.forks, { mode: 'profile' });
  }
}

async function handleArtifactLikeToggle(artifactId) {
  const currentArtifact = findArtifactInState(artifactId);
  if (!currentArtifact) {
    return;
  }
  const isLiked = Boolean(currentArtifact.viewer_has_liked || currentArtifact.has_liked);
  updateArtifactState(artifactId, (item) => {
    const stats = getArtifactStats(item);
    const nextLikes = Math.max(0, stats.likes + (isLiked ? -1 : 1));
    return {
      ...item,
      stats: { ...item.stats, likes: nextLikes },
      viewer_has_liked: !isLiked
    };
  });
  refreshArtifactViews();
  try {
    const res = await fetch(`${API_BASE}/api/artifacts/${artifactId}/like`, {
      method: isLiked ? 'DELETE' : 'POST',
      credentials: 'include'
    });
    if (!res.ok) {
      throw new Error('Like toggle failed');
    }
  } catch (error) {
    console.error('Artifact like toggle failed.', error);
    updateArtifactState(artifactId, (item) => ({
      ...item,
      stats: { ...item.stats, likes: getArtifactStats(item).likes + (isLiked ? 1 : -1) },
      viewer_has_liked: isLiked
    }));
    refreshArtifactViews();
    showToast('Unable to update like.', { variant: 'warning', duration: 2000 });
  }
}

function buildCommentTree(comments) {
  const topLevel = comments.filter((comment) => !comment.parent_comment_id);
  const replies = new Map();
  comments.forEach((comment) => {
    if (comment.parent_comment_id) {
      if (!replies.has(comment.parent_comment_id)) {
        replies.set(comment.parent_comment_id, []);
      }
      replies.get(comment.parent_comment_id).push(comment);
    }
  });
  topLevel.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  replies.forEach((items) => {
    items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  });
  return { topLevel, replies };
}

function renderCommentItem(comment, { isReply = false } = {}) {
  const author = comment.user_handle || comment.user_id || 'user';
  const likes = formatNumber(comment?.stats?.likes || 0);
  const canDelete = comment.can_delete ? `<button type="button" data-action="delete" data-comment-id="${comment.comment_id}">Delete</button>` : '';
  const replyButton = !isReply
    ? `<button type="button" data-action="reply" data-comment-id="${comment.comment_id}">Reply</button>`
    : '';
  return `
    <div class="comment-item ${isReply ? 'is-reply' : ''}" data-comment-id="${comment.comment_id}">
      <div class="comment-meta">
        <span class="comment-author">@${author}</span>
        <span class="comment-date">${formatArtifactDate(comment.created_at)}</span>
      </div>
      <p class="comment-content">${comment.content}</p>
      <div class="comment-actions">
        <span>♥ ${likes}</span>
        ${replyButton}
        ${canDelete}
      </div>
    </div>
  `;
}

function renderCommentsThread(comments) {
  if (!comments.length) {
    return '<p class="comment-empty">No comments yet.</p>';
  }
  const { topLevel, replies } = buildCommentTree(comments);
  return topLevel.map((comment) => {
    const replyItems = replies.get(comment.comment_id) || [];
    return `
      <div class="comment-thread">
        ${renderCommentItem(comment)}
        <div class="comment-replies">
          ${replyItems.map((reply) => renderCommentItem(reply, { isReply: true })).join('')}
        </div>
      </div>
    `;
  }).join('');
}

async function loadArtifactComments(artifactId) {
  const res = await fetch(`${API_BASE}/api/artifacts/${artifactId}/comments`, {
    credentials: 'include'
  });
  if (!res.ok) {
    throw new Error('Comments fetch failed');
  }
  const data = await res.json();
  return data?.comments || [];
}

async function postArtifactComment({ artifactId, content, parentCommentId }) {
  const res = await fetch(`${API_BASE}/api/artifacts/${artifactId}/comments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      parent_comment_id: parentCommentId || null
    })
  });
  if (!res.ok) {
    throw new Error('Comment post failed');
  }
  const data = await res.json();
  return data?.comment;
}

async function deleteArtifactComment(commentId) {
  const res = await fetch(`${API_BASE}/api/comments/${commentId}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!res.ok) {
    throw new Error('Comment delete failed');
  }
}

async function openCommentsModal(artifactId) {
  const currentArtifact = findArtifactInState(artifactId);
  if (!currentArtifact) {
    return;
  }
  commentState.artifactId = artifactId;
  commentState.replyTo = null;
  const comments = await loadArtifactComments(artifactId);
  renderCommentsModal(currentArtifact, comments);
}

function renderCommentsModal(artifact, comments) {
  const replyTarget = commentState.replyTo;
  const replyLabel = replyTarget ? 'Replying to comment' : 'Add a comment';
  const html = `
    <h2>Comments</h2>
    <p>${artifact.title || 'Artifact'}</p>
    <div class="comment-list">
      ${renderCommentsThread(comments)}
    </div>
    <form id="commentForm" class="comment-form">
      <label class="modal-field">
        <span>${replyLabel}</span>
        <textarea id="commentInput" rows="3" placeholder="Write a comment..."></textarea>
      </label>
      <div class="comment-actions-row">
        <button type="submit">Post comment</button>
        ${replyTarget ? '<button type="button" id="commentCancelReply" class="secondary">Cancel reply</button>' : ''}
      </div>
    </form>
  `;
  ModalManager.open(html, { dismissible: true, onClose: () => {
    commentState.replyTo = null;
    commentState.artifactId = null;
  } });

  document.querySelectorAll('[data-action="reply"]').forEach((button) => {
    button.addEventListener('click', () => {
      commentState.replyTo = button.getAttribute('data-comment-id');
      renderCommentsModal(artifact, comments);
    });
  });

  document.querySelectorAll('[data-action="delete"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const commentId = button.getAttribute('data-comment-id');
      if (!commentId) {
        return;
      }
      try {
        await deleteArtifactComment(commentId);
        const nextComments = comments.filter((comment) => comment.comment_id !== commentId);
        comments = nextComments.filter((comment) => comment.parent_comment_id !== commentId);
        updateArtifactState(artifact.artifact_id, (item) => ({
          ...item,
          stats: { ...item.stats, comments: Math.max(0, getArtifactStats(item).comments - 1) }
        }));
        refreshArtifactViews();
        renderCommentsModal(artifact, comments);
      } catch (error) {
        console.error('Comment delete failed.', error);
        showToast('Unable to delete comment.');
      }
    });
  });

  document.getElementById('commentCancelReply')?.addEventListener('click', () => {
    commentState.replyTo = null;
    renderCommentsModal(artifact, comments);
  });

  document.getElementById('commentForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('commentInput');
    const content = input?.value.trim();
    if (!content) {
      return;
    }
    try {
      const comment = await postArtifactComment({
        artifactId: artifact.artifact_id,
        content,
        parentCommentId: commentState.replyTo
      });
      if (comment) {
        comments = [comment, ...comments];
        updateArtifactState(artifact.artifact_id, (item) => ({
          ...item,
          stats: { ...item.stats, comments: getArtifactStats(item).comments + 1 }
        }));
        refreshArtifactViews();
      }
      commentState.replyTo = null;
      renderCommentsModal(artifact, comments);
    } catch (error) {
      console.error('Comment post failed.', error);
      showToast('Unable to post comment.');
    }
  });
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

let runtimeStateSyncId = null;

function isRuntimeRunning() {
  return runtimeState.status === 'running' || runtimeState.status === 'terminating';
}

function setRuntimeState(status) {
  runtimeState.status = status;
  runtimeState.started_at = status === 'running' ? Date.now() : null;
  updateUndoRedoState();
}

function scheduleRuntimeStateSync() {
  if (runtimeStateSyncId) {
    return;
  }
  runtimeStateSyncId = window.setInterval(() => {
    if (runtimeState.status !== 'running') {
      clearInterval(runtimeStateSyncId);
      runtimeStateSyncId = null;
      return;
    }
    if (!sandbox?.state?.running) {
      setRuntimeState('idle');
    }
  }, 300);
}

async function resetRuntime() {
  await hardStopRuntime();
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
    ? `${API_BASE}/checkout/subscription`
    : `${API_BASE}/checkout/credits`;
  window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
}

function openBillingPortal() {
  const portalUrl = `${API_BASE}/billing/portal`;
  window.open(portalUrl, '_blank', 'noopener,noreferrer');
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
  const summary = payload?.overview ?? payload?.summary ?? payload?.analytics ?? payload?.data ?? payload ?? {};
  const dailyLimit = Number(payload?.daily_limit ?? summary.daily_limit ?? summary.dailyLimit);
  const creditsUsedToday = Number(
    payload?.credits_used_today
    ?? summary.credits_used_today
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

  try {
    const res = await withTimeout(
      fetch(`${API_BASE}/api/usage/overview`, {
        cache: 'no-store',
        credentials: 'include'
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

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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

async function fetchUsageOverview({ force = false } = {}) {
  return fetchUsageAnalytics({ force });
}

async function fetchUsageDaily({ days = 14, force = false } = {}) {
  const params = new URLSearchParams();
  if (Number.isFinite(days)) {
    params.set('range', `${days}d`);
  }
  try {
    const res = await withTimeout(
      fetch(`${API_BASE}/api/usage/daily?${params.toString()}`, {
        cache: force ? 'no-store' : 'default',
        credentials: 'include'
      }),
      USAGE_FETCH_TIMEOUT_MS,
      'Usage daily request timed out'
    );
    if (!res.ok) {
      throw new Error('Usage daily unavailable');
    }
    return await res.json();
  } catch (error) {
    console.warn('Usage daily fetch failed.', error);
    return { daily: [] };
  }
}

async function fetchUsageHistory({ days = 14, force = false } = {}) {
  const params = new URLSearchParams();
  if (Number.isFinite(days)) {
    params.set('range', `${days}d`);
  }
  try {
    const res = await withTimeout(
      fetch(`${API_BASE}/api/usage/history?${params.toString()}`, {
        cache: force ? 'no-store' : 'default',
        credentials: 'include'
      }),
      USAGE_FETCH_TIMEOUT_MS,
      'Usage history request timed out'
    );
    if (!res.ok) {
      throw new Error('Usage history unavailable');
    }
    return await res.json();
  } catch (error) {
    console.warn('Usage history fetch failed.', error);
    return { daily: [] };
  }
}

function buildSessionSummaries(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const sessionKey = row.session_id || 'session_unknown';
    if (!map.has(sessionKey)) {
      map.set(sessionKey, {
        session_id: sessionKey,
        started_at: row.timestamp_utc,
        ended_at: row.timestamp_utc,
        turns: 0,
        credits_used: 0,
        tokens_in: 0,
        tokens_out: 0
      });
    }
    const summary = map.get(sessionKey);
    summary.turns += 1;
    summary.credits_used += toNumber(row.credits_charged || row.credits_used);
    summary.tokens_in += toNumber(row.input_tokens);
    summary.tokens_out += toNumber(row.output_tokens);
    if (row.timestamp_utc < summary.started_at) {
      summary.started_at = row.timestamp_utc;
    }
    if (row.timestamp_utc > summary.ended_at) {
      summary.ended_at = row.timestamp_utc;
    }
  });
  return Array.from(map.values()).sort((a, b) => {
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
  });
}

function renderAccountSessionHistory(summaries) {
  if (!accountSessionHistoryBody || !accountSessionHistoryEmpty) {
    return;
  }
  accountSessionHistoryBody.innerHTML = '';
  if (!summaries.length) {
    accountSessionHistoryEmpty.classList.remove('hidden');
    return;
  }
  accountSessionHistoryEmpty.classList.add('hidden');
  summaries.forEach((summary) => {
    const rowEl = document.createElement('tr');
    const sessionDate = formatDateLong(summary.started_at);
    const duration = formatDurationBetween(summary.started_at, summary.ended_at);
    const credits = formatNumber(summary.credits_used);
    rowEl.innerHTML = `
      <td>${sessionDate}</td>
      <td>${duration}</td>
      <td>${formatNumber(summary.turns)}</td>
      <td>${credits}</td>
      <td>
        <div class="account-table-actions">
          <button class="ghost-button small" data-session-action="json" data-session-id="${summary.session_id}">JSON</button>
          <button class="ghost-button small" data-session-action="txt" data-session-id="${summary.session_id}">TXT</button>
          <button class="ghost-button small" data-session-action="md" data-session-id="${summary.session_id}">MD</button>
        </div>
      </td>
    `;
    accountSessionHistoryBody.appendChild(rowEl);
  });
}

function renderAccountMonthlySummary(rows, summaries, overviewTotals = null) {
  if (!accountMonthCreditsEl || !accountMonthSessionsEl || !accountMonthAvgCreditsEl) {
    return;
  }
  const monthTotals = overviewTotals
    || (rows.length
      ? getMonthTotals(rows)
      : {
        totalCredits: summaries.reduce((sum, entry) => sum + toNumber(entry.credits_used), 0),
        totalRequests: 0,
        avgLatency: 0,
        successRate: 0
      });
  const sessionCount = summaries.length;
  const avgCredits = sessionCount
    ? Math.round(monthTotals.totalCredits / sessionCount)
    : 0;
  accountMonthCreditsEl.textContent = formatNumber(monthTotals.totalCredits);
  accountMonthSessionsEl.textContent = formatNumber(sessionCount);
  accountMonthAvgCreditsEl.textContent = formatNumber(avgCredits);
}

async function loadAccountUsageHistory() {
  if (!accountPage || accountState.loading) {
    return;
  }
  accountState.loading = true;
  const rangeDays = ACCOUNT_RANGE_STEPS[accountState.rangeIndex] || ACCOUNT_RANGE_STEPS[0];
  let usageRows = [];
  let monthTotals = null;
  let sessionSummaries = [];
  try {
    const [overview, history] = await Promise.all([
      fetchUsageOverview({ force: true }),
      fetchUsageHistory({ days: rangeDays, force: true })
    ]);
    const daily = Array.isArray(history?.daily) ? history.daily : [];
    usageRows = daily.flatMap((entry) => entry.entries || []);
    sessionSummaries = buildSessionSummaries(usageRows);
    if (overview?.overview) {
      monthTotals = {
        totalCredits: toNumber(overview.overview.total_credits),
        totalRequests: toNumber(overview.overview.total_requests),
        avgLatency: toNumber(overview.overview.avg_latency_ms),
        successRate: Number.isFinite(overview.overview.success_rate)
          ? overview.overview.success_rate
          : 0
      };
    }
  } catch (error) {
    console.warn('Account usage load failed.', error);
    usageRows = [];
    sessionSummaries = [];
  }

  accountState.sessionHistory = sessionSummaries;
  if (accountHistoryRangeLabel) {
    accountHistoryRangeLabel.textContent = `Last ${rangeDays} days`;
  }
  if (accountHistoryLoadMore) {
    const canLoadMore = accountState.rangeIndex < ACCOUNT_RANGE_STEPS.length - 1;
    accountHistoryLoadMore.disabled = !canLoadMore;
    accountHistoryLoadMore.textContent = canLoadMore ? 'Load more' : 'Showing all';
  }
  renderAccountSessionHistory(sessionSummaries);
  renderAccountMonthlySummary(usageRows, sessionSummaries, monthTotals);
  accountState.loading = false;
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
    const rangeDays = USAGE_RANGE_STEPS[usageState.rangeIndex] || USAGE_RANGE_STEPS[0];
    const [overview, dailyData, historyData] = await Promise.all([
      fetchUsageOverview({ force: true }),
      fetchUsageDaily({ days: rangeDays, force: true }),
      fetchUsageHistory({ days: rangeDays, force: true })
    ]);
    const dailyRange = Array.isArray(dailyData?.daily) ? dailyData.daily : [];
    const historyDaily = Array.isArray(historyData?.daily) ? historyData.daily : [];
    const monthTotals = overview?.overview
      ? {
        totalCredits: toNumber(overview.overview.total_credits),
        totalRequests: toNumber(overview.overview.total_requests),
        avgLatency: toNumber(overview.overview.avg_latency_ms),
        successRate: Number.isFinite(overview.overview.success_rate)
          ? overview.overview.success_rate
          : 0
      }
      : { totalCredits: 0, totalRequests: 0, avgLatency: 0, successRate: 0 };

    updateUsageScopeLabel(false, { userId: getUserContext().id });
    updateUsageCards(monthTotals, getCreditState());
    if (usageRangeLabel) {
      usageRangeLabel.textContent = getRangeLabel(rangeDays);
    }

    renderCreditsChart(dailyRange, getCreditState(), false, '');
    renderRequestsChart(dailyRange);
    renderLatencyChart(dailyRange);
    buildUsageHistory(historyDaily, false);

    if (usageLoadMore) {
      const canLoadMore = usageState.rangeIndex < USAGE_RANGE_STEPS.length - 1
        && dailyRange.length >= rangeDays;
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
  const isAdmin = window.location.pathname.startsWith('/admin/usage');
  if (!isAdmin) {
    return;
  }
  usageUserFilter.innerHTML = '';
  const currentUser = getUserContext();
  const option = document.createElement('option');
  option.value = currentUser.id || 'me';
  option.textContent = currentUser.email || 'Current user';
  usageUserFilter.appendChild(option);
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
  analyticsModalState.data = null;
  usageState.rangeIndex = 0;
  destroyChart(usageState.charts.credits);
  destroyChart(usageState.charts.requests);
  destroyChart(usageState.charts.latency);
  usageState.charts.credits = null;
  usageState.charts.requests = null;
  usageState.charts.latency = null;
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

function estimateTokensForContent(content) {
  if (!content) {
    return 0;
  }
  return Math.ceil(content.length / 4);
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

function formatTimestampForFilename(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function getMessageRole(messageEl) {
  if (!messageEl) {
    return 'assistant';
  }
  const role = messageEl.dataset.role;
  if (role) {
    return role;
  }
  if (messageEl.classList.contains('user')) {
    return 'user';
  }
  if (messageEl.classList.contains('system')) {
    return 'system';
  }
  return 'assistant';
}

function getChatExportMessages() {
  if (sessionState?.messages?.length) {
    return sessionState.messages;
  }
  if (!chatMessages) {
    return [];
  }
  const messageEls = Array.from(chatMessages.querySelectorAll('.message'));
  return messageEls
    .filter((messageEl) => {
      if (messageEl.dataset.ephemeral === 'true') {
        return false;
      }
      if (messageEl.dataset.pending === 'true') {
        return false;
      }
      return !messageEl.classList.contains('thinking');
    })
    .map((messageEl) => {
      const content = getMessageCopyText(messageEl);
      const timestamp = messageEl.dataset.timestamp || new Date().toISOString();
      return {
        id: messageEl.dataset.id || generateMessageId(),
        role: getMessageRole(messageEl),
        timestamp,
        content_text: content,
        content_blocks: getMessageRole(messageEl) === 'assistant' ? extractContentBlocks(content) : undefined,
        tokens_estimated: estimateTokensForContent(content)
      };
    });
}

function buildChatExportPayload(summary) {
  const now = new Date();
  const artifactContext = activeArtifactId ? findArtifactInState(activeArtifactId) : null;
  const activeVersionId = sessionState?.current_editor?.version_id
    || sessionState?.code_versions?.at(-1)?.id
    || '';
  return {
    schema_version: SESSION_STATE_SCHEMA_VERSION,
    app: 'maya-dev-ui',
    saved_at: now.toISOString(),
    user_id: getUserContext().id || '',
    session: summary
      ? {
        id: summary.session_id,
        started_at: summary.started_at,
        ended_at: summary.ended_at,
        turns: summary.turns,
        credits_used_estimate: summary.credits_used_estimate,
        tokens: {
          input: summary.tokens_in,
          output: summary.tokens_out
        }
      }
      : null,
    messages: getChatExportMessages(),
    code_versions: sessionState?.code_versions || [],
    editor_state: {
      active_version_id: activeVersionId
    },
    metadata: {
      model: DEFAULT_MODEL,
      plan: currentUser?.plan || currentUser?.planTier || '',
      visibility: artifactContext?.visibility || 'private',
      forked_from: artifactContext?.source_artifact_id || null
    }
  };
}

async function saveChatToJSON(summary) {
  const payload = buildChatExportPayload(summary);
  const filename = `maya-chat-${formatTimestampForFilename(new Date())}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadFile({ content, filename, type }) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildSessionExportPayload(summary) {
  return {
    session: summary,
    exported_at: new Date().toISOString()
  };
}

async function downloadSessionExport(summary, format) {
  if (!summary?.session_id) {
    return;
  }
  let payload = null;
  try {
    const res = await fetch(`${API_BASE}/api/session/export/${encodeURIComponent(summary.session_id)}`, {
      credentials: 'include'
    });
    if (res.ok) {
      payload = await res.json().catch(() => null);
    }
  } catch (error) {
    console.warn('Session export fetch failed.', error);
  }

  const resolvedPayload = payload || buildSessionExportPayload(summary);
  const baseFilename = `maya-session-${summary.session_id}-${formatTimestampForFilename(new Date(summary.started_at || Date.now()))}`;

  if (format === 'json') {
    downloadFile({
      content: JSON.stringify(resolvedPayload, null, 2),
      filename: `${baseFilename}.json`,
      type: 'application/json'
    });
    return;
  }

  const transcriptLines = [
    `Session ${summary.session_id}`,
    `Started: ${summary.started_at || '—'}`,
    `Ended: ${summary.ended_at || '—'}`,
    `Turns: ${summary.turns ?? 0}`,
    `Credits used: ${summary.credits_used ?? 0}`,
    '',
    'Transcript data is not yet available for this session export.'
  ];
  const content = format === 'md'
    ? transcriptLines.map((line) => (line ? `- ${line}` : '')).join('\n')
    : transcriptLines.join('\n');

  downloadFile({
    content,
    filename: `${baseFilename}.${format === 'md' ? 'md' : 'txt'}`,
    type: 'text/plain'
  });
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
const codeVersionStack = [];
let userEditVersionTimer = null;
let userHasEditedCode = false;
let baseExecutionWarnings = [];
let sandboxMode = 'finite';
let sandboxAnimationState = 'idle';
let lastRunCode = null;
let lastRunSource = null;
let lastCodeSource = null;
let activeArtifactId = null;
let chatFinalized = false;
let currentTurnMessageId = null;
let pendingAssistantProposal = null;
let intentAnchor = null;
let chatAbortController = null;
let chatAbortSilent = false;
let clearChatInProgress = false;
let saveArtifactInProgress = false;
const DEBUG_INTENT = false;
const chatState = {
  locked: false,
  unlockTimerId: null
};
const galleryState = {
  privateArtifacts: [],
  publicArtifacts: [],
  publicSort: 'likes'
};
const profileState = {
  handle: null,
  profile: null,
  artifacts: [],
  forks: [],
  activeTab: 'artifacts'
};
const commentState = {
  artifactId: null,
  replyTo: null
};
let handleCheckTimer = null;

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

if (saveCodeButton) {
  saveCodeButton.addEventListener('click', () => {
    handleSaveCodeArtifact();
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

function stampMessage(message, role) {
  if (!message) {
    return;
  }
  message.dataset.role = role;
  if (!message.dataset.timestamp) {
    message.dataset.timestamp = new Date().toISOString();
  }
}

function addMessage(role, html, options = {}) {
  const message = document.createElement('div');
  message.className = `message ${role}${options.className ? ` ${options.className}` : ''}`;
  message.innerHTML = html;
  stampMessage(message, role);

  if (options.pending) {
    message.dataset.pending = 'true';
  }

  const id = generateMessageId();
  message.dataset.id = id;

  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  updateClearChatButtonState();
  return id;
}

function renderSystemMessage(messageId, text) {
  const safeText = escapeHtml(text ?? '');
  if (messageId) {
    updateMessage(messageId, `<em>${safeText}</em>`);
    const messageEl = document.querySelector(`[data-id="${messageId}"]`);
    if (messageEl) {
      messageEl.classList.add('system');
      stampMessage(messageEl, 'system');
      delete messageEl.dataset.pending;
    }
    return messageEl;
  }

  const id = addMessage('system', `<em>${safeText}</em>`);
  return document.querySelector(`[data-id="${id}"]`);
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

function extractContentBlocks(contentText) {
  if (typeof contentText !== 'string' || !contentText.trim()) {
    return [];
  }
  const blocks = [];
  const regex = /```([a-z0-9_-]+)?\n([\s\S]*?)```/gi;
  let lastIndex = 0;
  let match = null;
  while ((match = regex.exec(contentText))) {
    if (match.index > lastIndex) {
      const text = contentText.slice(lastIndex, match.index);
      if (text) {
        blocks.push({ type: 'text', content: text });
      }
    }
    blocks.push({
      type: 'code',
      language: match[1] || undefined,
      content: match[2] || ''
    });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < contentText.length) {
    const text = contentText.slice(lastIndex);
    if (text) {
      blocks.push({ type: 'text', content: text });
    }
  }
  return blocks;
}

function appendMessage(role, content, options = {}) {
  const message = document.createElement('div');
  message.className = `message ${role}${options.className ? ` ${options.className}` : ''}`;
  message.textContent = content;
  stampMessage(message, role);
  const messageId = generateMessageId();
  message.dataset.id = messageId;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  updateClearChatButtonState();
  if (role === 'user') {
    attachCopyButton(message, () => content);
  }
  if (role === 'user' || role === 'assistant') {
    upsertMessageEvent({
      messageId,
      role,
      contentText: content,
      timestamp: message.dataset.timestamp
    });
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
  if (messageEl) {
    const messageId = messageEl.dataset.id || messageId;
    if (messageId) {
      upsertMessageEvent({
        messageId,
        role: 'assistant',
        contentText: safeText,
        timestamp: messageEl.dataset.timestamp
      });
    }
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
    const total = Number(root.dataset.creditsTotal ?? '');
    const clampedRemaining = Number.isFinite(total)
      ? clamp(remainingCredits, 0, total)
      : Math.max(0, remainingCredits);
    root.dataset.remainingCredits = `${clampedRemaining}`;
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
  setRuntimeState('idle');
}

function resumeSandbox() {
  if (sandboxMode !== 'animation') {
    return;
  }
  sandbox.resume();
  setSandboxAnimationState('running');
  setPreviewExecutionStatus('running', 'RUNNING · ANIMATION MODE');
  setPreviewStatus('Running animation…');
  setRuntimeState('running');
  scheduleRuntimeStateSync();
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
  setRuntimeState('idle');
}

async function hardStopRuntime() {
  if (runtimeState.status === 'idle') {
    return;
  }
  setRuntimeState('terminating');
  sandbox.stop('revert');
  resetSandboxFrame();
  setSandboxAnimationState('stopped');
  setSandboxControlsVisible(false);
  setPreviewExecutionStatus('stopped', '🛑 Stopped');
  setPreviewStatus('Execution stopped for revert.');
  setRuntimeState('idle');
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
    setRuntimeState('idle');
    return;
  }

  outputPanel?.classList.add('loading');
  setSandboxControlsVisible(sandboxMode === 'animation');
  setSandboxAnimationState('running');
  setRuntimeState('running');
  scheduleRuntimeStateSync();
  await waitForIframeReady(activeFrame, 900);
  if (sandboxFrame !== activeFrame) {
    console.warn('Iframe swapped during compile; aborting run.');
    setRuntimeState('idle');
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

async function getVersionTimeline(id = sessionId) {
  const db = await openSessionStateDb();
  let versions = [];
  let editorState = null;
  if (db) {
    const tx = db.transaction(SESSION_EDITOR_STORE_NAME, 'readonly');
    const editorStore = tx.objectStore(SESSION_EDITOR_STORE_NAME);
    const [dbVersions, storedEditorState] = await Promise.all([
      getSessionCodeVersionsFromIndexedDb(db, id),
      requestToPromise(editorStore.get(id), null)
    ]);
    versions = dbVersions || [];
    editorState = storedEditorState;
  }
  if (!versions.length) {
    versions = codeVersionStack.slice();
  }
  versions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const activeVersionId = editorState?.active_version_id
    || sessionState?.current_editor?.version_id
    || '';
  const index = activeVersionId
    ? versions.findIndex((entry) => entry.id === activeVersionId)
    : -1;
  return { versions, index };
}

async function updateUndoRedoState(id = sessionId, timeline = null) {
  const { versions, index } = timeline || await getVersionTimeline(id);
  const runtimeRunning = isRuntimeRunning();
  const canRevert = index > 0;
  const canForward = index !== -1 && index < versions.length - 1;
  if (revertButton) {
    revertButton.disabled = !canRevert;
    revertButton.setAttribute('aria-disabled', canRevert ? 'false' : 'true');
    revertButton.classList.toggle('runtime-running', runtimeRunning);
    const baseTitle = 'Go to previous code version';
    revertButton.title = runtimeRunning
      ? `${baseTitle} · Code is running`
      : baseTitle;
  }
  if (forwardButton) {
    forwardButton.disabled = !canForward;
    forwardButton.setAttribute('aria-disabled', canForward ? 'false' : 'true');
    forwardButton.classList.toggle('runtime-running', runtimeRunning);
    const baseTitle = 'Go to next code version';
    forwardButton.title = runtimeRunning
      ? `${baseTitle} · Code is running`
      : baseTitle;
  }
}

async function activateVersion(id, version, timeline = null) {
  if (!version || typeof version.content !== 'string') {
    return;
  }
  const resolvedTimeline = timeline || await getVersionTimeline(id);
  if (sessionState) {
    sessionState.current_editor = {
      language: version.language || 'html',
      content: version.content,
      version_id: version.id
    };
    if (Number.isFinite(resolvedTimeline.index)) {
      sessionState.active_version_index = resolvedTimeline.index;
    }
    if (resolvedTimeline.versions?.length) {
      sessionState.code_versions = resolvedTimeline.versions;
    }
    saveEditorStateToIndexedDb(sessionState);
    scheduleSessionStatePersist();
  }
  if (codeEditor) {
    codeEditor.value = version.content;
  }
  userHasEditedCode = codeEditor.value !== baselineCode;
  lastCodeSource = version.source === 'llm' ? 'llm' : 'user';
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  updateLineNumbers();
  updateSaveCodeButtonState();
  emitCodeStateChanged(version);
  resetExecutionPreparation();
  requestCreditPreviewUpdate();
  await updateUndoRedoState(id, resolvedTimeline);
}

async function revertBackward(id = sessionId) {
  const timeline = await getVersionTimeline(id);
  if (timeline.index <= 0) {
    return;
  }
  const previousVersion = timeline.versions[timeline.index - 1];
  if (!previousVersion) {
    return;
  }
  const nextTimeline = {
    versions: timeline.versions,
    index: timeline.index - 1
  };
  await activateVersion(id, previousVersion, nextTimeline);
  showToast('Reverted to previous version', { variant: 'success', duration: 2500 });
}

async function goForward(id = sessionId) {
  const timeline = await getVersionTimeline(id);
  if (timeline.index === -1 || timeline.index >= timeline.versions.length - 1) {
    return;
  }
  const nextVersion = timeline.versions[timeline.index + 1];
  if (!nextVersion) {
    return;
  }
  const nextTimeline = {
    versions: timeline.versions,
    index: timeline.index + 1
  };
  await activateVersion(id, nextVersion, nextTimeline);
  showToast('Moved to next version', { variant: 'success', duration: 2500 });
}

function setRevertModalButtonsDisabled(disabled) {
  const cancelButton = document.getElementById('revertWhileRunningCancel');
  const confirmButton = document.getElementById('revertWhileRunningConfirm');
  if (cancelButton) {
    cancelButton.disabled = disabled;
  }
  if (confirmButton) {
    confirmButton.disabled = disabled;
  }
}

function showRevertWhileRunningDialog({
  description = 'Reverting will stop the current execution before restoring the previous version.',
  confirmLabel = 'Stop &amp; Revert',
  onConfirm = null
} = {}) {
  if (revertModalOpen) {
    return Promise.resolve();
  }
  revertModalOpen = true;
  return new Promise((resolve) => {
    const html = `
      <h2>Code is currently running</h2>
      <p>${description}</p>
      <div class="modal-actions">
        <button id="revertWhileRunningCancel" class="secondary" type="button">Cancel</button>
        <button id="revertWhileRunningConfirm" type="button">${confirmLabel}</button>
      </div>
    `;
    ModalManager.open(html, { dismissible: true, onClose: () => {
      revertModalOpen = false;
      resolve();
    } });

    document.getElementById('revertWhileRunningCancel')?.addEventListener('click', () => {
      if (!revertModalOpen) {
        return;
      }
      ModalManager.close();
    });
    document.getElementById('revertWhileRunningConfirm')?.addEventListener('click', async () => {
      if (!revertModalOpen) {
        return;
      }
      setRevertModalButtonsDisabled(true);
      await hardStopRuntime();
      if (typeof onConfirm === 'function') {
        await onConfirm();
      }
      ModalManager.close();
    });
  });
}

async function requestRevert() {
  if (!isRuntimeRunning()) {
    await revertBackward();
    return;
  }
  await showRevertWhileRunningDialog({
    onConfirm: () => revertBackward()
  });
}

async function requestForward() {
  if (!isRuntimeRunning()) {
    await goForward();
    return;
  }
  await showRevertWhileRunningDialog({
    description: 'Moving forward will stop the current execution before restoring the next version.',
    confirmLabel: 'Stop &amp; Forward',
    onConfirm: () => goForward()
  });
}

async function safeRevertBackward() {
  if (navigationInProgress) {
    return;
  }
  navigationInProgress = true;
  try {
    await requestRevert();
  } finally {
    navigationInProgress = false;
  }
}

async function safeGoForward() {
  if (navigationInProgress) {
    return;
  }
  navigationInProgress = true;
  try {
    await requestForward();
  } finally {
    navigationInProgress = false;
  }
}

function updatePromoteVisibility() {
  if (!promoteButton) {
    return;
  }
  const isRunning = previewExecutionStatus?.classList.contains('running');
  promoteButton.style.display =
    userHasEditedCode && isRunning ? 'inline-flex' : 'none';
}

function getActiveVersionIndex() {
  if (!codeVersionStack.length) {
    return -1;
  }
  const activeId = sessionState?.current_editor?.version_id;
  if (activeId) {
    const index = codeVersionStack.findIndex((entry) => entry.id === activeId);
    if (index >= 0) {
      return index;
    }
  }
  if (Number.isFinite(sessionState?.active_version_index)) {
    return sessionState.active_version_index;
  }
  return codeVersionStack.length - 1;
}

function getActiveCodeVersion() {
  const index = getActiveVersionIndex();
  if (index < 0) {
    return null;
  }
  return codeVersionStack[index] || null;
}

function emitCodeStateChanged(codeVersion) {
  sandbox.stop('code-change');
  resetSandboxFrame();
  setRuntimeState('idle');
  markPreviewStale();
  if (codeVersion?.id) {
    console.debug('Code version changed:', codeVersion.id);
  }
}

function runActiveCodeVersion(source = 'user', statusMessage = 'Applying your edits…') {
  const activeVersion = getActiveCodeVersion();
  if (!activeVersion) {
    return;
  }
  currentCode = activeVersion.content;
  baselineCode = activeVersion.content;
  userHasEditedCode = false;
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  updateSaveCodeButtonState();
  setPreviewStatus(statusMessage);
  handleLLMOutput(activeVersion.content, source);
  console.debug('Executing code_version:', activeVersion.id);
}

function applyLLMEdit(newCode, { messageId = null } = {}) {
  if (!codeEditor) {
    return;
  }
  ensureCurrentCodeVersion(lastCodeSource === 'llm' ? 'llm' : 'user');
  addCodeVersion({
    content: newCode,
    source: 'llm',
    messageId
  });
  codeEditor.value = newCode;
  updateUndoRedoState();
}

function setCodeFromLLM(code, messageId = null) {
  lastLLMCode = code;
  applyLLMEdit(code, { messageId });
  baselineCode = code;
  userHasEditedCode = false;
  lastCodeSource = 'llm';
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  updateLineNumbers();
  updateSaveCodeButtonState();
  setPreviewStatus('Preview updated by assistant');
}

function handleUserRun(code, source = 'user', statusMessage = 'Applying your edits…') {
  addCodeVersion({
    content: code,
    source: source === 'user' ? 'user' : 'system'
  });
  runActiveCodeVersion(source, statusMessage);
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

function startLoading(message = '') {
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
  const labelEl = loadingIndicator.querySelector('.loading-label');
  if (!timerEl) {
    return;
  }

  if (loadingInterval) {
    clearInterval(loadingInterval);
  }

  loadingStartTime = performance.now();
  loadingIndicator.classList.remove('hidden');
  if (labelEl) {
    labelEl.textContent = message;
  }
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
  const labelEl = loadingIndicator.querySelector('.loading-label');
  if (labelEl) {
    labelEl.textContent = '';
  }

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
  const inputTokensEstimate = tokenEstimate;
  let outputTokensEstimate = 0;
  try {
    const llmStartTime = performance.now();
    chatAbortController?.abort();
    chatAbortController = new AbortController();
    chatAbortSilent = false;

    const systemPromptForIntent = getSystemPromptForIntent(resolvedIntent);
    systemPrompt = systemPromptForIntent;
    const messages = [
      {
        role: 'system',
        content: systemPromptForIntent
      },
      {
        role: 'user',
        content: buildWrappedPrompt(intentAdjustedInput, currentCode, resolvedIntent)
      }
    ];

    console.log('LLM REQUEST:', { model: DEFAULT_MODEL, messages });

    if (!API_BASE) {
      throw new Error('API_BASE is not configured');
    }

    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: chatAbortController.signal,
      body: JSON.stringify({
        messages,
        sessionId,
        intentType: resolvedIntent.type,
        user: getUserContext()
      })
    });

    const responseText = await res.text();
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }
    const llmEndTime = performance.now();
    generationMetadata = formatGenerationMetadata(llmEndTime - llmStartTime);

    if (!res.ok) {
      throw new Error(`Chat API failed (${res.status}): ${responseText || data?.message || data?.error || 'Unknown error'}`);
    }

    setStatusOnline(true);
    const content =
      data?.choices?.[0]?.message?.content
      ?? data?.candidates?.[0]?.content
      ?? data?.output_text
      ?? null;
    if (!content) {
      throw new Error('No model output returned');
    }
    rawReply = content;
    outputTokensEstimate = estimateTokensForContent(rawReply);
    applyUsageToCredits(data?.usage);
    updateSessionStatsFromUsage({
      usage: data?.usage,
      inputTokensEstimate,
      outputTokensEstimate
    });
    throttleSnapshot = updateThrottleState({ estimatedNextCost: 0 });
    usageMetadata = formatUsageMetadata(data?.usage, getCreditState(), throttleSnapshot);
    updateCreditPreview({ force: true });
    updateCreditUI();
    await refreshAnalyticsAndThrottle({ force: true });
    generationFeedback.stop();
  } catch (error) {
    generationFeedback.stop();
    if (error?.name === 'AbortError') {
      if (chatAbortSilent) {
        const pendingMessage = document.querySelector(`[data-id="${pendingMessageId}"]`);
        pendingMessage?.remove();
        updateClearChatButtonState();
        unlockChat();
        stopLoading();
        chatAbortController = null;
        chatAbortSilent = false;
        return;
      }
    }
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    finalizeChatOnce(() => {
      renderSystemMessage(
        pendingMessageId,
        `Backend error: ${message || 'Unknown error'}`
      );
    });
    unlockChat();
    stopLoading();
    chatAbortController = null;
    chatAbortSilent = false;
    return;
  }
  chatAbortController = null;
  chatAbortSilent = false;

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
      setCodeFromLLM(extractedCode, pendingMessageId);
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

if (clearChatButton) {
  clearChatButton.addEventListener('click', () => {
    openClearChatModal();
  });
  updateClearChatButtonState();
}

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

if (accountLink) {
  accountLink.addEventListener('click', (event) => {
    event.preventDefault();
    closeUserMenu?.();
    setRoute('/account');
  });
}

if (profileEditLink) {
  profileEditLink.addEventListener('click', (event) => {
    event.preventDefault();
    closeUserMenu?.();
    setRoute('/account/profile');
  });
}

if (galleryLink) {
  galleryLink.addEventListener('click', (event) => {
    event.preventDefault();
    closeUserMenu?.();
    setRoute('/gallery');
  });
}

if (publicGalleryButton) {
  publicGalleryButton.addEventListener('click', () => {
    setRoute('/gallery/public');
  });
}

if (accountProfileEditButton) {
  accountProfileEditButton.addEventListener('click', () => {
    setRoute('/account/profile');
  });
}

if (accountViewGalleryButton) {
  accountViewGalleryButton.addEventListener('click', () => {
    setRoute('/gallery');
  });
}

if (accountViewPublicGalleryButton) {
  accountViewPublicGalleryButton.addEventListener('click', () => {
    setRoute('/gallery/public');
  });
}

if (accountViewProfileButton) {
  accountViewProfileButton.addEventListener('click', () => {
    openOwnProfile();
  });
}

if (accountBackButton) {
  accountBackButton.addEventListener('click', () => {
    setRoute('/');
  });
}

if (profileEditBackButton) {
  profileEditBackButton.addEventListener('click', () => {
    setRoute('/account');
  });
}

if (profileBackButton) {
  profileBackButton.addEventListener('click', () => {
    setRoute('/gallery/public');
  });
}

if (galleryBackButton) {
  galleryBackButton.addEventListener('click', () => {
    setRoute('/');
  });
}

if (publicGalleryBackButton) {
  publicGalleryBackButton.addEventListener('click', () => {
    setRoute('/');
  });
}

if (publicGallerySortButtons.length) {
  publicGallerySortButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const sort = button.dataset.sort;
      if (!sort || sort === galleryState.publicSort) {
        return;
      }
      galleryState.publicSort = sort;
      publicGallerySortButtons.forEach((item) => {
        item.classList.toggle('is-active', item.dataset.sort === sort);
      });
      loadPublicGallery().catch((error) => {
        console.warn('Failed to load sorted public gallery.', error);
      });
    });
  });
}

window.addEventListener('popstate', () => {
  updateRouteView();
});

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-route]');
  if (!link) {
    return;
  }
  const href = link.getAttribute('href');
  if (!href) {
    return;
  }
  event.preventDefault();
  setRoute(href);
});

if (profileTabs.length) {
  profileTabs.forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.profileTab;
      if (!tab) {
        return;
      }
      setProfileTab(tab);
    });
  });
}

if (profileBioInput && profileBioCount) {
  profileBioInput.addEventListener('input', () => {
    profileBioCount.textContent = `${profileBioInput.value.length} / 280`;
  });
}

if (profileHandleInput) {
  profileHandleInput.addEventListener('input', () => {
    const normalized = normalizeHandle(profileHandleInput.value);
    profileHandleInput.value = normalized;
    if (!normalized) {
      updateProfileHandleStatus({ message: 'Handle is required.', isError: true });
      return;
    }
    if (!isValidHandle(normalized)) {
      updateProfileHandleStatus({ message: 'Handle must be at least 3 characters.', isError: true });
      return;
    }
    if (isReservedHandle(normalized)) {
      updateProfileHandleStatus({ message: 'Handle is reserved.', isError: true });
      return;
    }
    updateProfileHandleStatus({ message: 'Checking availability…', isError: false });
    if (handleCheckTimer) {
      clearTimeout(handleCheckTimer);
    }
    handleCheckTimer = window.setTimeout(async () => {
      const currentHandle = profileState.profile?.handle || '';
      const status = await checkHandleAvailability(normalized, currentHandle);
      updateProfileHandleStatus({ message: status.message, isError: !status.available });
    }, 400);
  });
}

if (profileAvatarInput && profileEditAvatarPreview) {
  profileAvatarInput.addEventListener('change', () => {
    const file = profileAvatarInput.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      profileEditAvatarPreview.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

if (profileEditForm) {
  profileEditForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (profileSaveButton) {
      profileSaveButton.disabled = true;
    }
    try {
      const handle = normalizeHandle(profileHandleInput?.value || '');
      if (!isValidHandle(handle)) {
        updateProfileHandleStatus({ message: 'Enter a valid handle (min 3 characters).', isError: true });
        return;
      }
      if (isReservedHandle(handle)) {
        updateProfileHandleStatus({ message: 'Handle is reserved.', isError: true });
        return;
      }
      const availability = await checkHandleAvailability(handle, profileState.profile?.handle || '');
      if (!availability.available) {
        updateProfileHandleStatus({ message: availability.message, isError: true });
        return;
      }
      const formData = new FormData();
      const avatarFile = profileAvatarInput?.files?.[0];
      if (avatarFile) {
        formData.append('avatar', avatarFile);
      }
      formData.append('handle', handle);
      formData.append('display_name', profileDisplayNameInput?.value.trim() || '');
      formData.append('bio', profileBioInput?.value.trim() || '');
      formData.append('age', profileAgeInput?.value ? profileAgeInput.value : '');
      formData.append('gender', profileGenderInput?.value.trim() || '');
      formData.append('city', profileCityInput?.value.trim() || '');
      formData.append('country', profileCountryInput?.value.trim() || '');
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: 'PATCH',
        credentials: 'include',
        body: formData
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Profile update failed');
      }
      const data = await res.json().catch(() => ({}));
      profileState.profile = data?.profile || data || profileState.profile;
      showToast('Profile updated.', { variant: 'success', duration: 2000 });
      setRoute('/account');
    } catch (error) {
      console.error('Profile update failed.', error);
      showToast(error?.message || 'Unable to update profile.');
    } finally {
      if (profileSaveButton) {
        profileSaveButton.disabled = false;
      }
    }
  });
}

if (profileCancelButton) {
  profileCancelButton.addEventListener('click', () => {
    setRoute('/account');
  });
}

if (accountCopyUserIdButton) {
  accountCopyUserIdButton.addEventListener('click', async () => {
    const userId = accountUserIdEl?.textContent?.trim();
    if (!userId || userId === '—') {
      return;
    }
    const copied = await copyToClipboard(userId);
    if (copied) {
      showToast('User ID copied.', { variant: 'success', duration: 2000 });
    }
  });
}

if (accountClearSessionButton) {
  accountClearSessionButton.addEventListener('click', () => {
    openClearChatModal();
  });
}

if (accountSaveSessionButton) {
  accountSaveSessionButton.addEventListener('click', () => {
    const summary = buildSessionSummary(new Date());
    saveChatToJSON(summary);
  });
}

if (accountDownloadLatestButton) {
  accountDownloadLatestButton.addEventListener('click', () => {
    const summary = buildSessionSummary(new Date());
    downloadSessionExport({
      session_id: summary.session_id,
      started_at: summary.started_at,
      ended_at: summary.ended_at,
      turns: summary.turns,
      credits_used: summary.credits_used_estimate,
      tokens_in: summary.tokens_in,
      tokens_out: summary.tokens_out
    }, 'json');
  });
}

if (accountSessionHistoryBody) {
  accountSessionHistoryBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-session-action]');
    if (!button) {
      return;
    }
    const sessionId = button.dataset.sessionId;
    const action = button.dataset.sessionAction;
    const summary = accountState.sessionHistory.find((entry) => entry.session_id === sessionId);
    if (!summary) {
      return;
    }
    if (action === 'json') {
      downloadSessionExport(summary, 'json');
    } else if (action === 'md') {
      downloadSessionExport(summary, 'md');
    } else {
      downloadSessionExport(summary, 'txt');
    }
  });
}

if (galleryGrid) {
  galleryGrid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    const card = button.closest('[data-artifact-id]');
    const artifactId = card?.dataset.artifactId;
    if (!artifactId) {
      return;
    }
    const action = button.dataset.action;
    if (action === 'open') {
      handleArtifactOpen(artifactId);
    } else if (action === 'versions') {
      openArtifactVersionsModal(artifactId);
    } else if (action === 'edit') {
      handleArtifactEdit(artifactId);
    } else if (action === 'delete') {
      handleArtifactDelete(artifactId);
    } else if (action === 'toggle-visibility') {
      handleArtifactVisibilityToggle(artifactId);
    } else if (action === 'duplicate') {
      handleArtifactDuplicate(artifactId);
    }
  });
}

if (publicGalleryGrid) {
  publicGalleryGrid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    const card = button.closest('[data-artifact-id]');
    const artifactId = card?.dataset.artifactId;
    if (!artifactId) {
      return;
    }
    const action = button.dataset.action;
    if (action === 'open') {
      handleArtifactOpen(artifactId);
    } else if (action === 'versions') {
      openArtifactVersionsModal(artifactId);
    } else if (action === 'import') {
      handleArtifactImport(artifactId);
    } else if (action === 'like') {
      handleArtifactLikeToggle(artifactId);
    } else if (action === 'comments') {
      openCommentsModal(artifactId).catch((error) => {
        console.warn('Failed to open comments.', error);
      });
    }
  });
}

if (profileArtifactsGrid) {
  profileArtifactsGrid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    const card = button.closest('[data-artifact-id]');
    const artifactId = card?.dataset.artifactId;
    if (!artifactId) {
      return;
    }
    const action = button.dataset.action;
    if (action === 'open') {
      handleArtifactOpen(artifactId);
    } else if (action === 'versions') {
      openArtifactVersionsModal(artifactId);
    } else if (action === 'import') {
      handleArtifactImport(artifactId);
    } else if (action === 'like') {
      handleArtifactLikeToggle(artifactId);
    } else if (action === 'comments') {
      openCommentsModal(artifactId).catch((error) => {
        console.warn('Failed to open comments.', error);
      });
    }
  });
}

if (profileForksGrid) {
  profileForksGrid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    const card = button.closest('[data-artifact-id]');
    const artifactId = card?.dataset.artifactId;
    if (!artifactId) {
      return;
    }
    const action = button.dataset.action;
    if (action === 'open') {
      handleArtifactOpen(artifactId);
    } else if (action === 'versions') {
      openArtifactVersionsModal(artifactId);
    } else if (action === 'import') {
      handleArtifactImport(artifactId);
    } else if (action === 'like') {
      handleArtifactLikeToggle(artifactId);
    } else if (action === 'comments') {
      openCommentsModal(artifactId).catch((error) => {
        console.warn('Failed to open comments.', error);
      });
    }
  });
}

if (accountHistoryLoadMore) {
  accountHistoryLoadMore.addEventListener('click', () => {
    accountState.rangeIndex = Math.min(accountState.rangeIndex + 1, ACCOUNT_RANGE_STEPS.length - 1);
    loadAccountUsageHistory().catch((error) => {
      console.warn('Failed to load more account history.', error);
    });
  });
}

if (accountSignOutButton) {
  accountSignOutButton.addEventListener('click', () => {
    signOut();
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
  scheduleUserCodeVersionSave();
  resetExecutionPreparation();
  updateLineNumbers();
  updateSaveCodeButtonState();
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

document.addEventListener('DOMContentLoaded', async () => {
  if (!runButton) {
    console.warn('⚠️ Run Code button not found');
    return;
  }
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  await initializeSessionState();
  if (sessionState?.current_editor?.content && codeEditor) {
    codeEditor.value = sessionState.current_editor.content;
    baselineCode = codeEditor.value;
    currentCode = codeEditor.value;
    updateLineNumbers();
  }
  initializeVersionStack();
  updateSaveCodeButtonState();
  console.log('✅ Run Code listener attached');
  runButton.addEventListener('click', () => {
    console.log('🟢 Run Code clicked');
    if (userHasEditedCode) {
      handleUserRun(codeEditor.value);
      return;
    }
    runActiveCodeVersion('user', 'Re-running active version…');
  });
  if (!revertButton) {
    console.warn('⚠️ Revert button not found');
  } else {
    revertButton.addEventListener('click', () => {
      safeRevertBackward();
    });
  }
  if (!forwardButton) {
    console.warn('⚠️ Forward button not found');
  } else {
    forwardButton.addEventListener('click', () => {
      safeGoForward();
    });
  }
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
    if (userHasEditedCode) {
      handleUserRun(codeEditor.value);
      return;
    }
    runActiveCodeVersion('user', 'Re-running active version…');
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
setInterval(updateSessionAnalyticsPanel, 60000);

if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  preview.once('ready', () => {
    console.assert(
      !currentTurnMessageId || chatFinalized,
      'Preview ready before chat finalized'
    );
  });
}
