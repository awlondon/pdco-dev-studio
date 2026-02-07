import { createSandboxController } from './sandboxController.js';

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('btn-send');
const codeEditor = document.getElementById('code-editor');
const consoleLog = document.getElementById('console-output-log');
const consolePane = document.getElementById('consoleOutput');
const sandboxFrame = document.getElementById('sandbox');
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
const chatState = {
  locked: false,
  unlockTimerId: null
};

const sandbox = createSandboxController({
  iframe: sandboxFrame,
  statusEl: sandboxStatus,
  maxFiniteMs: SANDBOX_TIMEOUT_MS
});

function setStatusOnline(isOnline) {
  statusLabel.textContent = isOnline ? 'API online' : 'Offline';
  statusLabel.classList.toggle('online', isOnline);
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

function renderAssistantText(text, messageId) {
  if (messageId) {
    updateMessage(messageId, formatAssistantHtml(text));
    return;
  }

  appendMessage('assistant', text);
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
    return `
Return JSON ONLY with this schema:
{
  "text": "...",
  "code": "..."
}

User message:
${userInput}
`;
  }

  return `
You are continuing an ongoing interaction.

Return JSON ONLY with this schema:
{
  "text": "...",
  "code": "..."
}

Current interface (may be reused unchanged):
${currentCode}

User message:
${userInput}
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

function handleLLMOutput(code, source = 'generated') {
  setStatus('COMPILING');

  const analysis = updateExecutionWarningsFor(code);
  sandboxMode = getSandboxModeForExecution(analysis.executionProfile);
  lastRunCode = code;
  lastRunSource = source;
  if (!sandboxFrame) {
    appendOutput('Sandbox iframe missing.', 'error');
    return;
  }

  outputPanel?.classList.add('loading');
  setSandboxControlsVisible(sandboxMode === 'animation');
  setSandboxAnimationState('running');
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
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  setPreviewStatus('Preview updated by assistant');
  handleLLMOutput(code, 'generated');
}

function handleUserRun(code, source = 'user', statusMessage = 'Applying your edits…') {
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

  lockChat();
  chatInput.value = '';
  appendMessage('user', userInput);

  const pendingMessageId = addMessage(
    'assistant',
    '<em>Generating text + code…</em>',
    { pending: true }
  );

  setStatusOnline(false);
  startLoading();

  try {
    const llmStartTime = performance.now();
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
   - When code is generated, include a brief natural-language response suitable for chat display.

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

COOPERATIVE ANIMATION (REQUIRED):
When intent implies movement, animation, simulation, random patterns, or competitors, include a cooperative loop scaffold by default:
- Use requestAnimationFrame with a frame budget and time budget (default).
- Alternative: setInterval stepping when smoothness is not critical.
- Optional: start/stop hooks for user-controlled runs.
Treat sandbox limits as expected; stop cleanly without errors.
If a task describes an ongoing or convergent simulation, generate a sandbox-bounded demonstration with a clear summary at termination instead of an unbounded process.

SANDBOX REWRITE HEURISTIC (EXACT):
Purpose
Ensure all LLM-generated code executes safely, predictably, and informatively inside a bounded sandbox, even when the user requests open-ended or convergent behavior.

Phase 0 — Classification
Before generating code, the model must classify the request:
Detect Unbounded Intent if the prompt contains ANY of:
Temporal infinity
"continue", "keeps going", "forever", "always"
Convergence / completion language
"until", "eventually", "last remaining", "winner", "only one"
Emergent system dynamics
"simulation", "ecosystem", "agents", "competition", "autonomous"
Animation primitives without limits
requestAnimationFrame, setInterval, game loops, physics loops
If any of the above are present → Unbounded Intent = TRUE

Phase 1 — Mandatory Rewrite
If Unbounded Intent === TRUE, the model MUST rewrite the task internally using the following transformation.
Rewrite Rule (non-optional)
Convert the task from a goal-seeking simulation into a bounded demonstration that:
Preserves the behavioral intent
Executes within fixed sandbox limits
Produces a meaningful partial result
The rewrite is internal.
The user-facing output does not mention rewriting.

Phase 2 — Bounded Demonstration Specification
The generated code MUST include all of the following.
A. Explicit Sandbox Budget
At least one hard stop:
const MAX_FRAMES = 300;        // or derived from sandbox
const MAX_TIME_MS = 5000;     // optional secondary cap
And checked every frame:
if (SANDBOX.shouldStop() || frameCount >= MAX_FRAMES) {
  endDemo();
  return;
}
Event-only termination is forbidden.
B. Degraded Goal Semantics
If the original prompt said:
“until only one remains”
“find the winner”
“keep eliminating”
The rewritten meaning becomes:
“Demonstrate the process toward that goal for the duration of the sandbox budget.”
The model must not attempt guaranteed convergence.
C. Mandatory End-of-Demo Summary
When the sandbox stops (for any reason), the code MUST emit a summary.
At least one of:
Remaining agent count
Current leader(s)
Top-N by score / size / captures
Time elapsed
Frames executed
Example:
function endDemo() {
  ctx.fillStyle = "#fff";
  ctx.font = "16px monospace";
  ctx.fillText(
    \`Demo ended • \${alive.length} agents remain\`,
    20, 30
  );
}
Timeouts must surface as information, not failure.

Phase 3 — Animation Loop Contract
All animation loops MUST obey:
function loop() {
  frameCount++;
  update();
  draw();
  if (SANDBOX.shouldStop() || frameCount >= MAX_FRAMES) {
    endDemo();
    return;
  }
  requestAnimationFrame(loop);
}
Forbidden patterns:
while(true)
setInterval without clearing
RAF without a stop condition
Waiting for convergence before exit

Phase 4 — User-Visible Behavior Guarantee
The resulting behavior must satisfy:
Aspect	Guarantee
Safety	Never hangs the sandbox
Fidelity	Shows the requested behavior
Honesty	Does not claim completion if not reached
Feedback	Always reports a final state

One-Line System Prompt Version
If you want the ultra-compact version to paste directly into a system prompt:
“If a request implies an unbounded or convergent simulation, rewrite it internally as a sandbox-bounded demonstration with explicit frame/time limits and a final state summary, never an event-only termination.”

SANDBOX ANIMATION CONTRACT (AUTO-INJECTED, REQUIRED):
- Every animation/simulation must be finite by default with explicit INIT → RUN → YIELD → STOP phases.
- Demonstration Mode (default): bounded, shows behavior, stops gracefully, reports partial results.
- Simulation Mode (opt-in only): goal-seeking, potentially unbounded, requires explicit user consent and must expose pause/resume/step controls.
- Demonstration Downgrade Rule (critical): if the prompt specifies a condition that may not converge within the sandbox time or frame budget, reinterpret the request as a bounded demonstration, not a full simulation.
- Goal Completion Rule: if the prompt includes any of: "until", "only one remains", "eventually", "keeps going", "continues until", "winner", "last remaining", then BOTH are mandatory:
  - A sandbox-bounded stopping condition.
  - A partial-state summary at stop time.
- Hard caps: const SANDBOX_TIME_LIMIT_MS = 4500; const SANDBOX_FRAME_LIMIT = 300; let frameCount = 0; const startTime = performance.now();
- Cooperative guard:
  function shouldStop() {
    return (
      frameCount >= SANDBOX_FRAME_LIMIT ||
      performance.now() - startTime >= SANDBOX_TIME_LIMIT_MS
    );
  }
- Loop must exit cleanly when shouldStop() is true; no unbounded RAF, while(true), recursion, or setInterval without a stop.
- Mandatory bounded termination: every animation must include one of:
  // A) Time bounded
  if (SANDBOX.shouldStop()) endDemo();
  // B) Frame bounded
  if (frameCount >= MAX_FRAMES) endDemo();
  // C) Event bounded + fallback
  if (winnerFound || SANDBOX.shouldStop()) endDemo();
  Never event-only.
- Mandatory finalizer function:
  function finalize(reason) { ... }
  - reason must be one of: "frame-limit", "time-limit", "sandbox-stop", "user-reset"
  - finalize must be idempotent, must not schedule new animation, and must render a static summary.
- Stop-aware loop pattern example:
  function loop() {
    frameCount++;
    update();
    draw();
    if (frameCount >= MAX_FRAMES) {
      finalize("frame-limit");
      return;
    }
    requestAnimationFrame(loop);
  }
- Mandatory end-of-demo report: at termination, summarize state (examples: “42 turtles remain”, “Current largest turtle is #17”, “Top 3 colors by size: …”, “Simulation stopped early due to sandbox limit”).
- Auto-inject this scaffold when animation intent is detected (do not explain unless asked):
  const SANDBOX = {
    maxFrames: 300,
    maxTimeMs: 4500,
    frame: 0,
    start: performance.now(),
    shouldStop() {
      return (
        this.frame >= this.maxFrames ||
        performance.now() - this.start >= this.maxTimeMs
      );
    }
  };
  // inside loop: SANDBOX.frame++;
- If user asks for reset/run again/game/simulation/continuous, expose window.resetSimulation and window.startSimulation while honoring caps.
- If the sandbox stops before finalize runs, ensure the last rendered frame already contains enough information to stand alone.

If you generate code, include it in a single \`\`\`html code block.
Do not include JSON, metadata, or explanations inside the code block.
Do not output JSON wrappers or transport metadata.`;
    const systemMessage = `${systemBase}

When making interface changes, respond with plain text plus an optional \`\`\`html code block for the full HTML.`;

    const messages = [
      {
        role: 'system',
        content: `You are an interactive interface designer.

You always maintain a working executable web interface as part of your response.

Rules:
- You MUST always return a valid HTML/CSS/JS document.
- You MAY choose to leave the interface unchanged if the user’s message does not require modification.
- You SHOULD modify the interface when it meaningfully improves clarity, usability, or embodiment of the conversation.
- Do NOT describe code unless the user explicitly asks about implementation.
- Treat the interface as the primary artifact, and text as supporting explanation.`
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
    const llmEndTime = performance.now();
    const generationMetadata = formatGenerationMetadata(llmEndTime - llmStartTime);

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

    const nextCode = extractedHtml;
    const hasCode = Boolean(nextCode);

    if (chatText) {
      renderAssistantText(`${chatText}\n\n${generationMetadata}`, pendingMessageId);
    } else {
      renderAssistantText(generationMetadata, pendingMessageId);
      if (hasCode) {
        setPreviewStatus('Running interactive scene…');
      }
    }

    unlockChat();
    if (hasCode && nextCode !== currentCode) {
      currentCode = nextCode;
      setCodeFromLLM(nextCode);
    }
    updateGenerationIndicator();
  } catch (error) {
    updateMessage(
      pendingMessageId,
      '<em>⚠️ Something went wrong while generating the response.</em>'
    );
    unlockChat();
  } finally {
    stopLoading();
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChat();
});

codeEditor.addEventListener('input', () => {
  const hasEdits = codeEditor.value !== baselineCode;
  userHasEditedCode = hasEdits;
  updateRunButtonVisibility();
  updateRollbackVisibility();
  updatePromoteVisibility();
  if (hasEdits) {
    markPreviewStale();
  }
  resetExecutionPreparation();
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
    if (!userHasEditedCode) {
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
    codeEditor.value = lastLLMCode;
    baselineCode = lastLLMCode;
    updateRunButtonVisibility();
    updateRollbackVisibility();
    updatePromoteVisibility();
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
    if (!userHasEditedCode) {
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
