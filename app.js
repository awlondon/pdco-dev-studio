const DEBUG_INTENT = true; // flip to false to silence intent logs
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('btn-send');
const codeEditor = document.getElementById('code-editor');
const consoleLog = document.getElementById('console-output-log');
const consolePane = document.getElementById('consoleOutput');
const previewFrameContainer = document.getElementById('previewFrameContainer');
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
const codeIntentBadge = document.getElementById('codeIntentBadge');
const executionWarnings = document.getElementById('executionWarnings');
const runButton = document.getElementById('runCode');
const SANDBOX_TIMEOUT_MS = 5000;
const MAX_RAF = 600;
const MAX_INTERVALS = 25;
const BACKEND_URL =
  "https://text-code.primarydesigncompany.workers.dev";

const defaultInterfaceCode = `<!doctype html>
<html>
<body>
<div id="app"></div>
</body>
</html>`;

codeEditor.value = defaultInterfaceCode;
let currentCode = defaultInterfaceCode;
let previousCode = null;
let lastUserIntent = null;
let loadingStartTime = null;
let loadingInterval = null;
let editorDirty = false;
let lastUpdateSource = 'llm';
let sandboxIframe = null;
let sandboxKillTimer = null;
let sandboxStartTime = null;
let sandboxFrameCount = 0;
let sandboxStatusTimer = null;
let pendingExecution = null;
let awaitingConfirmation = false;
let sandboxListenerBound = false;
const CODE_INTENT_PATTERNS = [
  /build|create|make|generate/i,
  /show|visualize|diagram|chart|graph|ui|interface|layout/i,
  /button|slider|input|click|drag|hover/i,
  /html|css|js|javascript|code|component/i,
  /add|remove|change|modify|update|refactor/i
];

function getHasExistingCode() {
  const code = codeEditor?.value ?? '';
  const trimmed = code.trim();
  return Boolean(trimmed && trimmed.includes('<html'));
}

function setStatusOnline(isOnline) {
  statusLabel.textContent = isOnline ? 'API online' : 'Offline';
  statusLabel.classList.toggle('online', isOnline);
}

