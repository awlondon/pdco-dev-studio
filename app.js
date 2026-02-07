const DEBUG_INTENT = true; // flip to false to silence intent logs
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('btn-send');
const codeEditor = document.getElementById('code-editor');
const consoleLog = document.getElementById('console-output-log');
const consolePane = document.getElementById('consoleOutput');
const previewFrame = document.getElementById('previewFrame');
const statusLabel = document.getElementById('status-label');
const generationIndicator = document.getElementById('generation-indicator');
const splitter = document.getElementById('splitter');
const rightPane = document.getElementById('right-pane');
const codePanel = document.getElementById('code-panel');
const outputPanel = document.getElementById('output-panel');
const fullscreenToggle = document.getElementById('fullscreenToggle');
const interfaceStatus = document.getElementById('interfaceStatus');
const viewDiffBtn = document.getElementById('viewDiffBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const codeIntentBadge = document.getElementById('codeIntentBadge');
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

function buildWrappedPrompt(userInput, currentCode) {
  if (!currentCode) {
    return userInput;
  }

  return `Current code:\n${currentCode}\n\nUser: ${userInput}`;
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

function runGeneratedCode(code) {
  if (!previewFrame) {
    return;
  }
  outputPanel?.classList.add('loading');
  setTimeout(() => {
    renderToIframe(code);
    outputPanel?.classList.remove('loading');
  }, 150);
}

function renderToIframe(html) {
  if (!previewFrame) {
    return;
  }

  const nonce = Date.now();
  const wrappedHtml = `<!-- generation:${nonce} -->\n${html}`;

  previewFrame.srcdoc = '<!doctype html><html><body></body></html>';
  requestAnimationFrame(() => {
    previewFrame.srcdoc = wrappedHtml;
  });
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

You must return a single valid JSON object.
No text outside JSON.

Schema:
{
  "text": "Normal conversational response.",
  "code": "Complete HTML/CSS/JS document.",
  "code_unchanged": true | false
}

Rules:
- Always include all fields.
- Code may remain unchanged.
- Do not explain code unless asked.
- Prefer minimal output.
- If no code changes are needed, set "code_unchanged": true and repeat the previous code verbatim.`;
    const systemMessage = codeIntent
      ? systemBase
      : `${systemBase}

Additional instruction:
The user's message does not require interface changes. Do not modify the code unless absolutely necessary.`;

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
    let parsed;
    try {
      parsed = JSON.parse(reply);
    } catch {
      updateMessage(pendingMessageId, formatAssistantHtml(reply.trim()));
      if (interfaceStatus) {
        interfaceStatus.textContent = 'Interface unchanged';
        interfaceStatus.className = 'interface-status unchanged';
      }
      return;
    }

    if (!parsed.text || !parsed.code || typeof parsed.code_unchanged !== 'boolean') {
      updateMessage(pendingMessageId, '⚠️ Response missing required fields.');
      return;
    }

    if (!codeIntent) {
      parsed.code = currentCode;
      parsed.code_unchanged = true;
    }

    if (isOverlyLiteral(parsed.code, parsed.text)) {
      console.warn('⚠️ Literal UI detected — consider prompting expressive response');
    }

    if (
      codeIntent
      && intentInfo.source === 'artifact-default'
      && parsed.code.trim().length < 50
    ) {
      console.warn('⚠️ Refusing to render trivial HTML');
      parsed.code = currentCode;
      parsed.code_unchanged = true;
    }

    renderAssistantText(parsed.text, pendingMessageId);
    stopLoading();
    const codeUnchanged = parsed.code_unchanged === true;
    const nextCode = parsed.code;
    const codeChanged = !codeUnchanged && Boolean(nextCode && nextCode !== currentCode);
    if (codeChanged) {
      previousCode = currentCode;
      currentCode = nextCode;
      codeEditor.value = nextCode;
      runGeneratedCode(nextCode);
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
runGeneratedCode(currentCode);
