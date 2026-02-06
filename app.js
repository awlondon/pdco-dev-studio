const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('btn-send');
const codeEditor = document.getElementById('code-editor');
const runButton = document.getElementById('btn-run');
const consoleOutput = document.getElementById('console-output');
const statusLabel = document.getElementById('status-label');
const chatHistory = [];
const apiEndpoint = 'https://your-project-name.vercel.app/api/chat';

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

async function sendChat() {
  const prompt = chatInput.value.trim();
  if (!prompt) {
    return;
  }

  chatInput.value = '';
  const userMessage = { role: 'user', content: prompt };
  chatHistory.push(userMessage);
  appendMessage('user', prompt);

  const assistantMessage = { role: 'assistant', content: '' };
  chatHistory.push(assistantMessage);
  const assistantBubble = appendMessage('assistant', '');

  sendButton.disabled = true;
  setStatusOnline(false);

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages: chatHistory })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Unable to reach the chat service.');
    }

    setStatusOnline(true);

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || 'No response.';
    assistantMessage.content = reply;
    assistantBubble.textContent = reply;
    chatMessages.scrollTop = chatMessages.scrollHeight;
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
