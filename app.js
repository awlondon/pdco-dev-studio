const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('btn-send');
const codeEditor = document.getElementById('code-editor');
const consoleOutput = document.getElementById('console-output');
const previewFrame = document.getElementById('preview-frame');
const statusLabel = document.getElementById('status-label');
const generationIndicator = document.getElementById('generation-indicator');
const splitter = document.getElementById('splitter');
const rightPane = document.getElementById('right-pane');
const codePanel = document.getElementById('code-panel');
const outputPanel = document.getElementById('output-panel');
const fullscreenToggle = document.getElementById('fullscreenToggle');
const BACKEND_URL =
  "https://text-code.primarydesigncompany.workers.dev";

codeEditor.value = `// Write JavaScript here to experiment with the editor.\n\nconst greeting = "Hello from Maya Dev UI";\nconsole.log(greeting);\n\n(() => greeting.toUpperCase())();`;
let currentCode = null;
let lastUserIntent = null;

function setStatusOnline(isOnline) {
  statusLabel.textContent = isOnline ? 'API online' : 'Offline';
  statusLabel.classList.toggle('online', isOnline);
}

function appendMessage(role, content) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.textContent = content;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function appendOutput(content, variant = 'success') {
  const line = document.createElement('div');
  line.className = `output-line ${variant}`;
  line.textContent = content;
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function handleConsoleLog(...args) {
  appendOutput(args.map((item) => String(item)).join(' '), 'success');
}

function buildWrappedPrompt(userInput, currentCode) {
  if (!currentCode) {
    return `
Return JSON ONLY.

Schema:
{
  "text": "Explanation of what you built",
  "code": "Complete self-contained HTML/CSS/JS"
}

Rules:
- No markdown
- Inline CSS and JS only
- Code must run in a browser
- Do not escape HTML

User request:
${userInput}
`;
  }

  return `
You are modifying an existing working interface.

Return JSON ONLY.

Schema:
{
  "text": "Explanation of the changes you made",
  "code": "Updated full HTML/CSS/JS (not a diff)"
}

Rules:
- Preserve existing functionality unless explicitly changed
- Modify the code below to satisfy the new request
- Return the FULL updated document
- No markdown
- No commentary outside JSON

Current code:
${currentCode}

User change request:
${userInput}
`;
}

function runGeneratedCode(code) {
  if (!previewFrame) {
    return;
  }
  outputPanel?.classList.add('loading');
  setTimeout(() => {
    previewFrame.srcdoc = code;
    outputPanel?.classList.remove('loading');
  }, 150);
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

  try {
    const messages = [
      {
        role: 'system',
        content: 'You generate and modify interactive web interfaces.'
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
      appendMessage('assistant', '⚠️ Model returned invalid JSON.');
      return;
    }

    if (!parsed.text || !parsed.code) {
      assistantBubble.remove();
      appendMessage('assistant', '⚠️ Response missing required fields.');
      return;
    }

    assistantBubble.textContent = parsed.text;
    chatMessages.scrollTop = chatMessages.scrollHeight;
    currentCode = parsed.code;
    codeEditor.value = parsed.code;
    runGeneratedCode(parsed.code);
    lastUserIntent = prompt;
    updateGenerationIndicator();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    appendMessage('system', message);
  } finally {
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

if (fullscreenToggle && outputPanel) {
  fullscreenToggle.addEventListener('click', () => {
    outputPanel.classList.toggle('preview-fullscreen');
    fullscreenToggle.textContent = outputPanel.classList.contains('preview-fullscreen')
      ? '⤡ Exit'
      : '⤢ Fullscreen';
  });
}

setStatusOnline(false);
updateGenerationIndicator();
