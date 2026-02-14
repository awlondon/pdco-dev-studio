import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { plannerAgent, coderAgent, verifierAgent } from './agents.js';

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
    h1 { margin-top: 0; }
    #status { margin-bottom: 12px; color: #7ee7ff; }
    #pr-list { display: grid; gap: 8px; }
    .pr-card { border: 1px solid #304070; border-radius: 10px; padding: 12px; background: #111935; }
    .running { border-color: #00bcd4; box-shadow: 0 0 0 1px #00bcd4 inset; }
    .done { border-color: #17c964; box-shadow: 0 0 0 1px #17c964 inset; }
    .error { border-color: #f31260; box-shadow: 0 0 0 1px #f31260 inset; }
    .merged { color: #c084fc; }
    #log-panel { margin-top: 16px; border: 1px solid #2d3d70; border-radius: 10px; padding: 10px; max-height: 260px; overflow-y: auto; background: #080d1d; }
    #log-panel div { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; margin: 4px 0; }
  </style>
</head>
<body>
  <h1>OpenClaw Execution Cockpit</h1>
  <div id="status">Connecting...</div>
  <div id="pr-list"></div>
  <div id="log-panel"></div>

  <script>
    const prList = document.getElementById('pr-list');
    const statusEl = document.getElementById('status');
    const logPanel = document.getElementById('log-panel');

    function ensurePRCard(data) {
      const prId = 'pr-' + data.pr_number;
      let div = document.getElementById(prId);
      if (!div) {
        div = document.createElement('div');
        div.id = prId;
        div.className = 'pr-card';
        div.dataset.sha = data.sha || '';
        div.innerText = 'PR #' + data.pr_number + ' - Open';
        prList.prepend(div);
      }
      return div;
    }

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
      const prEl = ensurePRCard(data);
      prEl.classList.toggle('merged', Boolean(data.merged));
      prEl.innerText = 'PR #' + data.pr_number + ' - ' + (data.merged ? 'Merged' : data.state);
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

      if (verdict.status !== 'pass') {
        results.push({
          task_id: task.id,
          status: 'blocked',
          verdict,
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
