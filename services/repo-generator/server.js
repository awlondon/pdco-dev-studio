import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { plannerAgent, coderAgent, verifierAgent } from './agents.js';
import { evaluatePolicy, buildPolicyConfig } from './policy.js';

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.json({ limit: '1mb' }));

let clients = [];

wss.on('connection', (ws) => {
  clients.push(ws);
  ws.on('close', () => {
    clients = clients.filter((client) => client !== ws);
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

const REQUIRED_ENV = ['GITHUB_TOKEN', 'GITHUB_OWNER'];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missingEnv.length) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}

const OWNER = process.env.GITHUB_OWNER;
const TOKEN = process.env.GITHUB_TOKEN;
const PORT = Number(process.env.PORT || 3000);
const API_URL = 'https://api.github.com';
const policyConfig = buildPolicyConfig();

function slugifyRepoName(s) {
  return (
    String(s || 'openclaw-project')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'openclaw-project'
  );
}

function taskToBranch(taskId) {
  const clean = String(taskId || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
  return `feature/${clean}`;
}

function buildTaskPatchFiles(objective, task) {
  const taskMdPath = `tasks/${task.id}.md`;
  const taskMd = `# ${task.id}\n\n${task.description}\n\nObjective:\n- ${objective}\n`;
  const readmePatch = `\n- [${task.id}](tasks/${task.id}.md): ${task.description}`;

  return {
    files: [{ path: taskMdPath, content: taskMd, message: `Add ${task.id} task doc` }],
    readmeAppend: readmePatch,
  };
}

async function githubRequest(method, endpoint, body) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'repo-generator-service',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API ${method} ${endpoint} failed (${response.status}): ${errorText}`);
  }

  if (response.status === 204) return {};
  return response.json();
}

async function getBranchHeadSha(repo, branch) {
  const ref = await githubRequest('GET', `/repos/${OWNER}/${repo}/git/ref/heads/${branch}`);
  return ref.object.sha;
}

async function ensureBranchFrom(repo, baseBranch, newBranch) {
  try {
    await githubRequest('GET', `/repos/${OWNER}/${repo}/git/ref/heads/${newBranch}`);
    return;
  } catch (_error) {
    const baseSha = await getBranchHeadSha(repo, baseBranch);
    await githubRequest('POST', `/repos/${OWNER}/${repo}/git/refs`, {
      ref: `refs/heads/${newBranch}`,
      sha: baseSha,
    });
  }
}

async function getFileContent(repo, branch, filePath) {
  try {
    const file = await githubRequest('GET', `/repos/${OWNER}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
    return file;
  } catch (_error) {
    return null;
  }
}

async function upsertFileOnBranch(repo, branch, filePath, content, message) {
  const existing = await getFileContent(repo, branch, filePath);
  const encoded = Buffer.from(content, 'utf8').toString('base64');

  await githubRequest('PUT', `/repos/${OWNER}/${repo}/contents/${filePath}`, {
    message,
    content: encoded,
    sha: existing?.sha,
    branch,
  });
}

async function appendToReadme(repo, branch, appendText) {
  let current = '';
  const existing = await getFileContent(repo, branch, 'README.md');

  if (existing?.content) {
    current = Buffer.from(existing.content, 'base64').toString('utf8');
  } else {
    current = `# ${repo}\n\n## Task Links\n`;
  }

  if (!current.includes(appendText.trim())) {
    current = `${current.trimEnd()}\n${appendText.trim()}\n`;
  }

  await upsertFileOnBranch(repo, branch, 'README.md', current, 'Update README task links');
}

async function openPullRequest(repo, headBranch, baseBranch, title, body) {
  const existing = await githubRequest(
    'GET',
    `/repos/${OWNER}/${repo}/pulls?state=open&head=${encodeURIComponent(`${OWNER}:${headBranch}`)}&base=${encodeURIComponent(baseBranch)}&per_page=50`,
  );

  if (Array.isArray(existing) && existing.length > 0) {
    return existing[0];
  }

  return githubRequest('POST', `/repos/${OWNER}/${repo}/pulls`, {
    head: headBranch,
    base: baseBranch,
    title,
    body,
  });
}

async function tryAutoMerge(repo, prNumber) {
  await githubRequest('PUT', `/repos/${OWNER}/${repo}/pulls/${prNumber}/merge`, {
    merge_method: 'squash',
  });
}

async function protectMainBranch(repo) {
  await githubRequest('PUT', `/repos/${OWNER}/${repo}/branches/main/protection`, {
    required_status_checks: {
      strict: true,
      contexts: ['build'],
    },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    required_linear_history: false,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: false,
    lock_branch: false,
    allow_fork_syncing: false,
  });
}

async function waitForGreen(repo, prNumber, maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const pr = await githubRequest('GET', `/repos/${OWNER}/${repo}/pulls/${prNumber}`);
    if (pr.mergeable_state !== 'clean') {
      continue;
    }

    const checkRunsResponse = await githubRequest(
      'GET',
      `/repos/${OWNER}/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`,
    );
    const checkRuns = Array.isArray(checkRunsResponse.check_runs) ? checkRunsResponse.check_runs : [];

    if (checkRuns.length === 0) {
      continue;
    }

    const allGreen = checkRuns.every((check) => check.conclusion === 'success');
    if (allGreen) {
      return true;
    }
  }

  return false;
}

