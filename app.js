const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('btn-send');
const codeEditor = document.getElementById('code-editor');
const runButton = document.getElementById('btn-run');
const consoleOutput = document.getElementById('console-output');
const previewFrame = document.getElementById('preview-frame');
const statusLabel = document.getElementById('status-label');
const BACKEND_URL =
  "https://text-code.primarydesigncompany.workers.dev";

codeEditor.value = `// Write JavaScript here and click Run Code.\n\nconst greeting = "Hello from Maya Dev UI";\nconsole.log(greeting);\n\n(() => greeting.toUpperCase())();`;

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

function buildWrappedPrompt(userInput) {
  return `
Return JSON ONLY. No markdown. No commentary.

Schema:
{
  "text": "Plain-language explanation for the user",
  "code": "Complete self-contained HTML/CSS/JS runnable in a browser"
}

Rules:
- "code" must be executable as-is
- No external libraries
- Inline CSS and JS only
- Do not escape HTML

User request:
${userInput}
`;
}

function runGeneratedCode(code) {
  if (!previewFrame) {
    return;
  }
  previewFrame.srcdoc = code;
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
        content: 'You generate interactive UI code and explanations.'
      },
      {
        role: 'user',
        content: buildWrappedPrompt(prompt)
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
      assistantBubble.textContent = reply;
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    if (parsed.text) {
      assistantBubble.textContent = parsed.text;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    } else {
      assistantBubble.remove();
    }

    if (parsed.code) {
      codeEditor.value = parsed.code;
      runGeneratedCode(parsed.code);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    appendMessage('system', message);
  } finally {
    sendButton.disabled = false;
  }
}

function runCode() {
  consoleOutput.innerHTML = '';
  const originalConsoleLog = console.log;
  console.log = handleConsoleLog;

  try {
    const result = eval(codeEditor.value);
    if (result !== undefined) {
      appendOutput(String(result), 'success');
    } else {
      appendOutput('Code executed (no return value).', 'success');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    appendOutput(`Error: ${message}`, 'error');
  } finally {
    console.log = originalConsoleLog;
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChat();
});

runButton.addEventListener('click', runCode);

setStatusOnline(false);
