import { createSandboxController } from './sandboxController.js';

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('btn-send');
const creditPreviewEl = document.getElementById('credit-preview');
const micButton = document.getElementById('btn-mic');
const creditBadge = document.getElementById('credit-badge');
const creditPanel = document.getElementById('credit-panel');
const creditMeterFill = document.querySelector('.credit-meter-fill');
const creditMeterLabel = document.querySelector('.credit-meter-label');
const creditResetLabel = document.getElementById('credit-reset');
const creditDailyLimitLabel = document.getElementById('credit-daily-limit');
const creditInlineWarning = document.getElementById('credit-inline-warning');
const creditBanner = document.getElementById('credit-banner');
const creditZero = document.getElementById('credit-zero');
const creditDailyMessage = document.getElementById('credit-daily-message');
const creditUpgradeNudge = document.getElementById('credit-upgrade-nudge');
const codeEditor = document.getElementById('code-editor');
const lineNumbersEl = document.getElementById('line-numbers');
const lineCountEl = document.getElementById('line-count');
const consoleLog = document.getElementById('console-output-log');
const consolePane = document.getElementById('consoleOutput');
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
const BACKEND_URL =
  "https://text-code.primarydesigncompany.workers.dev";
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

const TOKENS_PER_CREDIT = 250;
const CREDIT_BAND_MIN = 0.7;
const CREDIT_BAND_MAX = 1.3;
const CREDIT_WARNING_THRESHOLD = 0.5;
const LOW_CREDIT_WARNING_THRESHOLD = 3;
const SOFT_WARNING_THRESHOLD = 0.3;
const HARD_WARNING_THRESHOLD = 0.1;
const UPGRADE_NUDGE_KEY = 'mayaUpgradeNudgeShown';
const LOW_CREDIT_WARNING_KEY = 'mayaLowCreditWarningShown';

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

