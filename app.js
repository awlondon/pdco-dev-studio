import { createSandboxController } from './sandboxController.js';

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('btn-send');
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
const SANDBOX_TIMEOUT_MS = 4500;
const BACKEND_URL =
  "https://text-code.primarydesigncompany.workers.dev";

const defaultInterfaceCode = `<!doctype html>
<html>
<body>
<div id="app"></div>
</body>
</html>`;

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

updateLineNumbers();

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

function appendMessage(role, content, options = {}) {
  const message = document.createElement('div');
  message.className = `message ${role}${options.className ? ` ${options.className}` : ''}`;
  message.textContent = content;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function renderAssistantMessage(messageId, text, metadata) {
  const safeText =
    (typeof text === 'string' && text.trim().length)
      ? text.trim()
      : 'Generated output.';

  if (messageId) {
    updateMessage(messageId, formatAssistantHtml(safeText));
  } else {
    appendMessage('assistant', safeText);
  }

  if (metadata) {
    appendChatMeta(metadata, messageId);
  }
}

function appendChatMeta(text, messageId) {
  if (!text) {
    return;
  }

  const message = messageId
    ? document.querySelector(`[data-id="${messageId}"]`)
    : null;
  const meta = document.createElement('div');
  meta.className = 'assistant-meta';
  meta.textContent = text;

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
    return `— Generated in ${seconds} s · Auto-run enabled`;
  }
  return `— Generated in ${Math.round(durationMs)} ms · Auto-run enabled`;
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
  const s = String(raw ?? '');

  const fence = s.match(/```(?:html|xml|svg|javascript|js|css)?\s*([\s\S]*?)```/i);
  if (fence) {
    const code = fence[1].trim();
    const text = s.slice(0, fence.index).trim();
    return { text, code };
  }

  const looksLikeHtml = /<!doctype html>|<html[\s>]|<script[\s>]/i.test(s);
  if (looksLikeHtml) {
    return { text: 'Generated the updated interface.', code: s.trim() };
  }

  return { text: s.trim(), code: '' };
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
    /\bI can (?:create|build|make|generate|design)\s+([^.\n]+)/i
  );
  if (!proposalMatch) {
    return null;
  }
  const description = proposalMatch[1]?.trim();
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

  const userInput = chatInput.value.trim();
  if (!userInput) {
    return;
  }

  const startedAt = performance.now();
  const resolvedIntent = resolveIntent(userInput);
  if (DEBUG_INTENT) {
    console.log('[intent]', {
      userText: userInput,
      pendingAssistantProposal,
      resolvedIntent
    });
  }

  let intentAdjustedInput = userInput;
  if (resolvedIntent.inferred && pendingAssistantProposal) {
    const description = pendingAssistantProposal.description || 'the proposed experience';
    intentAdjustedInput = `Yes — please proceed with ${description}.`;
  }

  lockChat();
  chatInput.value = '';
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

  let generationMetadata = '';
  let rawReply = '';
  try {
    const llmStartTime = performance.now();
    const systemPrompt = `You are a coding assistant.
When the user asks to draw or create something visual,
output a complete HTML document.
Do not use JSON.
Do not use code fences.
Otherwise, respond with plain text.`;

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
      body: JSON.stringify({ messages })
    });

    const data = await res.json();
    const llmEndTime = performance.now();
    generationMetadata = formatGenerationMetadata(llmEndTime - llmStartTime);

    if (!res.ok) {
      throw new Error(data?.error || 'Unable to reach the chat service.');
    }

    setStatusOnline(true);
    rawReply = data?.choices?.[0]?.message?.content || 'No response.';
  } catch (error) {
    finalizeChatOnce(() => {
      renderAssistantMessage(pendingMessageId, '⚠️ Something went wrong while generating the response.', formatGenerationMetadata(performance.now() - startedAt));
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
  if (!hasCode) {
    const assistantProposal = getAssistantProposal(extractedText);
    if (assistantProposal) {
      pendingAssistantProposal = assistantProposal;
    }
  }

  const elapsed = performance.now() - startedAt;
  const metadataText = generationMetadata || formatGenerationMetadata(elapsed);
  finalizeChatOnce(() => {
    renderAssistantMessage(pendingMessageId, extractedText, metadataText);
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
    document.body.style.overflow = 'hidden';
    fullscreenToggle.textContent = '⤡ Exit Fullscreen';
  };

  const exitFullscreen = () => {
    consolePane.classList.remove('preview-fullscreen');
    document.body.style.overflow = '';
    fullscreenToggle.textContent = '⤢ Fullscreen';
  };

  fullscreenToggle.addEventListener('click', () => {
    const isFullscreen = consolePane.classList.contains('preview-fullscreen');
    if (isFullscreen) {
      exitFullscreen();
      return;
    }
    enterFullscreen();
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