async function mergeIfGreen(repo, prNumber) {
  const canMerge = await waitForGreen(repo, prNumber);
  if (!canMerge) {
    return { merged: false, reason: 'CI not green' };
  }

  await tryAutoMerge(repo, prNumber);
  return { merged: true };
}


function topoSortTasks(tasks) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const byId = new Map(taskList.map((task) => [task.id, task]));
  const inDegree = new Map(taskList.map((task) => [task.id, 0]));
  const adjacency = new Map(taskList.map((task) => [task.id, []]));

  for (const task of taskList) {
    for (const dep of task.dependencies || []) {
      if (!byId.has(dep)) continue;
      inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
      adjacency.get(dep).push(task.id);
    }
  }

  const queue = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    const task = byId.get(id);
    if (task) ordered.push(task);

    for (const nextId of adjacency.get(id) || []) {
      const nextDegree = (inDegree.get(nextId) || 0) - 1;
      inDegree.set(nextId, nextDegree);
      if (nextDegree === 0) queue.push(nextId);
    }
  }

  if (ordered.length !== taskList.length) {
    throw new Error('Task graph has a dependency cycle.');
  }

  return ordered;
}

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenClaw Orchestrator Cockpit</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; margin: 0; padding: 24px; background: #0b1020; color: #d6e0ff; }
    h1, h3 { margin-top: 0; }
    #status { margin-bottom: 12px; color: #7ee7ff; }
    .layout { display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 14px; }
    .panel { border: 1px solid #2d3d70; border-radius: 12px; padding: 12px; background: #111935; }
    .stack { display: grid; gap: 8px; }
    textarea, input[type='text'] { width: 100%; background: #080d1d; border: 1px solid #2d3d70; color: #d6e0ff; border-radius: 8px; padding: 8px; }
    button { background: #2d6cff; color: white; border: 0; border-radius: 8px; padding: 10px 12px; cursor: pointer; }
    .task { border: 1px solid #304070; border-radius: 10px; padding: 10px; background: #0d1631; margin-bottom: 8px; }
    .running { border-color: #00bcd4; box-shadow: 0 0 0 1px #00bcd4 inset; }
    .done { border-color: #17c964; box-shadow: 0 0 0 1px #17c964 inset; }
    .error { border-color: #f31260; box-shadow: 0 0 0 1px #f31260 inset; }
    #log-panel { margin-top: 16px; border: 1px solid #2d3d70; border-radius: 10px; padding: 10px; max-height: 260px; overflow-y: auto; background: #080d1d; }
    #log-panel div { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; margin: 4px 0; }
  </style>
</head>
<body>
  <h1>OpenClaw Execution Cockpit</h1>
  <div id="status">Connecting...</div>
  <div class="layout">
    <div class="panel stack">
      <h3>Objective</h3>
      <input id="intentInput" type="text" value="Build a task-based static docs site" />
      <label>
        <input type="checkbox" id="multiAgentToggle" checked />
        Multi-Agent Mode
      </label>
      <button id="runButton" type="button">Run</button>
    </div>

    <div class="panel stack">
      <h3>JSON Input (basic mode)</h3>
      <textarea id="jsonInput" rows="16">{
  "objective": "Build a task-based static docs site",
  "tasks": [
    { "id": "task-1", "description": "Add homepage", "dependencies": [] }
  ],
  "execution": { "auto_merge": false, "enable_pages": true }
}</textarea>
    </div>

    <div class="panel stack">
      <h3>Tasks</h3>
      <div id="taskList"></div>

      <h3>PR Monitor</h3>
      <div id="prList"></div>

      <h3>Policy</h3>
      <div id="policyPanel"></div>

      <h3>Budget</h3>
      <div id="budgetPanel"></div>
    </div>
  </div>
  <div id="log-panel"></div>

  <script>
    const statusEl = document.getElementById('status');
    const logPanel = document.getElementById('log-panel');
    const runButton = document.getElementById('runButton');

    function renderTasks(tasks) {
      const container = document.getElementById('taskList');
      container.innerHTML = '';

      tasks.forEach((task) => {
        const div = document.createElement('div');
        div.className = 'task';
        div.innerText = task.task_id + ' - ' + task.status;
        container.appendChild(div);
      });
    }

    function renderPRs(tasks) {
      const container = document.getElementById('prList');
      container.innerHTML = '';

      tasks.forEach((task) => {
        if (!task.pr_number) return;

        const div = document.createElement('div');
        div.id = 'pr-' + task.pr_number;
        div.className = 'task';
        div.dataset.sha = task.sha || task.pr_head_sha || '';
        div.innerText = 'PR #' + task.pr_number + ' - Pending';

        container.appendChild(div);
      });
    }

    function renderPolicyBlock(policy) {
      const panel = document.getElementById('policyPanel');
      const div = document.createElement('div');
      div.className = 'task error';

      const reasons = (policy.reasons || []).map((reason) => '<li>' + reason + '</li>').join('');
      div.innerHTML = '<strong>Blocked (' + policy.risk_level + ')</strong><ul>' + reasons + '</ul>';
      panel.appendChild(div);
    }

    function updateBudget(budget) {
      const panel = document.getElementById('budgetPanel');
      panel.innerHTML = 'Tokens: ' + budget.tokens_used + '<br/>API Calls: ' + budget.api_calls;
    }

    async function runTasks() {
      const objective = document.getElementById('intentInput').value;
      const multi = document.getElementById('multiAgentToggle').checked;

      const endpoint = multi ? '/multi-agent-run' : '/generate-repo-with-prs';
      const payload = multi
        ? {
            objective,
            constraints: {
              risk: 'medium',
              budget: { max_tokens: 120000, max_api_calls: 80 },
            },
            execution: { enable_pages: true },
          }
        : JSON.parse(document.getElementById('jsonInput').value);

      const response = await fetch('http://localhost:3000' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      renderTasks(data.tasks || []);
      renderPRs(data.tasks || []);

      document.getElementById('policyPanel').innerHTML = '';
      (data.tasks || []).forEach((task) => {
        if (task.status === 'blocked_by_policy' && task.policy) {
          renderPolicyBlock(task.policy);
        }
      });

      if (data.budget) {
        updateBudget(data.budget);
      } else {
        const taskBudgets = (data.tasks || []).map((task) => task.policy && task.policy.budget).filter(Boolean);
        if (taskBudgets.length) {
          const total = taskBudgets.reduce(
            (acc, budget) => ({
              tokens_used: acc.tokens_used + (budget.tokens_used || 0),
              api_calls: acc.api_calls + (budget.api_calls || 0),
            }),
            { tokens_used: 0, api_calls: 0 },
          );
          updateBudget(total);
        }
      }
    }

    runButton.addEventListener('click', runTasks);

    function appendLog(message) {
      const line = document.createElement('div');
      line.textContent = new Date().toISOString() + '  ' + message;
      logPanel.prepend(line);
    }

    function updateCIStatus(data) {
      const el = document.querySelector('[data-sha="' + data.sha + '"]');
      if (!el) return;

      el.classList.remove('running', 'done', 'error');
      if (data.status === 'in_progress') el.classList.add('running');
      if (data.conclusion === 'success') el.classList.add('done');
      if (data.conclusion === 'failure') el.classList.add('error');
      appendLog(data.repo + ' ' + data.status + ' ' + (data.conclusion || ''));
    }

    function updatePRStatus(data) {
      const prEl = document.getElementById('pr-' + data.pr_number);
      if (!prEl) return;

      if (data.merged) {
        prEl.classList.remove('running');
        prEl.classList.add('done');
        prEl.innerText = 'PR #' + data.pr_number + ' - Merged';
      } else {
        prEl.innerText = 'PR #' + data.pr_number + ' - ' + (data.state || 'Open');
      }
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(protocol + '//' + location.host);

    socket.onopen = () => {
      statusEl.textContent = 'Connected to live event stream';
    };

    socket.onclose = () => {
      statusEl.textContent = 'Disconnected';
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'ci_update') updateCIStatus(data);
      if (data.type === 'pr_update') updatePRStatus(data);
    };
  </script>
</body>
</html>`);
});

app.post('/webhook', async (req, res) => {
  const event = req.headers['x-github-event'];

  if (event === 'check_run') {
    const check = req.body.check_run;
    broadcast({
      type: 'ci_update',
      repo: req.body.repository?.name,
      sha: check?.head_sha,
      status: check?.status,
      conclusion: check?.conclusion || null,
    });
  }

  if (event === 'pull_request') {
    const pr = req.body.pull_request;
    broadcast({
      type: 'pr_update',
      repo: req.body.repository?.name,
      pr_number: pr?.number,
      sha: pr?.head?.sha,
      state: pr?.state,
      merged: Boolean(pr?.merged),
    });
  }

  res.sendStatus(200);
});



app.post('/multi-agent-run', async (req, res) => {
  try {
    const { objective, constraints = {}, execution = {} } = req.body;
    if (!objective) {
      return res.status(400).json({ error: 'objective required' });
    }

    const plan = plannerAgent({ objective, constraints });
    const tasks = topoSortTasks(plan?.task_graph?.tasks || []);
    const repo = slugifyRepoName(objective);

    await githubRequest('POST', '/user/repos', {
      name: repo,
      private: false,
      auto_init: true,
      description: objective.slice(0, 140),
    });

    await protectMainBranch(repo);

    const results = [];

    for (const task of tasks) {
      const patch = coderAgent({ objective, task });
      const verdict = verifierAgent({ task, patch });
      const diffSummary = {
        files: (patch.commits || []).flatMap((commit) => (commit.files || []).map((file) => file.path)),
      };
      const budgetTelemetry = {
        tokens_used: execution.tokens_used || 0,
        api_calls: execution.api_calls || 0,
      };
      const policy = evaluatePolicy({
        task,
        verifier: verdict,
        ci: { conclusion: execution.ci_conclusion || 'success' },
        diffSummary,
        budget: budgetTelemetry,
        config: policyConfig,
      });

      if (!policy.allow_merge) {
        results.push({
          task_id: task.id,
          status: 'blocked_by_policy',
          verdict,
          policy,
        });
        continue;
      }

      await ensureBranchFrom(repo, 'main', patch.branch);

      for (const commit of patch.commits || []) {
        for (const file of commit.files || []) {
          await upsertFileOnBranch(repo, patch.branch, file.path, file.content, commit.message);
        }
      }

      for (const testFile of verdict.test_files || []) {
        await upsertFileOnBranch(
          repo,
          patch.branch,
          testFile.path,
          testFile.content,
          `Add verifier test artifact for ${task.id}`,
        );
      }

      const pr = await openPullRequest(repo, patch.branch, 'main', patch.pr.title, patch.pr.body);

      let merge = { merged: false, reason: 'auto_merge disabled' };
      if (execution.auto_merge) {
        merge = await mergeIfGreen(repo, pr.number);
      }

      results.push({
        task_id: task.id,
        status: 'pr_opened',
        branch: patch.branch,
        pr_number: pr.number,
        verifier: verdict.status,
        policy,
        merge,
      });
    }

    if (execution.enable_pages) {
      try {
        await githubRequest('POST', `/repos/${OWNER}/${repo}/pages`, {
          source: { branch: 'main', path: '/' },
        });
      } catch (_error) {
        // Pages may already be enabled or pending.
      }
    }

    return res.json({
      status: 'ok',
      repo,
      live_url: `https://${OWNER}.github.io/${repo}/`,
      tasks: results,
      plan,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/generate-repo-with-prs', async (req, res) => {
  try {
    const { objective, tasks = [], execution = { auto_merge: false, enable_pages: true } } = req.body;

    if (!objective || !Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'objective + tasks[] required' });
    }

    if (tasks.length > 25) {
      return res.status(400).json({ error: 'Too many tasks (cap 25 in this endpoint).' });
    }

    const repo = slugifyRepoName(objective);

    await githubRequest('POST', '/user/repos', {
      name: repo,
      private: false,
      auto_init: true,
      description: objective.slice(0, 140),
    });

    const indexHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${objective}</title>
  <style>body{font-family:sans-serif;padding:48px;max-width:900px;margin:0 auto}</style>
</head>
<body>
  <h1>${objective}</h1>
  <p>Generated by OpenClaw Orchestrator.</p>
  <h2>Tasks</h2>
  <ul>
    ${tasks.map((t) => `<li>${t.id}: ${t.description}</li>`).join('\n')}
  </ul>
</body>
</html>`;

    await upsertFileOnBranch(repo, 'main', 'index.html', indexHtml, 'Add landing page');

    const ciWorkflow = `name: CI

on:
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Basic validation
        run: |
          echo "Running static checks..."
          if [ ! -f index.html ]; then
            echo "Missing index.html"
            exit 1
          fi

      - name: Lint HTML
        run: |
          if grep -q "<html" index.html; then
            echo "HTML structure present"
          else
            echo "Invalid HTML"
            exit 1
          fi
`;

    await upsertFileOnBranch(repo, 'main', '.github/workflows/ci.yml', ciWorkflow, 'Add CI workflow');

    if (execution.enable_pages) {
      const deployWorkflow = `name: Deploy Pages

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Trigger Pages
        run: echo "Deploy triggered"
`;

      await upsertFileOnBranch(repo, 'main', '.github/workflows/deploy.yml', deployWorkflow, 'Add deploy workflow');
    }

    await protectMainBranch(repo);

    const prResults = [];

    for (const task of tasks) {
      if (!task.id || !task.description) {
        continue;
      }

      const branch = taskToBranch(task.id);
      await ensureBranchFrom(repo, 'main', branch);

      const patch = buildTaskPatchFiles(objective, task);

      for (const file of patch.files) {
        await upsertFileOnBranch(repo, branch, file.path, file.content, file.message);
      }

      await appendToReadme(repo, branch, patch.readmeAppend);

      const pr = await openPullRequest(
        repo,
        branch,
        'main',
        `${task.id}: ${task.description}`.slice(0, 250),
        `Automated PR for task **${task.id}**.\n\n- Branch: \`${branch}\`\n- Objective: ${objective}\n`,
      );

      if (execution.auto_merge) {
        try {
          const mergeResult = await mergeIfGreen(repo, pr.number);
          prResults.push({
            task_id: task.id,
            branch,
            pr_number: pr.number,
            merged: mergeResult.merged,
            reason: mergeResult.reason || null,
          });
        } catch (error) {
          prResults.push({
            task_id: task.id,
            branch,
            pr_number: pr.number,
            merged: false,
            merge_error: error.message,
          });
        }
      } else {
        prResults.push({ task_id: task.id, branch, pr_number: pr.number, merged: false });
      }
    }

    if (execution.enable_pages) {
      try {
        await githubRequest('POST', `/repos/${OWNER}/${repo}/pages`, {
          source: { branch: 'main', path: '/' },
        });
      } catch (_error) {
        // Pages may already be enabled or pending.
      }
    }

    return res.json({
      status: 'success',
      repo,
      live_url: `https://${OWNER}.github.io/${repo}/`,
      prs: prResults,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Server + WebSocket running on :${PORT}`);
});
