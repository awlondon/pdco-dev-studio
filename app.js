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
const BACKEND_URL =
  "https://text-code.primarydesigncompany.workers.dev";

const defaultInterfaceCode = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Maya Interface</title>
<style>
  body {
    margin: 0;
    height: 100vh;
    background: radial-gradient(circle at center, #1f2937, #020617);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, sans-serif;
    color: white;
    overflow: hidden;
  }

  #gesture {
    font-size: 64px;
    cursor: pointer;
    transition: transform 0.3s ease;
  }

  #gesture.wave {
    animation: wave 0.8s ease-in-out;
  }

  @keyframes wave {
    0% { transform: rotate(0deg); }
    25% { transform: rotate(20deg); }
    50% { transform: rotate(-15deg); }
    75% { transform: rotate(15deg); }
    100% { transform: rotate(0deg); }
  }
</style>
</head>
<body>
  <div id="gesture">👋</div>

<script>
  const g = document.getElementById("gesture");
  g.onclick = () => {
    g.classList.remove("wave");
    void g.offsetWidth;
    g.classList.add("wave");
  };
</script>
</body>
</html>`;

codeEditor.value = defaultInterfaceCode;
let currentCode = defaultInterfaceCode;
let previousCode = null;
let lastUserIntent = null;
let loadingStartTime = null;
let loadingInterval = null;

function setStatusOnline(isOnline) {
  statusLabel.textContent = isOnline ? 'API online' : 'Offline';
  statusLabel.classList.toggle('online', isOnline);
}

function appendMessage(role, content, options = {}) {
  const message = document.createElement('div');
  message.className = `message ${role}${options.className ? ` ${options.className}` : ''}`;
  message.textContent = content;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function renderAssistantText(text) {
  const match = text.match(/^(.*?)(\s*\([^)]*\))$/);
  if (!match) {
    appendMessage('assistant', text);
    return;
  }

  const [, main, aside] = match;
  const mainText = main.trim();
  const asideText = aside.trim();

  if (mainText) {
    appendMessage('assistant', mainText);
  }
  appendMessage('assistant', asideText, { className: 'assistant-aside' });
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
    return `
User message:
${userInput}
`;
  }

  return `
Current interface (may be reused unchanged):
${currentCode}

User message:
${userInput}
`;
}

function runGeneratedCode(code) {
  if (!previewFrame) {
    return;
  }
  outputPanel?.classList.add('loading');
  setTimeout(() => {
    previewFrame.srcdoc = injectEscListener(code);
    outputPanel?.classList.remove('loading');
  }, 150);
}

function ensureFullHtmlDoc(html) {
  const hasHtml = /<html[\\s>]/i.test(html);
  const hasBody = /<body[\\s>]/i.test(html);

  if (hasHtml && hasBody) {
    return html;
  }

  return `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
${html}
</body>
</html>`;
}

function injectEscListener(rawHtml) {
  const html = ensureFullHtmlDoc(rawHtml);
  const escScript = `
<script>
  (function () {
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.body.insertAdjacentHTML('afterbegin','<div style="position:fixed;top:8px;left:8px;z-index:99999;background:#ff0;padding:6px">ESC DETECTED</div>');
        window.parent.postMessage({ type: 'exit-fullscreen' }, '*');
      }
    }, true);
  })();
</script>
`;
  return html.replace(/<\/body>/i, `${escScript}\n</body>`);
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
  const prompt = chatInput.value.trim();
  if (!prompt) {
    return;
  }

  chatInput.value = '';
  appendMessage('user', prompt);

  const assistantBubble = appendMessage('assistant', '');

  sendButton.disabled = true;
  setStatusOnline(false);
  startLoading();

  try {
    const messages = [
      {
        role: 'system',
        content: `You are a conversational partner who maintains a living, expressive interface.

CRITICAL OUTPUT RULE:
- You MUST return a single valid JSON object.
- Do NOT include any text outside the JSON.
- Do NOT use markdown.
- Do NOT include comments.
- The response must be parseable by JSON.parse().

Schema:
{
  "text": "A natural, human conversational response.",
  "code": "A complete, self-contained HTML/CSS/JS document."
}

Behavior rules:
- Respond naturally and conversationally in the "text" field.
- Always include the "code" field.
- Always return a complete HTML/CSS/JS document by modifying or extending the existing interface.
- Treat the existing interface as a living, expressive body.
- Prefer modifying behavior, motion, or interaction over replacing the interface.
- Do NOT simply render user text unless explicitly asked.
- The interface is an expressive gesture, not a transcript.
- Static text-only interfaces should be avoided unless necessary.
- Do NOT explain the code unless the user explicitly asks.
- If you mention interface changes without being asked, keep it brief and parenthetical.
- The interface may remain unchanged if no update is needed.`
      },
      {
        role: 'user',
        content: buildWrappedPrompt(prompt, currentCode)
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
      assistantBubble.remove();
      appendMessage('assistant', reply.trim());
      if (interfaceStatus) {
        interfaceStatus.textContent = 'Interface unchanged';
        interfaceStatus.className = 'interface-status unchanged';
      }
      return;
    }

    if (!parsed.text || !parsed.code) {
      assistantBubble.remove();
      appendMessage('assistant', '⚠️ Response missing required fields.');
      return;
    }

    if (isOverlyLiteral(parsed.code, parsed.text)) {
      console.warn('⚠️ Literal UI detected — consider prompting expressive response');
    }

    assistantBubble.remove();
    renderAssistantText(parsed.text);
    const nextCode = parsed.code;
    const codeChanged = Boolean(nextCode && nextCode !== currentCode);
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
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    appendMessage('system', message);
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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && consolePane.classList.contains('preview-fullscreen')) {
      exitFullscreen();
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== previewFrame?.contentWindow) {
      return;
    }

    if (event.data && event.data.type === 'exit-fullscreen') {
      if (consolePane.classList.contains('preview-fullscreen')) {
        exitFullscreen();
      }
    }
  });
}

setStatusOnline(false);
updateGenerationIndicator();
runGeneratedCode(currentCode);