function estimateTokensFromText(text) {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

function estimateTokensFromCode(code) {
  if (!code) {
    return 0;
  }
  return Math.ceil(code.length / 3);
}

function estimateTotalTokens({ userInput, currentCode, intentType }) {
  const inputTokens = estimateTokensFromText(userInput) + estimateTokensFromCode(currentCode);
  const outputMultiplier = intentType === 'code' ? 2.5 : 1.2;
  const estimatedOutputTokens = Math.ceil(inputTokens * outputMultiplier);

  return {
    inputTokens,
    outputTokens: estimatedOutputTokens,
    totalTokens: inputTokens + estimatedOutputTokens
  };
}

function tokensToCredits(tokenCount) {
  return Math.ceil(tokenCount / TOKENS_PER_CREDIT);
}

function estimateCreditRange(tokenEstimate) {
  const baseCredits = tokensToCredits(tokenEstimate);
  return {
    min: Math.max(1, Math.floor(baseCredits * CREDIT_BAND_MIN)),
    max: Math.ceil(baseCredits * CREDIT_BAND_MAX)
  };
}

function estimateCreditsPreview({ userInput, currentCode, intentType }) {
  const { totalTokens } = estimateTotalTokens({
    userInput,
    currentCode,
    intentType
  });

  return estimateCreditRange(totalTokens);
}

function formatCreditPreview({ min, max, intentType, creditState }) {
  const intentLabel = intentType === 'code' ? 'visual generation' : 'chat';
  let text = `≈ ${min}–${max} credits · ${intentLabel}`;

  if (creditState.isFreeTier && creditState.freeTierRemaining !== null) {
    text += ` · free tier (${creditState.freeTierRemaining} left today)`;
  }

  return text;
}

function formatCreditWarning({ min, max, remainingCredits }) {
  if (!remainingCredits || remainingCredits <= 0) {
    return null;
  }
  const minFraction = Math.round((min / remainingCredits) * 100);
  const maxFraction = Math.round((max / remainingCredits) * 100);
  return `⚠️ ~${minFraction}–${maxFraction}% of remaining credits`;
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
  const { min, max } = estimateCreditsPreview({
    userInput: userText,
    currentCode,
    intentType: resolvedIntent.type
  });

  let previewText = formatCreditPreview({
    min,
    max,
    intentType: resolvedIntent.type,
    creditState
  });

  const warning = creditState.remainingCredits
    ? formatCreditWarning({
        min,
        max,
        remainingCredits: creditState.remainingCredits
      })
    : null;

  if (warning && max / creditState.remainingCredits >= CREDIT_WARNING_THRESHOLD) {
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

function updateCreditBadge(state) {
  if (!creditBadge) {
    return;
  }
  const iconEl = creditBadge.querySelector('.credit-badge-icon');
  const countEl = creditBadge.querySelector('.credit-badge-count');
  const isFree = state.isFreeTier;
  const isCompact = window.matchMedia?.('(max-width: 640px)').matches;
  if (iconEl) {
    iconEl.textContent = isCompact ? '●' : (isFree ? '🟢' : '💎');
  }
  if (countEl) {
    countEl.textContent = formatCreditNumber(state.remainingCredits);
  }
  const percent = getCreditPercent(state.remainingCredits, state.creditsTotal);
  creditBadge.classList.remove('credit-badge--warn', 'credit-badge--critical');
  if (percent < 0.2) {
    creditBadge.classList.add('credit-badge--critical');
  } else if (percent < 0.5) {
    creditBadge.classList.add('credit-badge--warn');
  }
}

function updateCreditPanel(state) {
  if (!creditPanel) {
    return;
  }
  const percent = getCreditPercent(state.remainingCredits, state.creditsTotal);
  if (creditMeterFill) {
    creditMeterFill.style.width = `${percent * 100}%`;
  }
  if (creditMeterLabel) {
    creditMeterLabel.textContent = `${formatCreditNumber(state.remainingCredits)} / ${formatCreditNumber(state.creditsTotal)}`;
  }
  if (creditResetLabel && Number.isFinite(state.resetDays)) {
    creditResetLabel.textContent = `Resets in ${state.resetDays} days`;
  }
  if (creditDailyLimitLabel && Number.isFinite(state.dailyLimit)) {
    creditDailyLimitLabel.textContent = `Daily limit: ${formatCreditNumber(state.dailyLimit)} credits`;
  }
}

function shouldShowUpgradeNudge(state) {
  const percent = getCreditPercent(state.remainingCredits, state.creditsTotal);
  const dailyCapHit = Number.isFinite(state.dailyLimit)
    && Number.isFinite(state.todayCreditsUsed)
    && state.todayCreditsUsed >= state.dailyLimit;
  const blocked = state.remainingCredits !== null && state.remainingCredits <= 0;
  return percent < 0.2 || dailyCapHit || blocked;
}

function updateCreditAlerts(state) {
  if (!creditInlineWarning || !creditBanner || !creditZero) {
    return;
  }
  const percent = getCreditPercent(state.remainingCredits, state.creditsTotal);
  const dailyCapHit = Number.isFinite(state.dailyLimit)
    && Number.isFinite(state.todayCreditsUsed)
    && state.todayCreditsUsed >= state.dailyLimit;
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

  const softWarningShown = window.sessionStorage?.getItem(LOW_CREDIT_WARNING_KEY);
  if (percent <= SOFT_WARNING_THRESHOLD && percent > HARD_WARNING_THRESHOLD && !softWarningShown) {
    creditInlineWarning.textContent = '⚠️ You’re getting low on credits.';
    creditInlineWarning.classList.remove('hidden');
    window.sessionStorage?.setItem(LOW_CREDIT_WARNING_KEY, 'true');
  } else if (percent > SOFT_WARNING_THRESHOLD) {
    creditInlineWarning.classList.add('hidden');
  }

  if (percent <= HARD_WARNING_THRESHOLD && percent > 0) {
    creditBanner.textContent = '🚨 Only ~3 generations left this month.';
    creditBanner.classList.remove('hidden');
  } else {
    creditBanner.classList.add('hidden');
  }

  if (dailyCapHit) {
    const resetTime = state.dailyResetTime || 'tomorrow';
    creditInlineWarning.textContent = `⏳ Daily limit reached. More credits unlock in ${resetTime}.`;
    creditInlineWarning.classList.remove('hidden');
    if (!state.isFreeTier) {
      creditInlineWarning.innerHTML = `⏳ Daily limit reached. More credits unlock in ${resetTime}. <span class="credit-link">Need more today? Buy a top-up →</span>`;
    }
  }

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
    if (shouldShowUpgradeNudge(state) && !window.sessionStorage?.getItem(UPGRADE_NUDGE_KEY)) {
      creditUpgradeNudge.classList.remove('hidden');
      window.sessionStorage?.setItem(UPGRADE_NUDGE_KEY, 'true');
    } else if (!shouldShowUpgradeNudge(state)) {
      creditUpgradeNudge.classList.add('hidden');
    }
  }
}

function updateCreditUI() {
  const state = getCreditState();
  updateCreditBadge(state);
  updateCreditPanel(state);
  updateCreditAlerts(state);
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

codeEditor.value = defaultInterfaceCode;
let currentCode = defaultInterfaceCode;
let baselineCode = defaultInterfaceCode;
let previousCode = null;
let loadingStartTime = null;
let loadingInterval = null;
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

function formatUsageMetadata(usage, context) {
  if (!usage || !Number.isFinite(usage.creditsCharged)) {
    return { usageText: '', warningText: '' };
  }
  const pieces = [`Used ${usage.creditsCharged} credits`];
  if (Number.isFinite(usage.remainingCredits)) {
    pieces.push(`${usage.remainingCredits} remaining`);
    if (usage.remainingCredits <= LOW_CREDIT_WARNING_THRESHOLD) {
      pieces.push(`⚠️ ${usage.remainingCredits} runs remaining this month`);
    }
  }
  const usageText = `— ${pieces.join(' · ')}`;
  let warningText = '';
  if (context?.dailyLimit && Number.isFinite(context.dailyLimit) && context.dailyLimit > 0) {
    const percent = Math.round((usage.creditsCharged / context.dailyLimit) * 100);
    if (percent >= 18) {
      warningText = `⚠️ Large generation · ${percent}% of daily limit`;
    }
  }
  return { usageText, warningText };
}

function applyUsageToCredits(usage) {
  if (!usage || !Number.isFinite(usage.remainingCredits)) {
    return;
  }
  const root = document.getElementById('root');
  if (root) {
    root.dataset.remainingCredits = usage.remainingCredits;
    if (Number.isFinite(usage.creditsCharged)) {
      const currentUsed = Number.parseInt(root.dataset.todayCreditsUsed ?? '0', 10);
      const updatedUsed = Number.isFinite(currentUsed) ? currentUsed + usage.creditsCharged : usage.creditsCharged;
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
  sandbox.run(code);
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
  setSendDisabled(false);
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

  const creditState = getCreditState();
  if (creditState.remainingCredits !== null && creditState.remainingCredits <= 0) {
    updateCreditUI();
    return;
  }

  const userInput = chatInput.value.trim();
  if (!userInput) {
    return;
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

    const res = await fetch(BACKEND_URL, {
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
    rawReply = data?.choices?.[0]?.message?.content || 'No response.';
    usageMetadata = formatUsageMetadata(data?.usage, getCreditState());
    applyUsageToCredits(data?.usage);
    updateCreditPreview({ force: true });
    updateCreditUI();
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
  finalizeChatOnce(() => {
    renderAssistantMessage(pendingMessageId, extractedText, metadataParts);
  });

  try {
    const trimmedCode = extractedCode?.trim();
    const codeChanged = Boolean(trimmedCode) && trimmedCode !== (currentCode?.trim() || '');
    if (codeChanged) {
      currentCode = extractedCode;
      setCodeFromLLM(extractedCode);
      pendingAssistantProposal = null;
      console.log('AUTO-RUN CHECK', {
        codeChanged,
        chatFinalized
      });
      runWhenPreviewReady(() => {
        handleLLMOutput(trimmedCode, 'generated').catch((error) => {
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
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChat();
});

if (chatInput) {
  chatInput.addEventListener('input', () => {
    requestCreditPreviewUpdate();
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

window.addEventListener('resize', () => {
  updateCreditBadge(getCreditState());
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

  updateCreditUI();
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