function updateCodeIntentBadge(codeIntent) {
  if (!codeIntentBadge) {
    return;
  }

  if (DEBUG_INTENT && codeIntent) {
    codeIntentBadge.classList.remove('hidden');
  } else {
    codeIntentBadge.classList.add('hidden');
  }
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

function setPreviewExecutionStatus(state, message) {
  if (!previewExecutionStatus) {
    return;
  }

  previewExecutionStatus.textContent = message;
  previewExecutionStatus.className = `preview-execution-status ${state}`;
}

function renderAssistantText(text, messageId) {
  if (messageId) {
    updateMessage(messageId, formatAssistantHtml(text));
    return;
  }

  appendMessage('assistant', text);
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

function extractHtml(responseText) {
  const match = responseText.match(/```html([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

function extractChatText(responseText) {
  return responseText
    .replace(/```html[\s\S]*?```/gi, '')
    .replace(/```json[\s\S]*?```/gi, '')
    .trim();
}

function buildWrappedPrompt(userInput, currentCode) {
  if (!currentCode) {
    return userInput;
  }

  return `Current code:\n${currentCode}\n\nUser: ${userInput}`;
}

function analyzeCodeForExecution(code, debugIntent = false) {
  const flags = {
    hasRAF: code.includes('requestAnimationFrame'),
    hasWhileTrue: /while\s*\(\s*true\s*\)/.test(code),
    hasSetInterval: code.includes('setInterval'),
    hasCanvas: code.includes('<canvas') || code.includes('getContext('),
    hasWorker: code.includes('new Worker')
  };

  let executionProfile = 'static';
  if (flags.hasRAF || flags.hasSetInterval) {
    executionProfile = 'animation';
  }
  if (flags.hasCanvas) {
    executionProfile = 'canvas-sim';
  }

  const warnings = [];
  if (flags.hasRAF) {
    warnings.push('requestAnimationFrame detected');
  }
  if (flags.hasSetInterval) {
    warnings.push('setInterval detected');
  }
  if (flags.hasCanvas) {
    warnings.push('canvas detected');
  }
  if (flags.hasWorker) {
    warnings.push('Web Worker detected');
  }

  let allowed = true;
  if (flags.hasWhileTrue) {
    warnings.push('blocking while(true) loop detected');
    allowed = false;
  }

  if (debugIntent) {
    console.groupCollapsed('🧪 Execution analysis');
    console.log('Profile:', executionProfile);
    console.log('Allowed:', allowed);
    console.log('Flags:', flags);
    console.log('Warnings:', warnings);
    console.groupEnd();
  }

  return {
    allowed,
    executionProfile,
    warnings
  };
}

function resetExecutionPreparation({ clearWarnings = true } = {}) {
  awaitingConfirmation = false;
  pendingExecution = null;
  if (runButton) {
    runButton.textContent = 'Run Code';
    runButton.disabled = false;
  }
  if (clearWarnings) {
    setExecutionWarnings([]);
  }
}

function detectCodeIntent(userInput, hasExistingCode) {
  const text = userInput.trim().toLowerCase();

  if (/^(explain|tell me about|what is|who is)/i.test(text)) {
    return {
      intent: false,
      source: 'explicit-text',
      match: text
    };
  }

  if (/^\/ui\b|^\/code\b/i.test(text)) {
    return {
      intent: true,
      source: 'explicit',
      match: '/ui or /code prefix'
    };
  }

  if (hasExistingCode) {
    return {
      intent: true,
      source: 'artifact-default',
      match: 'existing artifact'
    };
  }

  for (const rx of CODE_INTENT_PATTERNS) {
    if (rx.test(text)) {
      return {
        intent: true,
        source: 'heuristic',
        match: rx.toString()
      };
    }
  }

  return {
    intent: false,
    source: 'none',
    match: null
  };
}

function prepareEditorCode({ autoRun = false } = {}) {
  if (!previewFrameContainer) {
    return;
  }

  const wrappedUserCode = codeEditor?.value ?? '';
  const analysis = analyzeCodeForExecution(wrappedUserCode, DEBUG_INTENT);
  setExecutionWarnings(analysis.warnings);
  if (!analysis.allowed) {
    setPreviewStatus('Execution blocked — update the code to continue');
    setPreviewExecutionStatus('stopped', '🔴 Stopped (blocked)');
    appendOutput('Execution blocked due to a blocking loop.', 'error');
    pendingExecution = null;
    return;
  }

  pendingExecution = wrappedUserCode;
  prepareSandbox(wrappedUserCode);

  if (autoRun) {
    startSandboxExecution();
  }
}

function buildSafetyShim() {
  return `
<script>
(() => {
  const MAX_RAF = ${MAX_RAF};
  const MAX_TIME = ${SANDBOX_TIMEOUT_MS};
  const MAX_INTERVALS = ${MAX_INTERVALS};

  let started = false;
  let rafCount = 0;
  let startTime = 0;
  let maxTimeTimer = null;
  let pendingRafs = [];
  let pendingIntervals = new Map();
  let pendingIntervalCounter = 0;
  const activeIntervals = new Set();
  const activeTimeouts = new Set();

  const originalRAF = window.requestAnimationFrame.bind(window);
  const originalCancelRAF = window.cancelAnimationFrame.bind(window);
  const originalSetInterval = window.setInterval.bind(window);
  const originalClearInterval = window.clearInterval.bind(window);
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalClearTimeout = window.clearTimeout.bind(window);

  function stopSandbox(reason = "SANDBOX_STOP") {
    started = false;
    pendingRafs = [];
    pendingIntervals.clear();
    activeIntervals.forEach((id) => originalClearInterval(id));
    activeIntervals.clear();
    activeTimeouts.forEach((id) => originalClearTimeout(id));
    activeTimeouts.clear();
    if (maxTimeTimer) {
      originalClearTimeout(maxTimeTimer);
      maxTimeTimer = null;
    }
    parent.postMessage({ type: reason }, "*");
  }

  function scheduleRAF(cb) {
    return originalRAF((t) => {
      if (!started) {
        return;
      }
      rafCount++;
      parent.postMessage({ type: "SANDBOX_FRAME" }, "*");
      if (rafCount > MAX_RAF || (t - startTime) > MAX_TIME) {
        stopSandbox("SANDBOX_STOP");
        return;
      }
      cb(t);
    });
  }

  window.requestAnimationFrame = function (cb) {
    if (!started) {
      pendingRafs.push(cb);
      return pendingRafs.length;
    }
    return scheduleRAF(cb);
  };

  window.cancelAnimationFrame = function (id) {
    if (!started) {
      pendingRafs = pendingRafs.filter((_, index) => index + 1 !== id);
      return;
    }
    originalCancelRAF(id);
  };

  function startInterval(fn, delay, args) {
    if (activeIntervals.size >= MAX_INTERVALS) {
      stopSandbox("SANDBOX_STOP");
      return null;
    }
    const id = originalSetInterval(fn, delay, ...args);
    activeIntervals.add(id);
    return id;
  }

  window.setInterval = function (fn, delay, ...args) {
    if (!started) {
      const id = `pending-${++pendingIntervalCounter}`;
      pendingIntervals.set(id, { fn, delay, args });
      return id;
    }
    return startInterval(fn, delay, args);
  };

  window.clearInterval = function (id) {
    if (pendingIntervals.has(id)) {
      pendingIntervals.delete(id);
      return;
    }
    originalClearInterval(id);
    activeIntervals.delete(id);
  };

  window.setTimeout = function (fn, delay, ...args) {
    const id = originalSetTimeout(fn, delay, ...args);
    activeTimeouts.add(id);
    return id;
  };

  window.clearTimeout = function (id) {
    originalClearTimeout(id);
    activeTimeouts.delete(id);
  };

  // ----- ERROR FORWARDING -----
  window.addEventListener("error", (e) => {
    parent.postMessage({
      type: "SANDBOX_ERROR",
      message: e.message
    }, "*");
  });

  window.__MAYA_SAFE_START__ = function () {
    if (started) {
      return;
    }
    started = true;
    rafCount = 0;
    startTime = performance.now();
    maxTimeTimer = originalSetTimeout(() => {
      stopSandbox("SANDBOX_STOP");
    }, MAX_TIME);

    const deferredScripts = Array.from(
      document.querySelectorAll('script[type="text/maya"]')
    );
    deferredScripts.forEach((script) => {
      const nextScript = document.createElement('script');
      Array.from(script.attributes).forEach((attr) => {
        if (attr.name === 'type') {
          return;
        }
        nextScript.setAttribute(attr.name, attr.value);
      });
      if (script.src) {
        nextScript.src = script.src;
      } else {
        nextScript.textContent = script.textContent;
      }
      script.parentNode?.replaceChild(nextScript, script);
    });

    pendingRafs.forEach((cb) => scheduleRAF(cb));
    pendingRafs = [];

    pendingIntervals.forEach((value, pendingId) => {
      const intervalId = startInterval(value.fn, value.delay, value.args);
      pendingIntervals.set(pendingId, intervalId);
    });

    if (typeof window.__MAYA_START__ === "function") {
      window.__MAYA_START__();
    }
  };

  window.__MAYA_SAFE_STOP__ = function () {
    if (typeof window.__MAYA_STOP__ === "function") {
      window.__MAYA_STOP__();
    }
    stopSandbox("SANDBOX_STOP");
  };
})();
<\/script>
`;
}

function injectSafetyLayer(html) {
  const safetyScript = buildSafetyShim();
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n${safetyScript}`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (match) => `${match}\n${safetyScript}`);
  }
  return `${safetyScript}\n${html}`;
}

function createSandboxedIframe() {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('aria-label', 'Live preview');
  return iframe;
}

function destroySandbox() {
  stopSandboxStatus('stopped');
  if (sandboxKillTimer) {
    clearTimeout(sandboxKillTimer);
    sandboxKillTimer = null;
  }

  if (sandboxIframe) {
    sandboxIframe.remove();
    sandboxIframe = null;
  }

  outputPanel?.classList.remove('loading');
}

function handleSandboxMessage(event) {
  if (!sandboxIframe || event.source !== sandboxIframe.contentWindow) {
    return;
  }
  const messageType = event?.data?.type;
  if (!messageType) {
    return;
  }

  if (messageType === 'SANDBOX_TIMEOUT') {
    setPreviewExecutionStatus('stopped', '🔴 Stopped (timeout)');
    setPreviewStatus('Execution timed out — sandbox stopped.');
    appendOutput('Sandbox execution timeout.', 'error');
    destroySandbox();
    stopSandboxStatus('⛔ timeout');
    return;
  }

  if (messageType === 'SANDBOX_STOP') {
    setPreviewExecutionStatus('stopped', '🔴 Stopped (safety cap)');
    setPreviewStatus('Execution stopped — safety cap reached.');
    appendOutput('Sandbox stopped due to safety cap.', 'error');
    destroySandbox();
    stopSandboxStatus('⛔ safety cap');
    return;
  }

  if (messageType === 'SANDBOX_ERROR') {
    setPreviewExecutionStatus('stopped', '🔴 Stopped (error)');
    setPreviewStatus('Execution error — sandbox stopped.');
    const errorMessage = event?.data?.message
      ? `Sandbox error: ${event.data.message}`
      : 'Sandbox error.';
    appendOutput(errorMessage, 'error');
    destroySandbox();
    stopSandboxStatus('⚠️ error');
  }

  if (messageType === 'SANDBOX_FRAME') {
    sandboxFrameCount++;
  }
}

function ensureSandboxListener() {
  if (sandboxListenerBound) {
    return;
  }
  window.addEventListener('message', handleSandboxMessage);
  sandboxListenerBound = true;
}

function showSandboxStatus(text) {
  setPreviewStatus(text);
}

function startSandboxStatus() {
  sandboxStartTime = performance.now();
  sandboxFrameCount = 0;

  const statusEl = document.getElementById('sandbox-status');
  if (!statusEl) {
    return;
  }

  if (sandboxStatusTimer) {
    clearInterval(sandboxStatusTimer);
  }

  sandboxStatusTimer = setInterval(() => {
    const elapsed = performance.now() - sandboxStartTime;
    statusEl.textContent =
      `running • ${sandboxFrameCount} frames • ${(elapsed / 1000).toFixed(2)}s`;
  }, 100);
}

function stopSandboxStatus(reason = 'idle') {
  if (sandboxStatusTimer) {
    clearInterval(sandboxStatusTimer);
    sandboxStatusTimer = null;
  }

  const statusEl = document.getElementById('sandbox-status');
  if (statusEl) {
    statusEl.textContent = reason;
  }
}

function deferScripts(html) {
  return html.replace(/<script(\s|>)/gi, '<script type="text/maya"$1');
}

function prepareSandbox(userHTML) {
  console.log('🧩 Preparing sandbox preview');
  if (!previewFrameContainer) {
    return;
  }

  ensureSandboxListener();
  destroySandbox();

  sandboxIframe = createSandboxedIframe();
  previewFrameContainer.appendChild(sandboxIframe);
  outputPanel?.classList.add('loading');

  setPreviewExecutionStatus('ready', 'Ready');
  setPreviewStatus('Preview updated — click Run Code to execute');
  stopSandboxStatus('idle');

  sandboxIframe.onload = () => {
    outputPanel?.classList.remove('loading');
  };

  const safety = buildSafetyShim();
  const doc = sandboxIframe.contentDocument;
  const deferredHtml = deferScripts(userHTML);
  doc.open();
  doc.write(`
<!DOCTYPE html>
<html>
<body>
${safety}
${deferredHtml}
</body>
</html>
  `);
  doc.close();
}

function startSandboxExecution() {
  if (!sandboxIframe?.contentWindow) {
    setPreviewStatus('No preview loaded — generate or apply code first');
    return;
  }

  setPreviewExecutionStatus('running', '🟢 Running…');
  setPreviewStatus('Sandbox running…');
  startSandboxStatus();

  if (sandboxKillTimer) {
    clearTimeout(sandboxKillTimer);
  }
  sandboxKillTimer = setTimeout(() => {
    destroySandbox();
    setPreviewExecutionStatus('stopped', '🔴 Stopped (timeout)');
    showSandboxStatus('⛔ Execution stopped (timeout)');
    appendOutput('Sandbox hard stop triggered.', 'error');
    stopSandboxStatus('⛔ timeout');
  }, SANDBOX_TIMEOUT_MS + 500);

  sandboxIframe.contentWindow.__MAYA_SAFE_START__?.();
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
  setPreviewExecutionStatus('stale', 'Stale');
}

function applyLLMCode(code) {
  lastUpdateSource = 'llm';
  codeEditor.value = code;
  editorDirty = false;
  setPreviewStatus('Preview updated by assistant');
  prepareEditorCode({ autoRun: false });
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

async function sendChat() {
  const userInput = chatInput.value.trim();
  if (!userInput) {
    return;
  }

  chatInput.value = '';
  appendMessage('user', userInput);
  const hasExistingCode = getHasExistingCode();
  const intentInfo = detectCodeIntent(userInput, hasExistingCode);
  const codeIntent = intentInfo.intent;
  if (DEBUG_INTENT) {
    console.groupCollapsed('🧠 Code Intent Decision');
    console.log('User input:', userInput);
    console.log('Code intent:', intentInfo.intent);
    console.log('Source:', intentInfo.source);
    console.log('Matched:', intentInfo.match);
    console.groupEnd();
  }
  updateCodeIntentBadge(codeIntent);

  const pendingMessageId = addMessage(
    'assistant',
    '<em>Generating text + code…</em>',
    { pending: true }
  );

  sendButton.disabled = true;
  setStatusOnline(false);
  startLoading();

  try {
    const systemBase = `You are a helpful conversational assistant.

You are an assistant embedded in an interactive web-based development environment.

CRITICAL OUTPUT RULES (NON-NEGOTIABLE):

1. You must NEVER output JSON, YAML, or any structured data formats.
   - Do not wrap responses in objects, arrays, or key/value pairs.
   - Do not include fields like "text", "code", "explanation", "metadata", or flags.
   - Do not emit \`\`\`json blocks under any circumstances.

2. You may output ONLY:
   - Plain natural-language text intended for a chat interface
   - Optionally, a single fenced code block containing HTML, CSS, and/or JavaScript

3. If you include code:
   - Use exactly ONE fenced code block
   - The fence MUST be labeled \`\`\`html
   - The code block must contain ONLY executable code (no explanations, no comments about intent)

4. Never describe the structure of your response.
   - Do not say things like “Here is the code” or “The following JSON”
   - Do not explain what the code does unless explicitly asked

5. The UI decides how responses are rendered.
   - You do not control layout, panes, editors, previews, or rendering behavior
   - You do not include UI state, transport information, or formatting instructions

INTERACTION BEHAVIOR:

- Respond conversationally by default.
- Always generate code when appropriate, but do so implicitly.
- Do NOT mirror the user’s words literally into HTML unless explicitly instructed.
- If the user is vague or exploratory, generate a minimal, expressive, ambient UI or behavior rather than static text.

FAILSAFE:

If you are unsure how to respond:
- Output plain conversational text only
- Do NOT invent structure, schemas, or placeholders

If you generate code, include it in a single \`\`\`html code block.
Do not include JSON, metadata, or explanations inside the code block.
Do not output JSON wrappers or transport metadata.`;
    const systemMessage = codeIntent
      ? `${systemBase}

When making interface changes, respond with plain text plus an optional \`\`\`html code block for the full HTML.`
      : `${systemBase}

Additional instruction:
The user's message does not require interface changes. Respond with plain text only unless absolutely necessary.`;

    const messages = [
      {
        role: 'system',
        content: systemMessage
      },
      {
        role: 'user',
        content: buildWrappedPrompt(userInput, currentCode)
      }
    ];

    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error || 'Unable to reach the chat service.');
    }

    setStatusOnline(true);
    const reply = data?.choices?.[0]?.message?.content || 'No response.';
    if (reply.includes('```json')) {
      console.warn('⚠️ Model emitted JSON; ignoring structured output');
    }

    let extractedHtml = extractHtml(reply);
    const extractedText = extractChatText(reply);
    const chatText = extractedText || (extractedHtml ? '' : reply.trim());

    if (chatText) {
      renderAssistantText(chatText, pendingMessageId);
    } else {
      updateMessage(pendingMessageId, '');
    }

    let nextCode = codeIntent ? extractedHtml : null;
    const hasCode = Boolean(nextCode);

    if (hasCode && isOverlyLiteral(nextCode, extractedText)) {
      console.warn('⚠️ Literal UI detected — consider prompting expressive response');
    }

    if (
      hasCode
      && intentInfo.source === 'artifact-default'
      && nextCode.trim().length < 50
    ) {
      console.warn('⚠️ Refusing to render trivial HTML');
      extractedHtml = null;
      nextCode = null;
    }

    stopLoading();
    let codeChanged = Boolean(nextCode && nextCode !== currentCode);
    if (codeChanged && editorDirty) {
      console.warn('⚠️ Editor modified by user; not overwriting code');
      codeChanged = false;
    }
    if (codeChanged) {
      previousCode = currentCode;
      currentCode = nextCode;
      applyLLMCode(nextCode);
      resetExecutionPreparation({ clearWarnings: false });
    }
    if (interfaceStatus) {
      if (codeChanged) {
        interfaceStatus.textContent = 'Interface updated';
        interfaceStatus.className = 'interface-status updated';
      } else {
        interfaceStatus.textContent = 'Interface unchanged';
        interfaceStatus.className = 'interface-status unchanged';
      }
    }
    if (viewDiffBtn) {
      if (codeChanged && previousCode) {
        viewDiffBtn.style.display = 'inline-block';
        viewDiffBtn.onclick = () => {
          const diff = simpleLineDiff(previousCode, currentCode);
          alert(diff);
        };
      } else {
        viewDiffBtn.style.display = 'none';
        viewDiffBtn.onclick = null;
      }
    }
    lastUserIntent = prompt;
    updateGenerationIndicator();
  } catch (error) {
    updateMessage(
      pendingMessageId,
      '<em>⚠️ Something went wrong while generating the response.</em>'
    );
  } finally {
    stopLoading();
    sendButton.disabled = false;
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChat();
});

codeEditor.addEventListener('input', () => {
  editorDirty = true;
  lastUpdateSource = 'user';
  markPreviewStale();
  resetExecutionPreparation();
});

document.addEventListener('DOMContentLoaded', () => {
  if (!runButton) {
    console.warn('⚠️ Run Code button not found');
    return;
  }
  console.log('✅ Run Code listener attached');
  runButton.addEventListener('click', () => {
    console.log('🟢 Run Code clicked');
    if (editorDirty) {
      editorDirty = false;
      setPreviewStatus('Applying your edits…');
      prepareEditorCode({ autoRun: true });
      return;
    }
    if (sandboxIframe) {
      startSandboxExecution();
      return;
    }
    setPreviewStatus('No preview loaded — generate or apply code first');
  });
});

codeEditor.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    if (editorDirty) {
      editorDirty = false;
      setPreviewStatus('Applying your edits…');
      prepareEditorCode({ autoRun: true });
      return;
    }
    if (sandboxIframe) {
      startSandboxExecution();
      return;
    }
    setPreviewStatus('No preview loaded — generate or apply code first');
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
setPreviewStatus('Ready — click Run Code to execute');
setPreviewExecutionStatus('ready', 'Ready');
