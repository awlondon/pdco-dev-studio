import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchCheapestAllowedModel,
  fetchModelPricing,
  fetchFirstNonPremiumModel,
  fetchCreditsUsedToday,
  fetchMonthlyQuota,
  fetchPlanNormalizationFactor,
  fetchPlanPolicy,
  fetchNextTurnIndex,
  fetchSessionEvents,
  fetchSessionSummary,
  fetchUsageDailySummary,
  fetchUsageEventsByRange,
  fetchUsageOverview,
  getUsageAnalyticsPool,
  insertLlmTurnLog,
  insertRouteDecision,
  insertUsageEvent,
  isPremiumModel
} from './utils/usageAnalytics.js';
import {
  appendCreditLedger,
  parseCreditLedger,
  readCreditLedger
} from './api/creditLedger.js';

const app = express();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const LLM_PROXY_URL =
  process.env.LLM_PROXY_URL
  || 'https://text-code.primarydesigncompany.workers.dev';
const SESSION_COOKIE_NAME = 'maya_session';
const FREE_PLAN = { tier: 'free', monthly_credits: 500 };
const PLAN_DAILY_CAPS = {
  free: 100,
  starter: 500,
  pro: 2000,
  power: 10000
};
const REQUIRED_USER_HEADERS = [
  'user_id',
  'email',
  'auth_provider',
  'provider_user_id',
  'display_name',
  'created_at',
  'last_login_at',
  'plan_tier',
  'credits_total',
  'credits_remaining',
  'credits_balance',
  'daily_credit_limit',
  'credits_last_reset',
  'monthly_reset_at',
  'newsletter_opt_in',
  'account_status',
  'stripe_customer_id',
  'stripe_subscription_id',
  'billing_status'
];
const STRIPE_PLAN_MAP = (() => {
  const raw = process.env.STRIPE_PLAN_MAP;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Invalid STRIPE_PLAN_MAP JSON.', error);
    return {};
  }
})();
const STRIPE_CREDIT_PACKS = (() => {
  const raw = process.env.STRIPE_CREDIT_PACKS;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Invalid STRIPE_CREDIT_PACKS JSON.', error);
    return {};
  }
})();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const ARTIFACTS_FILE = path.join(DATA_DIR, 'artifacts.json');
const ARTIFACT_VERSIONS_FILE = path.join(DATA_DIR, 'artifact_versions.json');
const ARTIFACT_UPLOADS_DIR = path.join(DATA_DIR, 'artifact_uploads');
const PROFILE_UPLOADS_DIR = path.join(DATA_DIR, 'profile_uploads');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const ARTIFACT_EVENTS_FILE = path.join(DATA_DIR, 'artifact_events.csv');
const MAX_PROMPT_CHARS = 8000;

const CHAT_SYSTEM_PROMPT = `You are a serious, capable engineering assistant.
Be concise, direct, and practical.
Avoid whimsical, playful, or anthropomorphic language.
Demonstrate capability through action (code, structure), not tone.

Default behavior:
- Be proactive and demonstrate capability when possible.
- If the user input is underspecified, choose a reasonable, concrete task and execute it.
- Prefer generating working code, UI components, or functional examples over discussion.

Assume the user is evaluating capability unless stated otherwise.

You MUST respond with valid JSON only. Do not wrap in markdown or code fences.
Return ONLY the following schema with no extra top-level keys:

{
  "assistant": { "text": "string" },
  "ui": {
    "html": "string",
    "css": "string",
    "js": "string"
  }
}

The "ui.html", "ui.css", and "ui.js" fields are optional but MUST be present as
empty strings when not provided. If the user asks a question, respond with
assistant.text. If the user asks to modify or generate UI, include ui.html/css/js.`;

/**
 * 🔴 CORS MUST BE FIRST
 */
app.use(cors({
  origin: [
    'https://maya-dev-ui.pages.dev',
    'https://dev.primarydesignco.com'
  ],
  credentials: true
}));

app.options('*', cors());

app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/stripe/webhook')) {
    return next();
  }
  return express.json({ limit: '10mb' })(req, res, next);
});

app.use('/uploads/artifacts', express.static(ARTIFACT_UPLOADS_DIR));
app.use('/uploads/profiles', express.static(PROFILE_UPLOADS_DIR));

/**
 * 🔍 DIAGNOSTIC HEADERS (prove code is live)
 */
app.use((req, res, next) => {
  res.setHeader('X-MAYA-BACKEND', 'alive');
  next();
});

/**
 * HEALTH
 */
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

/**
 * SESSION CHECK
 */
app.get('/api/me', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    return res.json({
      user: mapUserForClient(user),
      token: session.token
    });
  } catch (error) {
    console.error('Failed to load /me.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load session' });
  }
});

app.post('/api/artifacts/metadata', async (req, res) => {
  let source = 'code-only';
  try {
    const transcript = Array.isArray(req.body?.transcript) ? req.body.transcript : [];
    const chat = Array.isArray(req.body?.chat) ? req.body.chat : transcript;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : chat;
    const code = req.body?.code || {};
    const filteredMessages = selectMetadataMessages(messages);
    const hasChatContext = filteredMessages.some((entry) => entry.role === 'user');
    const promptContent = hasChatContext
      ? buildChatPlusCodePrompt(filteredMessages, code)
      : buildCodeOnlyPrompt(code);
    const prompt = [
      {
        role: 'user',
        content: promptContent
      }
    ];

    source = hasChatContext ? 'chat+code' : 'code-only';
    if (!LLM_PROXY_URL) {
      return res.json(buildMetadataResponse({}, source));
    }

    const workerRes = await fetch(LLM_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: prompt,
        temperature: 0.2
      })
    });

    if (!workerRes.ok) {
      return res.json(buildMetadataResponse({}, source));
    }

    const responseText = await workerRes.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }

    const content = data?.choices?.[0]?.message?.content
      ?? data?.candidates?.[0]?.content
      ?? data?.output_text
      ?? '';
    let parsed = null;
    try {
      parsed = content ? JSON.parse(content) : null;
    } catch {
      parsed = null;
    }

    res.json(buildMetadataResponse(parsed || {}, source));
  } catch (error) {
    console.error('Failed to infer artifact metadata.', error);
    res.json(buildMetadataResponse({}, source));
  }
});

app.post('/api/artifacts', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const screenshotDataUrl = resolveScreenshotDataUrl(req.body);
    const resolvedCode = resolveArtifactCode(req.body) || { language: 'html', content: '' };
    const codeVersions = resolveArtifactCodeVersions(req.body);
    const visibility = req.body?.visibility === 'public' ? 'public' : 'private';
    const validation = validateArtifactPayload({
      code: resolvedCode,
      codeVersions,
      visibility,
      screenshotDataUrl
    });
    if (!validation.ok) {
      console.error('Artifact payload rejected.', {
        userId: user.user_id,
        reasons: validation.errors
      });
      return res.status(400).json({ ok: false, error: validation.errors.join(' ') });
    }

    const now = new Date().toISOString();
    const artifactId = crypto.randomUUID();
    const code = resolvedCode;
    const screenshotUrl = await persistArtifactScreenshot(screenshotDataUrl, artifactId);
    const derivedFrom = req.body?.derived_from || { artifact_id: null, owner_user_id: null };
    const sourceSession = req.body?.source_session || { session_id: req.body?.session_id || '', credits_used_estimate: 0 };
    const chat = Array.isArray(req.body?.chat) ? req.body.chat : null;

    const version = buildArtifactVersion({
      artifactId,
      code,
      chat,
      sourceSession,
      codeVersions
    });
    const artifact = {
      artifact_id: artifactId,
      owner_user_id: user.user_id,
      visibility,
      created_at: now,
      updated_at: now,
      title: String(req.body?.title || 'Untitled artifact'),
      description: String(req.body?.description || ''),
      code: {
        language: String(code.language || 'html'),
        content: String(code.content || '')
      },
      screenshot_url: screenshotUrl,
      derived_from: {
        artifact_id: derivedFrom?.artifact_id || null,
        owner_user_id: derivedFrom?.owner_user_id || null,
        version_id: derivedFrom?.version_id || null,
        version_label: derivedFrom?.version_label || null
      },
      source_session: {
        session_id: String(sourceSession?.session_id || ''),
        credits_used_estimate: Number(sourceSession?.credits_used_estimate || 0) || 0
      },
      current_version_id: version.version_id,
      versioning: {
        enabled: false,
        chat_history_public: false
      },
      stats: {
        forks: 0,
        imports: 0
      }
    };

    const artifacts = await loadArtifacts();
    artifacts.push(artifact);
    await saveArtifacts(artifacts);

    const versions = await loadArtifactVersions();
    versions.push(version);
    await saveArtifactVersions(versions);

    await appendArtifactEvent({
      eventType: 'artifact_created',
      userId: user.user_id,
      artifactId,
      sourceArtifactId: artifact.derived_from.artifact_id || '',
      sessionId: artifact.source_session.session_id || ''
    });
    await appendArtifactEvent({
      eventType: 'artifact_version_created',
      userId: user.user_id,
      artifactId,
      sourceArtifactId: artifact.derived_from.artifact_id || '',
      sessionId: artifact.source_session.session_id || ''
    });

    if (visibility === 'public') {
      await appendArtifactEvent({
        eventType: 'artifact_published',
        userId: user.user_id,
        artifactId,
        sourceArtifactId: artifact.derived_from.artifact_id || '',
        sessionId: artifact.source_session.session_id || ''
      });
    }

    return res.json({
      ok: true,
      artifact: applyArtifactDefaults(artifact),
      artifact_id: artifact.artifact_id,
      screenshot_url: artifact.screenshot_url || ''
    });
  } catch (error) {
    console.error('Failed to create artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to create artifact' });
  }
});

app.post('/api/artifacts/:id/versions', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifacts = await loadArtifacts();
    const index = artifacts.findIndex((item) => item.artifact_id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    const artifact = applyArtifactDefaults(artifacts[index]);
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const resolvedCode = resolveArtifactCode(req.body) || artifact.code;
    const codeVersions = resolveArtifactCodeVersions(req.body);
    const visibility = req.body?.visibility === 'public'
      ? 'public'
      : (req.body?.visibility === 'private' ? 'private' : artifact.visibility);
    const validation = validateArtifactPayload({
      code: resolvedCode || artifact.code,
      codeVersions,
      visibility,
      screenshotDataUrl: req.body?.screenshot_data_url
    });
    if (!validation.ok) {
      console.error('Artifact version payload rejected.', {
        userId: artifact.owner_user_id,
        artifactId: artifact.artifact_id,
        reasons: validation.errors
      });
      return res.status(400).json({ ok: false, error: validation.errors.join(' ') });
    }
    const now = new Date().toISOString();
    const code = resolvedCode || artifact.code;
    const chat = Array.isArray(req.body?.chat) ? req.body.chat : null;
    const sourceSession = req.body?.source_session || { session_id: '', credits_used_estimate: 0 };
    const version = buildArtifactVersion({
      artifactId: artifact.artifact_id,
      code,
      chat,
      sourceSession,
      label: req.body?.label,
      codeVersions
    });
    const screenshotUrl = await persistArtifactScreenshot(req.body?.screenshot_data_url, artifact.artifact_id);
    artifact.current_version_id = version.version_id;
    artifact.updated_at = now;
    artifact.code = {
      language: String(code?.language || artifact.code?.language || 'html'),
      content: String(code?.content || artifact.code?.content || '')
    };
    if (screenshotUrl) {
      artifact.screenshot_url = screenshotUrl;
    }
    if (artifact.visibility !== 'public') {
      artifact.title = String(req.body?.title || artifact.title);
      artifact.description = String(req.body?.description || artifact.description);
    }
    artifacts[index] = artifact;
    await saveArtifacts(artifacts);

    const versions = await loadArtifactVersions();
    versions.push(version);
    await saveArtifactVersions(versions);

    await appendArtifactEvent({
      eventType: 'artifact_version_created',
      userId: artifact.owner_user_id,
      artifactId: artifact.artifact_id,
      sourceArtifactId: artifact.derived_from?.artifact_id || '',
      sessionId: version.session_id || ''
    });

    return res.json({ ok: true, artifact });
  } catch (error) {
    console.error('Failed to create artifact version.', error);
    return res.status(500).json({ ok: false, error: 'Failed to create artifact version' });
  }
});

app.get('/api/artifacts/:id/versions', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    const artifacts = await loadArtifacts();
    const artifact = applyArtifactDefaults(artifacts.find((item) => item.artifact_id === req.params.id));
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    const isOwner = session && artifact.owner_user_id === session.sub;
    const canView = artifact.visibility === 'public'
      ? Boolean(artifact.versioning?.enabled) || isOwner
      : isOwner;
    if (!canView) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const versions = await loadArtifactVersions();
    const filtered = versions
      .filter((version) => version.artifact_id === artifact.artifact_id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const allowChat = isOwner || artifact.versioning?.chat_history_public;
    const formatted = filtered.map((version, index) => ({
      ...version,
      version_number: index + 1,
      label: version.label || `v${index + 1}`,
      chat: allowChat ? version.chat : { included: false, messages: null }
    })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ ok: true, versions: formatted });
  } catch (error) {
    console.error('Failed to load artifact versions.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifact versions' });
  }
});

app.get('/api/profile', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    const profiles = await loadProfiles();
    const profile = profiles.find((entry) => entry.user_id === user.user_id);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Profile not found' });
    }
    const stats = await buildProfileStats(user.user_id);
    return res.json({ ok: true, profile: mapProfileForClient(profile, user, stats) });
  } catch (error) {
    console.error('Failed to load profile.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load profile' });
  }
});

app.get('/api/profile/:handle', async (req, res) => {
  try {
    const handle = String(req.params.handle || '').toLowerCase();
    if (!handle) {
      return res.status(400).json({ ok: false, error: 'Handle is required' });
    }
    const profiles = await loadProfiles();
    const profile = profiles.find((entry) => entry.handle === handle);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Profile not found' });
    }
    const user = await getUserById(profile.user_id);
    const stats = await buildProfileStats(profile.user_id);
    return res.json(mapPublicProfile(profile, user, stats));
  } catch (error) {
    console.error('Failed to load public profile.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load profile' });
  }
});

app.patch('/api/profile', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    const { fields, files } = await parseMultipartRequest(req);
    const profiles = await loadProfiles();
    const now = new Date().toISOString();
    const current = profiles.find((entry) => entry.user_id === user.user_id);
    const nextHandle = String(fields.handle || current?.handle || '').toLowerCase();
    if (!nextHandle) {
      console.error('Profile update rejected: missing handle.', { userId: user.user_id });
      return res.status(400).json({ ok: false, error: 'Handle is required' });
    }
    const existing = profiles.find((entry) => entry.handle === nextHandle);
    if (existing && existing.user_id !== user.user_id) {
      console.error('Profile update rejected: handle taken.', {
        userId: user.user_id,
        handle: nextHandle
      });
      return res.status(409).json({ ok: false, error: 'Handle is already taken' });
    }
    let avatarUrl = current?.avatar_url || '';
    if (files.avatar) {
      avatarUrl = await persistProfileAvatar(files.avatar, user.user_id);
    } else if (fields.avatar_url !== undefined) {
      avatarUrl = String(fields.avatar_url || '');
    }
    const demographics = {
      age: fields.age !== undefined ? Number(fields.age) || null : current?.demographics?.age ?? null,
      gender: fields.gender !== undefined
        ? String(fields.gender || '').trim()
        : current?.demographics?.gender || '',
      city: fields.city !== undefined
        ? String(fields.city || '').trim()
        : current?.demographics?.city || '',
      country: fields.country !== undefined
        ? String(fields.country || '').trim()
        : current?.demographics?.country || ''
    };
    const nextProfile = {
      user_id: user.user_id,
      handle: nextHandle,
      display_name: fields.display_name !== undefined
        ? String(fields.display_name || '')
        : current?.display_name || '',
      bio: fields.bio !== undefined ? String(fields.bio || '') : current?.bio || '',
      avatar_url: avatarUrl,
      demographics,
      created_at: current?.created_at || user.created_at || now,
      updated_at: now
    };
    if (current) {
      const index = profiles.findIndex((entry) => entry.user_id === user.user_id);
      profiles[index] = nextProfile;
    } else {
      profiles.push(nextProfile);
    }
    await saveProfiles(profiles);
    const stats = await buildProfileStats(user.user_id);
    return res.json({ ok: true, profile: mapProfileForClient(nextProfile, user, stats) });
  } catch (error) {
    console.error('Failed to update profile.', error);
    return res.status(500).json({ ok: false, error: 'Failed to update profile' });
  }
});

app.get('/api/artifacts/:id/versions/:versionId', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    const artifacts = await loadArtifacts();
    const artifact = applyArtifactDefaults(artifacts.find((item) => item.artifact_id === req.params.id));
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    const isOwner = session && artifact.owner_user_id === session.sub;
    const canView = artifact.visibility === 'public'
      ? Boolean(artifact.versioning?.enabled) || isOwner
      : isOwner;
    if (!canView) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const versions = await loadArtifactVersions();
    const filtered = versions
      .filter((version) => version.artifact_id === artifact.artifact_id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const version = filtered.find((entry) => entry.version_id === req.params.versionId);
    if (!version) {
      return res.status(404).json({ ok: false, error: 'Version not found' });
    }
    const versionNumber = filtered.findIndex((entry) => entry.version_id === version.version_id) + 1;
    const allowChat = isOwner || artifact.versioning?.chat_history_public;
    const responseVersion = {
      ...version,
      version_number: versionNumber,
      label: version.label || `v${versionNumber}`,
      chat: allowChat ? version.chat : { included: false, messages: null }
    };
    await appendArtifactEvent({
      eventType: 'artifact_version_viewed',
      userId: isOwner ? artifact.owner_user_id : '',
      artifactId: artifact.artifact_id,
      sourceArtifactId: artifact.derived_from?.artifact_id || '',
      sessionId: version.session_id || ''
    });
    return res.json({ ok: true, version: responseVersion });
  } catch (error) {
    console.error('Failed to load artifact version.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifact version' });
  }
});

app.patch('/api/artifacts/:id/publish_settings', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifacts = await loadArtifacts();
    const index = artifacts.findIndex((item) => item.artifact_id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    const artifact = applyArtifactDefaults(artifacts[index]);
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const enabled = Boolean(req.body?.enabled);
    const chatHistoryPublic = Boolean(req.body?.chat_history_public);
    artifact.versioning = {
      enabled,
      chat_history_public: enabled ? chatHistoryPublic : false
    };
    artifact.updated_at = new Date().toISOString();
    artifacts[index] = artifact;
    await saveArtifacts(artifacts);
    return res.json({ ok: true, artifact });
  } catch (error) {
    console.error('Failed to update publish settings.', error);
    return res.status(500).json({ ok: false, error: 'Failed to update publish settings' });
  }
});

app.get('/api/artifacts/private', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifacts = await loadArtifacts();
    const owned = artifacts
      .filter((artifact) => artifact.owner_user_id === session.sub)
      .map((artifact) => applyArtifactDefaults(artifact));
    owned.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return res.json({ ok: true, artifacts: owned });
  } catch (error) {
    console.error('Failed to load private artifacts.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifacts' });
  }
});

app.get('/api/artifacts/public', async (req, res) => {
  try {
    const artifacts = await loadArtifacts();
    const publicArtifacts = artifacts
      .filter((artifact) => artifact.visibility === 'public')
      .map((artifact) => applyArtifactDefaults(artifact));
    publicArtifacts.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return res.json({ ok: true, artifacts: publicArtifacts });
  } catch (error) {
    console.error('Failed to load public artifacts.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifacts' });
  }
});

app.get('/api/artifacts/:id', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    const artifacts = await loadArtifacts();
    const artifact = applyArtifactDefaults(artifacts.find((item) => item.artifact_id === req.params.id));
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    if (artifact.visibility !== 'public' && (!session || artifact.owner_user_id !== session.sub)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    return res.json({ ok: true, artifact });
  } catch (error) {
    console.error('Failed to load artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifact' });
  }
});

app.post('/api/artifacts/:id/fork', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    const artifacts = await loadArtifacts();
    const source = applyArtifactDefaults(artifacts.find((item) => item.artifact_id === req.params.id));
    if (!source) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    if (source.visibility !== 'public' && source.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const allVersions = await loadArtifactVersions();
    const sourceVersions = allVersions
      .filter((version) => version.artifact_id === source.artifact_id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const requestedVersionId = req.body?.version_id;
    const resolvedVersion = sourceVersions.find((version) => version.version_id === requestedVersionId)
      || sourceVersions.find((version) => version.version_id === source.current_version_id)
      || sourceVersions[sourceVersions.length - 1];
    const versionNumber = resolvedVersion
      ? sourceVersions.findIndex((version) => version.version_id === resolvedVersion.version_id) + 1
      : null;
    const forkVersion = buildArtifactVersion({
      artifactId: newId,
      code: resolvedVersion?.code || source.code,
      chat: null,
      sourceSession: {
        session_id: String(req.body?.session_id || ''),
        credits_used_estimate: Number(req.body?.credits_used_estimate || 0) || 0
      }
    });
    const forked = {
      artifact_id: newId,
      owner_user_id: user.user_id,
      visibility: 'private',
      created_at: now,
      updated_at: now,
      title: `Fork of ${source.title || 'artifact'}`,
      description: source.description || '',
      code: { ...(resolvedVersion?.code || source.code) },
      screenshot_url: source.screenshot_url,
      derived_from: {
        artifact_id: source.artifact_id,
        owner_user_id: source.owner_user_id,
        version_id: resolvedVersion?.version_id || source.current_version_id || null,
        version_label: versionNumber ? `v${versionNumber}` : null
      },
      source_session: {
        session_id: String(req.body?.session_id || ''),
        credits_used_estimate: Number(req.body?.credits_used_estimate || 0) || 0
      },
      current_version_id: forkVersion.version_id,
      versioning: {
        enabled: false,
        chat_history_public: false
      },
      stats: {
        forks: 0,
        imports: 0
      }
    };
    source.stats = source.stats || { forks: 0, imports: 0 };
    source.stats.forks = Number(source.stats.forks || 0) + 1;
    source.stats.imports = Number(source.stats.imports || 0) + 1;
    source.updated_at = now;
    artifacts.push(forked);
    await saveArtifacts(artifacts);
    const versions = await loadArtifactVersions();
    versions.push(forkVersion);
    await saveArtifactVersions(versions);

    await appendArtifactEvent({
      eventType: 'artifact_forked',
      userId: source.owner_user_id,
      artifactId: source.artifact_id,
      sourceArtifactId: source.artifact_id,
      sessionId: forked.source_session.session_id || ''
    });
    await appendArtifactEvent({
      eventType: 'artifact_version_created',
      userId: user.user_id,
      artifactId: forked.artifact_id,
      sourceArtifactId: source.artifact_id,
      sessionId: forked.source_session.session_id || ''
    });
    await appendArtifactEvent({
      eventType: 'artifact_version_forked',
      userId: source.owner_user_id,
      artifactId: source.artifact_id,
      sourceArtifactId: source.artifact_id,
      sessionId: forked.source_session.session_id || ''
    });

    await appendArtifactEvent({
      eventType: 'artifact_imported',
      userId: user.user_id,
      artifactId: forked.artifact_id,
      sourceArtifactId: source.artifact_id,
      sessionId: forked.source_session.session_id || ''
    });

    return res.json({ ok: true, artifact: forked });
  } catch (error) {
    console.error('Failed to fork artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to fork artifact' });
  }
});

app.patch('/api/artifacts/:id/visibility', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifacts = await loadArtifacts();
    const index = artifacts.findIndex((item) => item.artifact_id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    const artifact = applyArtifactDefaults(artifacts[index]);
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const nextVisibility = req.body?.visibility === 'public' ? 'public' : 'private';
    const wasPublic = artifact.visibility === 'public';
    artifact.visibility = nextVisibility;
    artifact.updated_at = new Date().toISOString();
    artifacts[index] = artifact;
    await saveArtifacts(artifacts);

    if (!wasPublic && nextVisibility === 'public') {
      await appendArtifactEvent({
        eventType: 'artifact_published',
        userId: artifact.owner_user_id,
        artifactId: artifact.artifact_id,
        sourceArtifactId: artifact.derived_from?.artifact_id || '',
        sessionId: artifact.source_session?.session_id || ''
      });
    }

    return res.json({ ok: true, artifact });
  } catch (error) {
    console.error('Failed to update artifact visibility.', error);
    return res.status(500).json({ ok: false, error: 'Failed to update artifact visibility' });
  }
});

app.patch('/api/artifacts/:id', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifacts = await loadArtifacts();
    const index = artifacts.findIndex((item) => item.artifact_id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    const artifact = applyArtifactDefaults(artifacts[index]);
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (artifact.visibility === 'public') {
      return res.status(400).json({ ok: false, error: 'Public artifacts are immutable' });
    }
    artifact.title = String(req.body?.title || artifact.title);
    artifact.description = String(req.body?.description || artifact.description);
    artifact.updated_at = new Date().toISOString();
    artifacts[index] = artifact;
    await saveArtifacts(artifacts);
    return res.json({ ok: true, artifact });
  } catch (error) {
    console.error('Failed to update artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to update artifact' });
  }
});

app.delete('/api/artifacts/:id', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifacts = await loadArtifacts();
    const index = artifacts.findIndex((item) => item.artifact_id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    const artifact = artifacts[index];
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    artifacts.splice(index, 1);
    await saveArtifacts(artifacts);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to delete artifact' });
  }
});

app.get('/api/usage/overview', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    const pool = getUsageAnalyticsPool();
    const dailyLimit = resolveDailyCreditLimit(user);
    if (pool) {
      const overviewRow = await fetchUsageOverview({ userId: session.sub });
      const todayKey = new Date().toISOString().slice(0, 10);
      const todayRows = await fetchUsageEventsByRange({
        userId: session.sub,
        startDate: todayKey,
        endDate: todayKey
      });
      const creditsUsedToday = (todayRows || []).reduce((sum, row) => {
        return sum + Number(row.credits_used || 0);
      }, 0);
      const overview = {
        total_requests: Number(overviewRow?.requests || 0),
        total_credits: Number(overviewRow?.credits_used || 0),
        avg_latency_ms: Number(overviewRow?.avg_latency_ms || 0),
        success_rate: Number(overviewRow?.success_rate || 0) / 100
      };
      return res.json({
        ok: true,
        overview,
        credits_used_today: creditsUsedToday,
        daily_limit: dailyLimit
      });
    }

    const usageRows = await loadUsageLogRows();
    const userRows = usageRows.filter((row) => row.user_id === session.sub);
    const monthRows = filterUsageRowsByMonth(userRows);
    const overview = buildUsageOverview(monthRows);
    const todayKey = new Date().toISOString().slice(0, 10);
    const creditsUsedToday = userRows
      .filter((row) => row.timestamp_utc?.startsWith(todayKey))
      .reduce((sum, row) => sum + Number(row.credits_charged || row.credits_used || 0), 0);
    return res.json({
      ok: true,
      overview,
      credits_used_today: creditsUsedToday,
      daily_limit: dailyLimit
    });
  } catch (error) {
    console.error('Failed to load usage overview.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load usage overview' });
  }
});

app.get('/api/usage/daily', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const days = parseRangeDays(req.query.range) ?? (Number(req.query.days) || 14);
    const pool = getUsageAnalyticsPool();
    if (pool) {
      const rows = await fetchUsageDailySummary({ userId: session.sub, days });
      const daily = (rows || []).map((row) => ({
        date: row.day,
        total_requests: Number(row.requests || 0),
        total_credits: Number(row.credits_used || 0),
        avg_latency_ms: Number(row.avg_latency_ms || 0),
        success_rate: Number(row.success_rate || 0) / 100,
        by_intent: {
          code: Number(row.code_requests || 0),
          text: Number(row.text_requests || 0)
        },
        entries: []
      }));
      return res.json({ ok: true, range_days: days, daily });
    }

    const usageRows = await loadUsageLogRows();
    const filtered = filterUsageRowsByRange({
      rows: usageRows,
      userId: session.sub,
      days
    });
    const daily = buildDailyUsageSummaries(filtered, { includeEntries: false });
    return res.json({ ok: true, range_days: days, daily });
  } catch (error) {
    console.error('Failed to load usage daily.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load usage daily' });
  }
});

app.get('/api/usage/history', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const days = parseRangeDays(req.query.range) ?? (Number(req.query.days) || 14);
    const pool = getUsageAnalyticsPool();
    if (pool) {
      const events = await fetchUsageEventsByRange({ userId: session.sub, days });
      const mapped = (events || []).map(mapUsageEventRow);
      const daily = buildDailyUsageSummaries(mapped, { includeEntries: true });
      return res.json({ ok: true, range_days: days, daily });
    }

    const usageRows = await loadUsageLogRows();
    const filtered = filterUsageRowsByRange({
      rows: usageRows,
      userId: session.sub,
      days
    });
    const daily = buildDailyUsageSummaries(filtered, { includeEntries: true });
    return res.json({ ok: true, range_days: days, daily });
  } catch (error) {
    console.error('Failed to load usage history.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load usage history' });
  }
});

app.get('/api/usage/summary', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const groupBy = String(req.query.group_by || 'session');
    const days = Number(req.query.days);
    const startDate = req.query.start_date ? String(req.query.start_date) : '';
    const endDate = req.query.end_date ? String(req.query.end_date) : '';
    const pool = getUsageAnalyticsPool();
    if (pool) {
      if (groupBy === 'session') {
        const sessions = await fetchSessionSummary({ userId: session.sub });
        return res.json({
          ok: true,
          sessions: (sessions || []).map((row) => ({
            session_id: row.session_id,
            started_at: row.session_start,
            ended_at: row.session_end || row.session_start,
            turns: Number(row.turns || 0),
            credits_used: Number(row.credits_used || 0)
          }))
        });
      }
      const events = await fetchUsageEventsByRange({
        userId: session.sub,
        startDate,
        endDate,
        days: Number.isFinite(days) ? days : null
      });
      return res.json({ ok: true, rows: (events || []).map(mapUsageEventRow) });
    }

    const usageRows = await loadUsageLogRows();
    const filtered = filterUsageRowsByRange({
      rows: usageRows,
      userId: session.sub,
      days,
      startDate,
      endDate
    });
    if (groupBy === 'session') {
      return res.json({
        ok: true,
        sessions: buildSessionSummariesFromUsage(filtered)
      });
    }
    return res.json({ ok: true, rows: filtered });
  } catch (error) {
    console.error('Failed to load usage summary.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load usage summary' });
  }
});

app.get('/api/session/export/:sessionId', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const sessionId = req.params.sessionId;
    const pool = getUsageAnalyticsPool();
    if (pool) {
      const events = await fetchSessionEvents({ userId: session.sub, sessionId });
      if (!events?.length) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      const mapped = events.map((row) => ({
        timestamp_utc: row.created_at,
        session_id: sessionId,
        intent_type: row.intent,
        model: row.model,
        input_tokens: row.tokens_in,
        output_tokens: row.tokens_out,
        credits_charged: row.credits_used,
        latency_ms: row.latency_ms,
        status: row.success ? 'success' : 'failure'
      }));
      const [summary] = buildSessionSummariesFromUsage(mapped);
      return res.json({
        ok: true,
        session: summary,
        events: mapped
      });
    }

    const usageRows = await loadUsageLogRows();
    const filtered = usageRows.filter((row) => {
      return row.session_id === sessionId && row.user_id === session.sub;
    });
    if (!filtered.length) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }
    const [summary] = buildSessionSummariesFromUsage(filtered);
    return res.json({
      ok: true,
      session: summary,
      events: filtered
    });
  } catch (error) {
    console.error('Failed to export session.', error);
    return res.status(500).json({ ok: false, error: 'Failed to export session' });
  }
});

app.get('/billing/portal', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).send('Unauthorized');
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).send('User not found');
    }
    if (!user.stripe_customer_id) {
      return res.status(400).send('No Stripe customer ID');
    }
    const returnUrl = process.env.FRONTEND_URL
      || req.headers.origin
      || 'https://maya-dev-ui.pages.dev';
    const portalSession = await createStripeBillingPortalSession({
      customerId: user.stripe_customer_id,
      returnUrl
    });
    return res.redirect(portalSession.url);
  } catch (error) {
    console.error('Billing portal failed.', error);
    return res.status(500).send('Unable to load billing portal');
  }
});

/**
 * CHAT (FULL IMPLEMENTATION — DO NOT STUB)
 */
app.post('/api/chat', async (req, res) => {
  const requestStartedAt = Date.now();
  const requestId = crypto.randomUUID();
  const intentType = req.body?.intentType || 'chat';
  let user = null;
  let routeDecision = null;
  let requestedModel = req.body?.model || OPENAI_MODEL;
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const promptText = capPromptText(
      typeof req.body?.promptText === 'string'
        ? req.body.promptText
        : buildPromptText(messages)
    );
    const inputChars = messages
      .map((entry) => (entry?.content ? String(entry.content) : ''))
      .join('').length;
    const estimatedCredits = calculateCreditsUsed({
      inputChars,
      outputChars: 0,
      intentType
    });
    const creditsRemaining = resolveCreditsBalance(user);
    const creditsTotal = Number(user.credits_total || 0);
    const inputTokensEstimate = estimateTokensFromChars(inputChars);
    const dailyLimit = resolveDailyCreditLimit(user);
    const creditsUsedToday = Number.isFinite(dailyLimit)
      ? await fetchCreditsUsedTodayForUser(user.user_id)
      : 0;

    if (Number.isFinite(dailyLimit) && creditsUsedToday >= dailyLimit) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_rejected',
        intentType,
        model: req.body?.model || OPENAI_MODEL,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      return res.status(402).json({
        ok: false,
        error: 'Daily credit limit reached',
        credits_remaining: creditsRemaining,
        daily_limit: dailyLimit,
        credits_used_today: creditsUsedToday
      });
    }

    if (
      Number.isFinite(dailyLimit)
      && creditsUsedToday + estimatedCredits > dailyLimit
    ) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_rejected',
        intentType,
        model: req.body?.model || OPENAI_MODEL,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      return res.status(402).json({
        ok: false,
        error: 'Daily credit limit reached',
        credits_remaining: creditsRemaining,
        daily_limit: dailyLimit,
        credits_used_today: creditsUsedToday,
        estimated_credits: estimatedCredits
      });
    }

    if (!Number.isFinite(creditsRemaining) || creditsRemaining <= 0) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_rejected',
        intentType,
        model: req.body?.model || OPENAI_MODEL,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      return res.status(402).json({
        ok: false,
        error: 'Out of credits',
        credits_remaining: creditsRemaining
      });
    }

    if (estimatedCredits > creditsRemaining) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_rejected',
        intentType,
        model: requestedModel,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      return res.status(402).json({
        ok: false,
        error: 'Insufficient credits for this request',
        credits_remaining: creditsRemaining,
        estimated_credits: estimatedCredits
      });
    }

    routeDecision = await routeModelForUser({
      user,
      intentType,
      requestedModel,
      sessionId: req.body?.sessionId || ''
    });
    if (routeDecision?.model && routeDecision.model !== requestedModel) {
      req.body.model = routeDecision.model;
    }

    const workerRes = await fetch(LLM_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const responseText = await workerRes.text();
    if (!workerRes.ok) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_error',
        intentType,
        model: requestedModel,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      res.status(workerRes.status);
      res.setHeader('Content-Type', 'application/json');
      res.send(responseText);
      return;
    }

    let data;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }

    if (!data) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_error',
        intentType,
        model: requestedModel,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      res.status(502).json({ ok: false, error: 'Invalid LLM response' });
      return;
    }

    const usage = data?.usage || {};
    const totalTokens = Number(usage?.total_tokens);
    const usageInputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
    const usageOutputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
    const resolvedInputTokens = Number.isFinite(usageInputTokens)
      ? usageInputTokens
      : inputTokensEstimate;
    const resolvedOutputTokens = Number.isFinite(usageOutputTokens)
      ? usageOutputTokens
      : Number.isFinite(totalTokens)
        ? Math.max(0, totalTokens - resolvedInputTokens)
        : estimateTokensFromChars(outputChars);
    const outputText =
      data?.choices?.[0]?.message?.content
      ?? data?.candidates?.[0]?.content
      ?? data?.output_text
      ?? '';
    const outputChars = outputText ? String(outputText).length : 0;
    const actualCredits = calculateCreditsUsed({
      inputChars,
      outputChars,
      intentType,
      totalTokens
    });
    let nextRemaining = clampCredits(creditsRemaining - actualCredits, creditsTotal);

    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    if (sessionId) {
      try {
        const turnIndex = await fetchNextTurnIndex({ sessionId });
        if (turnIndex) {
          await insertLlmTurnLog({
            userId: user.user_id,
            sessionId,
            turnIndex,
            intent: normalizeTurnIntent(intentType),
            model: data?.model || req.body?.model || requestedModel,
            glyphSurface: req.body?.glyphSurface ?? req.body?.glyph_surface ?? null,
            glyphJson: req.body?.glyphJson ?? req.body?.glyph_json ?? null,
            promptText,
            promptTokens: resolvedInputTokens,
            completionTokens: resolvedOutputTokens,
            creditsCharged: actualCredits,
            latencyMs: Date.now() - requestStartedAt
          });
        }
      } catch (logError) {
        console.warn('Failed to log LLM turn.', logError);
      }
    }

    try {
      const chargeResult = await applyCreditDeduction({
        userId: user.user_id,
        sessionId,
        turnId: requestId,
        creditsToCharge: actualCredits,
        creditsTotal,
        metadata: {
          model: data?.model || req.body?.model || requestedModel,
          tokens_in: resolvedInputTokens,
          tokens_out: resolvedOutputTokens
        }
      });
      nextRemaining = Number.isFinite(chargeResult.nextBalance)
        ? chargeResult.nextBalance
        : nextRemaining;
    } catch (chargeError) {
      if (String(chargeError?.message || '') === 'INSUFFICIENT_CREDITS') {
        await appendUsageEntry({
          user,
          requestId,
          sessionId,
          eventType: 'chat_rejected',
          intentType,
          model: data?.model || req.body?.model || requestedModel,
          inputTokens: resolvedInputTokens,
          outputTokens: resolvedOutputTokens,
          inputChars,
          outputChars,
          totalTokens,
          reservedCredits: estimatedCredits,
          actualCredits,
          creditsCharged: 0,
          latencyMs: Date.now() - requestStartedAt,
          status: 'failure'
        });
        return res.status(402).json({
          ok: false,
          error: 'Insufficient credits for this request',
          credits_remaining: creditsRemaining,
          estimated_credits: estimatedCredits
        });
      }
      throw chargeError;
    }

    await appendUsageEntry({
      user,
      requestId,
      sessionId,
      eventType: intentType === 'code' ? 'code_gen' : 'chat_turn',
      intentType,
      model: data?.model || req.body?.model || requestedModel,
      inputTokens: resolvedInputTokens,
      outputTokens: resolvedOutputTokens,
      inputChars,
      outputChars,
      totalTokens,
      reservedCredits: estimatedCredits,
      actualCredits,
      creditsCharged: actualCredits,
      latencyMs: Date.now() - requestStartedAt,
      status: 'success'
    });

    data.usage = {
      ...usage,
      actual_credits: actualCredits,
      reserved_credits: estimatedCredits,
      credits_charged: actualCredits,
      remainingCredits: nextRemaining,
      credits_remaining: nextRemaining
    };

    if (routeDecision?.reason && routeDecision.reason !== 'policy_default') {
      data.routing = {
        requested_model: requestedModel,
        routed_model: data?.model || req.body?.model || requestedModel,
        reason: routeDecision.reason
      };
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data));
  } catch (err) {
    console.error('Worker proxy error:', err);
    if (user) {
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const inputChars = messages
        .map((entry) => (entry?.content ? String(entry.content) : ''))
        .join('').length;
      const inputTokens = estimateTokensFromChars(inputChars);
      const estimatedCredits = calculateCreditsUsed({
        inputChars,
        outputChars: 0,
        intentType
      });
      try {
        await appendUsageEntry({
          user,
          requestId,
          sessionId: req.body?.sessionId || '',
          eventType: 'chat_error',
          intentType,
          model: requestedModel,
          inputTokens,
          outputTokens: 0,
          inputChars,
          outputChars: 0,
          totalTokens: inputTokens,
          reservedCredits: estimatedCredits,
          actualCredits: 0,
          creditsCharged: 0,
          latencyMs: Date.now() - requestStartedAt,
          status: 'failure'
        });
      } catch (logError) {
        console.warn('Failed to log usage for error.', logError);
      }
    }
    res.status(500).json({ error: 'LLM proxy failed' });
  }
});

/**
 * SESSION CLOSE (LOGGING ONLY)
 */
app.post('/api/session/close', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id : '';
    const endedAt = typeof req.body?.ended_at === 'string'
      ? req.body.ended_at
      : new Date().toISOString();
    const creditsUsed = Number(req.body?.client_estimate?.credits_used) || 0;

    await appendUsageEntry({
      user,
      requestId: crypto.randomUUID(),
      sessionId,
      eventType: 'session_close',
      intentType: 'session_close',
      model: '',
      inputTokens: 0,
      outputTokens: 0,
      inputChars: 0,
      outputChars: 0,
      totalTokens: 0,
      reservedCredits: creditsUsed,
      actualCredits: creditsUsed,
      creditsCharged: creditsUsed,
      latencyMs: 0,
      status: 'success',
      timestamp: endedAt
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Session close log failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to log session close' });
  }
});

/**
 * GOOGLE AUTH STUB
 */
app.post('/api/auth/google', async (req, res) => {
  try {
    const idToken = typeof req.body?.id_token === 'string' ? req.body.id_token.trim() : '';
    if (!idToken) {
      return res.status(400).json({ ok: false, error: 'Missing id_token' });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ ok: false, error: 'Missing GOOGLE_CLIENT_ID' });
    }
    const payload = decodeJwtPayload(idToken);
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ ok: false, error: 'Invalid audience' });
    }
    if (
      payload.iss !== 'https://accounts.google.com' &&
      payload.iss !== 'accounts.google.com'
    ) {
      return res.status(401).json({ ok: false, error: 'Invalid issuer' });
    }
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return res.status(401).json({ ok: false, error: 'Token expired' });
    }

    const user = await findOrCreateUser({
      email: payload.email,
      provider: 'google',
      providerUserId: payload.sub,
      displayName: payload.name
    });

    return issueSessionCookie(res, req, user);
  } catch (error) {
    console.error('Google auth error', error);
    return res.status(500).json({ ok: false, error: 'Google auth failed' });
  }
});

app.post('/api/auth/email/request', async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email required' });
    }
    if (!process.env.EMAIL_TOKEN_SECRET) {
      return res.status(500).json({ ok: false, error: 'Missing EMAIL_TOKEN_SECRET' });
    }

    const token = await createSignedToken(
      {
        sub: email,
        type: 'email_magic',
        exp: Math.floor(Date.now() / 1000) + 15 * 60
      },
      process.env.EMAIL_TOKEN_SECRET
    );

    const base = process.env.BACKEND_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base.replace(/\/$/, '')}/auth/email?token=${encodeURIComponent(token)}`;

    if (process.env.ENVIRONMENT === 'dev') {
      return res.json({ ok: true, debug_magic_link: link });
    }

    await sendMagicEmail(email, link);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Email magic link request failed.', error);
    return res.status(500).json({ ok: false, error: 'Failed to send magic link' });
  }
});

app.post('/api/auth/email/verify', async (req, res) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Missing token' });
    }
    if (!process.env.EMAIL_TOKEN_SECRET) {
      return res.status(500).json({ ok: false, error: 'Missing EMAIL_TOKEN_SECRET' });
    }
    const payload = await verifySignedToken(token, process.env.EMAIL_TOKEN_SECRET);
    if (!payload || payload.type !== 'email_magic' || !payload.sub) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }

    const user = await findOrCreateUser({
      email: payload.sub,
      provider: 'email',
      providerUserId: '',
      displayName: payload.sub.split('@')[0]
    });

    return issueSessionCookie(res, req, user);
  } catch (error) {
    console.error('Email token verification failed.', error);
    return res.status(500).json({ ok: false, error: 'Email verification failed' });
  }
});

app.get('/auth/email', async (req, res) => {
  try {
    const token = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }
    if (!process.env.EMAIL_TOKEN_SECRET) {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }
    const payload = await verifySignedToken(token, process.env.EMAIL_TOKEN_SECRET);
    if (!payload || payload.type !== 'email_magic' || !payload.sub) {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }

    const user = await findOrCreateUser({
      email: payload.sub,
      provider: 'email',
      providerUserId: '',
      displayName: payload.sub.split('@')[0]
    });

    issueSessionCookie(res, req, user, { redirect: true });
  } catch (error) {
    console.error('Email callback failed.', error);
    res.redirect(process.env.FRONTEND_URL || '/');
  }
});

app.post('/api/auth/apple', async (req, res) => {
  try {
    const idToken = typeof req.body?.id_token === 'string' ? req.body.id_token.trim() : '';
    if (!idToken) {
      return res.status(400).json({ ok: false, error: 'Missing id_token' });
    }
    if (!process.env.APPLE_CLIENT_ID) {
      return res.status(500).json({ ok: false, error: 'Missing APPLE_CLIENT_ID' });
    }
    const payload = decodeJwtPayload(idToken);
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
    if (payload.aud !== process.env.APPLE_CLIENT_ID) {
      return res.status(401).json({ ok: false, error: 'Invalid audience' });
    }
    if (payload.iss !== 'https://appleid.apple.com') {
      return res.status(401).json({ ok: false, error: 'Invalid issuer' });
    }
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return res.status(401).json({ ok: false, error: 'Token expired' });
    }

    const email = payload.email || `${payload.sub}@appleid.apple.com`;
    const user = await findOrCreateUser({
      email,
      provider: 'apple',
      providerUserId: payload.sub,
      displayName: payload.name || email.split('@')[0]
    });

    return issueSessionCookie(res, req, user);
  } catch (error) {
    console.error('Apple auth failed.', error);
    return res.status(500).json({ ok: false, error: 'Apple auth failed' });
  }
});

app.get('/checkout/subscription', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    const priceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
    if (!priceId) {
      return res.status(500).json({ ok: false, error: 'Missing subscription price id' });
    }

    const stripeSession = await createStripeCheckoutSession({
      mode: 'subscription',
      priceId,
      user,
      successUrl: process.env.STRIPE_SUCCESS_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`,
      cancelUrl: process.env.STRIPE_CANCEL_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
    });

    return res.redirect(303, stripeSession.url);
  } catch (error) {
    console.error('Subscription checkout failed.', error);
    return res.status(500).json({ ok: false, error: 'Checkout failed' });
  }
});

app.get('/checkout/credits', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const packKey = typeof req.query?.pack === 'string' ? req.query.pack : 'default';
    const pack = STRIPE_CREDIT_PACKS[packKey];
    if (!pack || !pack.price_id || !pack.credits) {
      return res.status(500).json({ ok: false, error: 'Credit pack not configured' });
    }

    const stripeSession = await createStripeCheckoutSession({
      mode: 'payment',
      priceId: pack.price_id,
      user,
      metadata: {
        purchase_type: 'credits',
        pack_key: packKey,
        credits: String(pack.credits)
      },
      successUrl: process.env.STRIPE_SUCCESS_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`,
      cancelUrl: process.env.STRIPE_CANCEL_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
    });

    return res.redirect(303, stripeSession.url);
  } catch (error) {
    console.error('Credits checkout failed.', error);
    return res.status(500).json({ ok: false, error: 'Checkout failed' });
  }
});

app.post('/api/stripe/webhook', async (req, res) => {
  try {
    const signature = req.header('stripe-signature');
    if (!signature) {
      return res.status(400).json({ ok: false, error: 'Missing stripe-signature' });
    }

    const event = verifyStripeSignature({
      rawBody: req.body.toString(),
      signatureHeader: signature,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
    });

    await handleStripeEvent(event);

    return res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook failed.', error);
    return res.status(400).json({ ok: false, error: 'Webhook failed' });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log('Maya API listening on', port);
});

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (padded.length % 4)) % 4);
  return Buffer.from(padded + padding, 'base64').toString('utf8');
}

function signHmac(data, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createSignedToken(payload, secret) {
  const data = JSON.stringify(payload);
  const signature = signHmac(data, secret);
  return `${base64UrlEncode(data)}.${signature}`;
}

async function verifySignedToken(token, secret) {
  if (!secret) return null;
  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) return null;
  const payloadJson = base64UrlDecode(payloadPart);
  const expected = signHmac(payloadJson, secret);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

function decodeJwtPayload(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function issueSessionCookie(res, req, user, options = {}) {
  if (!process.env.SESSION_SECRET) {
    res.status(500).json({ ok: false, error: 'Missing SESSION_SECRET' });
    return;
  }
  const token = await createSignedToken(
    {
      sub: user.user_id,
      email: user.email,
      provider: user.auth_provider,
      iat: Math.floor(Date.now() / 1000)
    },
    process.env.SESSION_SECRET
  );

  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=None'
  ];

  if (process.env.COOKIE_DOMAIN) {
    cookieParts.push(`Domain=${process.env.COOKIE_DOMAIN}`);
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));

  if (options.redirect) {
    res.redirect(process.env.FRONTEND_URL || '/');
    return;
  }

  res.json({
    token,
    user: mapUserForClient(user),
    session: {
      token,
      user: mapUserForClient(user)
    }
  });
}

async function getSessionFromRequest(req) {
  if (!process.env.SESSION_SECRET) {
    return null;
  }
  const cookieHeader = req.header('cookie') || '';
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!token) return null;
  const payload = await verifySignedToken(token, process.env.SESSION_SECRET);
  if (!payload) return null;
  return { token, ...payload };
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';');
  for (const entry of cookies) {
    const [key, ...rest] = entry.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return null;
}

function mapUserForClient(user) {
  const creditsRemainingRaw = resolveCreditsBalance(user);
  const creditsTotal = Number(user.credits_total ?? 0);
  const creditsRemaining = clampCredits(creditsRemainingRaw, creditsTotal);
  return {
    id: user.user_id,
    user_id: user.user_id,
    email: user.email,
    name: user.display_name || user.email?.split('@')[0] || 'User',
    provider: user.auth_provider,
    auth_providers: user.auth_providers
      ? String(user.auth_providers).split(',').map((entry) => entry.trim())
      : [user.auth_provider].filter(Boolean),
    created_at: user.created_at,
    plan: user.plan_tier,
    plan_tier: user.plan_tier,
    billing_status: user.billing_status,
    credits_remaining: creditsRemaining,
    credits_total: creditsTotal,
    monthly_reset_at: user.monthly_reset_at,
    daily_credit_limit: resolveDailyCreditLimit(user),
    creditsRemaining: creditsRemaining,
    creditsTotal: creditsTotal
  };
}

function clampCredits(remaining, total) {
  if (Number.isFinite(total) && total > 0) {
    return Math.max(0, Math.min(remaining, total));
  }
  return Math.max(0, remaining);
}

function buildPromptText(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  return messages
    .map((entry) => {
      const role = entry?.role ? String(entry.role) : 'user';
      const content = entry?.content;
      if (typeof content === 'string') {
        return `${role}:\n${content}`;
      }
      if (content === null || content === undefined) {
        return `${role}:`;
      }
      return `${role}:\n${JSON.stringify(content)}`;
    })
    .join('\n\n');
}

function capPromptText(promptText) {
  if (!promptText) {
    return promptText;
  }
  if (promptText.length > MAX_PROMPT_CHARS) {
    return `${promptText.slice(0, MAX_PROMPT_CHARS)}\n…[truncated]`;
  }
  return promptText;
}

function normalizeTurnIntent(intentType) {
  if (intentType === 'code') {
    return 'code';
  }
  if (intentType === 'mixed') {
    return 'mixed';
  }
  return 'text';
}

function estimateTokensFromChars(chars) {
  return Math.ceil((chars || 0) / 4);
}

function calculateCreditsUsed({ inputChars, outputChars, intentType, totalTokens }) {
  if (Number.isFinite(totalTokens)) {
    return Math.ceil(totalTokens / 250);
  }
  const inputTokens = estimateTokensFromChars(inputChars);
  const outputTokens = Math.ceil((outputChars || 0) / 3);
  const multiplier = intentType === 'code' ? 1.0 : 0.6;
  const tokenEstimate = Math.ceil((inputTokens + outputTokens) * multiplier);
  return Math.ceil(tokenEstimate / 250);
}

function resolveCreditsBalance(user) {
  const balance = Number(user?.credits_balance ?? user?.credits_remaining ?? 0);
  return Number.isFinite(balance) ? balance : 0;
}

function resolveDailyCreditLimit(user) {
  const limit = Number(user?.daily_credit_limit);
  if (Number.isFinite(limit)) {
    return limit;
  }
  return PLAN_DAILY_CAPS[user?.plan_tier] ?? null;
}

function formatCreditLedgerMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return '';
  }
  return Object.entries(metadata)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

async function readUsersCSV() {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    throw new Error('Missing GitHub credentials for users.csv');
  }
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const res = await githubRequest(`/repos/${repo}/contents/data/users.csv?ref=${branch}`);
  const content = Buffer.from(res.content, 'base64').toString('utf8');
  return { sha: res.sha, rows: parseCSV(content) };
}

async function writeUsersCSV(rows, sha, message) {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const csv = serializeCSV(rows);
  const encoded = Buffer.from(csv, 'utf8').toString('base64');

  await githubRequest(`/repos/${repo}/contents/data/users.csv`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: encoded,
      sha,
      branch
    })
  });
}

async function githubRequest(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'maya-api',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }
  return res.json();
}

function parseCSV(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split('\n');
  const headers = lines.shift().split(',');
  return lines.map((line) => {
    const values = line.split(',');
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = values[index] ?? '';
    });
    return entry;
  });
}

async function fetchCreditsUsedTodayForUser(userId) {
  const pool = getUsageAnalyticsPool();
  if (pool) {
    return fetchCreditsUsedToday({ userId });
  }

  const usageRows = await loadUsageLogRows();
  const todayKey = new Date().toISOString().slice(0, 10);
  return usageRows
    .filter((row) => row.user_id === userId && row.timestamp_utc?.startsWith(todayKey))
    .reduce((sum, row) => sum + Number(row.credits_charged || row.credits_used || 0), 0);
}

async function loadUsageLogRows() {
  try {
    const fileUrl = new URL('./data/usage_log.csv', import.meta.url);
    const text = await fs.readFile(fileUrl, 'utf8');
    return parseCSV(text);
  } catch {
    return [];
  }
}

async function loadArtifacts() {
  try {
    const text = await fs.readFile(ARTIFACTS_FILE, 'utf8');
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveArtifacts(rows) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ARTIFACTS_FILE, JSON.stringify(rows, null, 2));
}

async function loadProfiles() {
  try {
    const text = await fs.readFile(PROFILES_FILE, 'utf8');
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveProfiles(rows) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PROFILES_FILE, JSON.stringify(rows, null, 2));
}

async function loadArtifactVersions() {
  try {
    const text = await fs.readFile(ARTIFACT_VERSIONS_FILE, 'utf8');
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveArtifactVersions(rows) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ARTIFACT_VERSIONS_FILE, JSON.stringify(rows, null, 2));
}

async function buildProfileStats(userId) {
  const artifacts = await loadArtifacts();
  const owned = artifacts.filter((artifact) => artifact.owner_user_id === userId);
  const publicArtifacts = owned.filter((artifact) => artifact.visibility === 'public');
  const forksReceived = artifacts.filter((artifact) => artifact.derived_from?.owner_user_id === userId).length;
  return {
    public_artifacts: publicArtifacts.length,
    total_likes: owned.reduce((sum, artifact) => sum + (artifact?.stats?.likes || 0), 0),
    total_comments: owned.reduce((sum, artifact) => sum + (artifact?.stats?.comments || 0), 0),
    forks_received: forksReceived
  };
}

function applyArtifactDefaults(artifact) {
  if (!artifact) {
    return artifact;
  }
  const versioning = artifact.versioning || {
    enabled: false,
    chat_history_public: false
  };
  return {
    ...artifact,
    current_version_id: artifact.current_version_id || null,
    versioning,
    derived_from: {
      artifact_id: artifact?.derived_from?.artifact_id || null,
      owner_user_id: artifact?.derived_from?.owner_user_id || null,
      version_id: artifact?.derived_from?.version_id || null,
      version_label: artifact?.derived_from?.version_label || null
    }
  };
}

function buildArtifactVersion({ artifactId, code, chat, sourceSession, label, codeVersions }) {
  const versionId = crypto.randomUUID();
  const messages = Array.isArray(chat) && chat.length ? chat : null;
  const versions = Array.isArray(codeVersions) && codeVersions.length ? codeVersions : null;
  return {
    version_id: versionId,
    artifact_id: artifactId,
    session_id: String(sourceSession?.session_id || ''),
    created_at: new Date().toISOString(),
    label: label || null,
    code: {
      language: String(code?.language || 'html'),
      content: String(code?.content || '')
    },
    code_versions: versions,
    chat: {
      included: Boolean(messages),
      messages
    },
    stats: {
      turns: Array.isArray(messages) ? messages.length : 0,
      credits_used_estimate: Number(sourceSession?.credits_used_estimate || 0) || 0
    }
  };
}

function mapProfileForClient(profile, user, stats) {
  const demographics = profile.demographics || {};
  return {
    user_id: profile.user_id,
    handle: profile.handle,
    display_name: profile.display_name || user?.display_name || '',
    bio: profile.bio || '',
    avatar_url: profile.avatar_url || '',
    demographics,
    age: demographics.age ?? null,
    gender: demographics.gender || '',
    city: demographics.city || '',
    country: demographics.country || '',
    created_at: profile.created_at || user?.created_at || '',
    updated_at: profile.updated_at || profile.created_at || '',
    stats
  };
}

function mapPublicProfile(profile, user, stats) {
  const demographics = profile.demographics || {};
  return {
    handle: profile.handle,
    display_name: profile.display_name || user?.display_name || '',
    bio: profile.bio || '',
    avatar_url: profile.avatar_url || '',
    city: demographics.city || '',
    country: demographics.country || '',
    stats
  };
}

function validateArtifactPayload({ code, codeVersions, visibility, screenshotDataUrl }) {
  const errors = [];
  if (!code || !String(code.content || '').trim()) {
    errors.push('Code content is required.');
  }
  if (!Array.isArray(codeVersions) || codeVersions.length < 1) {
    errors.push('Code versions are required.');
  }
  if (!visibility || (visibility !== 'public' && visibility !== 'private')) {
    errors.push('Visibility must be public or private.');
  }
  if (screenshotDataUrl && typeof screenshotDataUrl === 'string') {
    if (!screenshotDataUrl.startsWith('data:image/png;base64,')) {
      errors.push('Screenshot must be a PNG data URL.');
    }
  } else if (screenshotDataUrl) {
    errors.push('Screenshot must be a PNG data URL.');
  }
  return { ok: errors.length === 0, errors };
}

function resolveScreenshotDataUrl(body) {
  if (body?.screenshot_data_url && typeof body.screenshot_data_url === 'string') {
    return body.screenshot_data_url;
  }
  const screenshot = body?.screenshot;
  if (!screenshot || typeof screenshot !== 'object') {
    return '';
  }
  if (screenshot.content_type !== 'image/png' || typeof screenshot.base64 !== 'string') {
    return '';
  }
  return `data:image/png;base64,${screenshot.base64}`;
}

function resolveArtifactCode(body) {
  if (body?.code && typeof body.code === 'object') {
    return {
      language: String(body.code.language || 'html'),
      content: String(body.code.content || '')
    };
  }
  const artifact = body?.artifact;
  if (artifact && typeof artifact === 'object') {
    return {
      language: String(artifact.language || 'html'),
      content: String(artifact.content || '')
    };
  }
  return null;
}

function resolveArtifactCodeVersions(body) {
  if (body?.code && typeof body.code === 'object' && Array.isArray(body.code.versions)) {
    return body.code.versions;
  }
  if (Array.isArray(body?.code_versions)) {
    return body.code_versions;
  }
  return [];
}

function buildChatPlusCodePrompt(messages = [], code = {}) {
  const recentUserMessages = messages
    .filter((entry) => entry?.role === 'user')
    .map((entry) => String(entry.content || '').trim())
    .filter(Boolean)
    .join('\n');
  const codeSnippet = typeof code?.content === 'string' ? code.content : '';
  return `You are generating metadata for a saved code artifact.

Use BOTH the user chat context and the code.

Return:
- A short, concrete title (max 60 chars)
- A one-sentence description (max 160 chars)

Chat:
${recentUserMessages}

Code:
${codeSnippet}

Output JSON ONLY:
{
  "title": "...",
  "description": "..."
}`;
}

function buildCodeOnlyPrompt(code = {}) {
  const codeLanguage = typeof code?.language === 'string' ? code.language : '';
  const codeSnippet = typeof code?.content === 'string' ? code.content : '';
  return `You are generating metadata for a saved code artifact.

There is NO chat context.
Infer intent and functionality from the code alone.

Code language: ${codeLanguage}

Code:
${codeSnippet}

Return JSON ONLY:
{
  "title": "...",
  "description": "..."
}`;
}

function buildMetadataResponse(result = {}, source = 'code-only') {
  const title = typeof result.title === 'string' ? result.title.trim() : '';
  const description = typeof result.description === 'string' ? result.description.trim() : '';
  const hasInferred = Boolean(title || description);
  return {
    ok: true,
    inferred: hasInferred,
    title: title || null,
    description: description || null,
    source
  };
}

function selectMetadataMessages(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }
  const normalized = messages
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      role: entry.role,
      content: String(entry.content || '')
    }))
    .filter((entry) => (entry.role === 'user' || entry.role === 'assistant') && entry.content.trim());
  if (!normalized.length) {
    return [];
  }
  const userIndices = [];
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (normalized[i].role === 'user') {
      userIndices.push(i);
    }
    if (userIndices.length >= 5) {
      break;
    }
  }
  let assistantIndex = -1;
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (normalized[i].role === 'assistant') {
      assistantIndex = i;
      break;
    }
  }
  const indices = new Set(userIndices);
  if (assistantIndex >= 0) {
    indices.add(assistantIndex);
  }
  if (!indices.size) {
    return normalized.slice(-5);
  }
  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((index) => normalized[index]);
}

async function persistArtifactScreenshot(dataUrl, artifactId) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return '';
  }
  const match = dataUrl.match(/^data:image\/png;base64,(.*)$/);
  if (!match) {
    return '';
  }
  await fs.mkdir(ARTIFACT_UPLOADS_DIR, { recursive: true });
  const buffer = Buffer.from(match[1], 'base64');
  const filename = `${artifactId}.png`;
  const filePath = path.join(ARTIFACT_UPLOADS_DIR, filename);
  await fs.writeFile(filePath, buffer);
  return `/uploads/artifacts/${filename}`;
}

async function persistProfileAvatar(file, userId) {
  if (!file?.data || !file?.contentType) {
    return '';
  }
  const extension = file.contentType.includes('jpeg')
    ? 'jpg'
    : file.contentType.includes('webp')
      ? 'webp'
      : 'png';
  await fs.mkdir(PROFILE_UPLOADS_DIR, { recursive: true });
  const filename = `${userId}-${Date.now()}.${extension}`;
  const filePath = path.join(PROFILE_UPLOADS_DIR, filename);
  await fs.writeFile(filePath, file.data);
  return `/uploads/profiles/${filename}`;
}

async function parseMultipartRequest(req) {
  const contentType = req.header('content-type') || '';
  if (!contentType.startsWith('multipart/form-data')) {
    return {
      fields: req.body || {},
      files: {}
    };
  }
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) {
    return { fields: {}, files: {} };
  }
  const boundary = boundaryMatch[1].replace(/^"|"$/g, '');
  const body = await readRequestBody(req);
  return parseMultipartFormData(body, boundary);
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartFormData(body, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, boundaryBuffer).slice(1, -1);
  const fields = {};
  const files = {};

  parts.forEach((part) => {
    const cleaned = trimBuffer(part);
    if (!cleaned.length) {
      return;
    }
    const headerEnd = cleaned.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) {
      return;
    }
    const headerText = cleaned.slice(0, headerEnd).toString('utf8');
    const content = cleaned.slice(headerEnd + 4);
    const dispositionMatch = headerText.match(/name="([^"]+)"/);
    if (!dispositionMatch) {
      return;
    }
    const name = dispositionMatch[1];
    const filenameMatch = headerText.match(/filename="([^"]*)"/);
    if (filenameMatch && filenameMatch[1]) {
      const contentTypeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
      files[name] = {
        filename: filenameMatch[1],
        contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
        data: trimTrailingNewline(content)
      };
      return;
    }
    fields[name] = trimTrailingNewline(content).toString('utf8');
  });

  return { fields, files };
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

function trimBuffer(buffer) {
  let start = 0;
  let end = buffer.length;
  if (buffer.slice(0, 2).toString() === '\r\n') {
    start = 2;
  }
  if (buffer.slice(-2).toString() === '\r\n') {
    end -= 2;
  }
  return buffer.slice(start, end);
}

function trimTrailingNewline(buffer) {
  if (buffer.slice(-2).toString() === '\r\n') {
    return buffer.slice(0, -2);
  }
  return buffer;
}

async function appendArtifactEvent({ eventType, userId, artifactId, sourceArtifactId, sessionId }) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(ARTIFACT_EVENTS_FILE);
  } catch {
    const header = 'timestamp_utc,event_type,user_id,artifact_id,source_artifact_id,session_id\n';
    await fs.writeFile(ARTIFACT_EVENTS_FILE, header);
  }
  const line = [
    new Date().toISOString(),
    eventType,
    userId,
    artifactId,
    sourceArtifactId,
    sessionId
  ].map((value) => csvEscape(value)).join(',') + '\n';
  await fs.appendFile(ARTIFACT_EVENTS_FILE, line);
}

function filterUsageRowsByRange({ rows, userId, days, startDate, endDate }) {
  const cutoff = Number.isFinite(days)
    ? Date.now() - days * 24 * 60 * 60 * 1000
    : null;
  return rows.filter((row) => {
    if (userId && row.user_id !== userId) {
      return false;
    }
    if (startDate) {
      const day = row.timestamp_utc?.slice(0, 10);
      if (day && day < startDate) {
        return false;
      }
    }
    if (endDate) {
      const day = row.timestamp_utc?.slice(0, 10);
      if (day && day > endDate) {
        return false;
      }
    }
    if (cutoff) {
      const timestamp = new Date(row.timestamp_utc).getTime();
      if (!Number.isFinite(timestamp) || timestamp < cutoff) {
        return false;
      }
    }
    return true;
  });
}

function parseRangeDays(value) {
  if (!value) return null;
  const match = String(value).match(/(\d+)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function filterUsageRowsByMonth(rows, reference = new Date()) {
  const monthKey = `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, '0')}`;
  return rows.filter((row) => row.timestamp_utc?.startsWith(monthKey));
}

function normalizeUsageRow(row) {
  return {
    timestamp_utc: row.timestamp_utc,
    session_id: row.session_id,
    request_id: row.request_id,
    intent_type: row.intent_type,
    model: row.model,
    input_tokens: Number(row.input_tokens || 0) || 0,
    output_tokens: Number(row.output_tokens || 0) || 0,
    credits_charged: Number(row.credits_charged || row.credits_used || 0) || 0,
    latency_ms: Number(row.latency_ms || 0) || 0,
    status: row.status || 'unknown'
  };
}

function mapUsageEventRow(row) {
  return {
    timestamp_utc: row.created_at,
    session_id: row.session_id,
    request_id: row.id || '',
    intent_type: row.intent,
    model: row.model,
    input_tokens: Number(row.tokens_in || 0) || 0,
    output_tokens: Number(row.tokens_out || 0) || 0,
    credits_charged: Number(row.credits_used || 0) || 0,
    credits_used: Number(row.credits_used || 0) || 0,
    latency_ms: Number(row.latency_ms || 0) || 0,
    status: row.success ? 'success' : 'failure'
  };
}

function buildUsageOverview(rows) {
  const totals = rows.reduce((acc, row) => {
    acc.totalRequests += 1;
    acc.totalCredits += Number(row.credits_charged || row.credits_used || 0) || 0;
    acc.totalLatency += Number(row.latency_ms || 0) || 0;
    acc.tokensIn += Number(row.input_tokens || 0) || 0;
    acc.tokensOut += Number(row.output_tokens || 0) || 0;
    if (row.status === 'success') {
      acc.successCount += 1;
    }
    return acc;
  }, {
    totalRequests: 0,
    totalCredits: 0,
    totalLatency: 0,
    tokensIn: 0,
    tokensOut: 0,
    successCount: 0
  });
  return {
    total_requests: totals.totalRequests,
    total_credits: totals.totalCredits,
    avg_latency_ms: totals.totalRequests ? totals.totalLatency / totals.totalRequests : 0,
    success_rate: totals.totalRequests ? totals.successCount / totals.totalRequests : 0,
    tokens_in: totals.tokensIn,
    tokens_out: totals.tokensOut
  };
}

function buildDailyUsageSummaries(rows, { includeEntries = false } = {}) {
  const map = new Map();
  rows.forEach((row) => {
    const date = row.timestamp_utc?.slice(0, 10);
    if (!date) {
      return;
    }
    if (!map.has(date)) {
      map.set(date, {
        date,
        total_requests: 0,
        total_credits: 0,
        avg_latency_ms: 0,
        success_rate: 0,
        by_intent: { code: 0, text: 0 },
        entries: []
      });
    }
    const daily = map.get(date);
    const intent = row.intent_type || 'text';
    daily.total_requests += 1;
    daily.total_credits += Number(row.credits_charged || row.credits_used || 0) || 0;
    daily.avg_latency_ms += Number(row.latency_ms || 0) || 0;
    daily.by_intent[intent] = (daily.by_intent[intent] || 0) + 1;
    if (row.status === 'success') {
      daily.success_rate += 1;
    }
    if (includeEntries) {
      daily.entries.push(normalizeUsageRow(row));
    }
  });

  return Array.from(map.values())
    .map((daily) => ({
      ...daily,
      avg_latency_ms: daily.total_requests ? daily.avg_latency_ms / daily.total_requests : 0,
      success_rate: daily.total_requests ? daily.success_rate / daily.total_requests : 0
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildSessionSummariesFromUsage(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const sessionId = row.session_id || 'session_unknown';
    if (!map.has(sessionId)) {
      map.set(sessionId, {
        session_id: sessionId,
        started_at: row.timestamp_utc,
        ended_at: row.timestamp_utc,
        turns: 0,
        credits_used: 0,
        tokens_in: 0,
        tokens_out: 0
      });
    }
    const summary = map.get(sessionId);
    summary.turns += 1;
    summary.credits_used += Number(row.credits_charged || row.credits_used || 0) || 0;
    summary.tokens_in += Number(row.input_tokens || 0) || 0;
    summary.tokens_out += Number(row.output_tokens || 0) || 0;
    if (row.timestamp_utc < summary.started_at) {
      summary.started_at = row.timestamp_utc;
    }
    if (row.timestamp_utc > summary.ended_at) {
      summary.ended_at = row.timestamp_utc;
    }
  });
  return Array.from(map.values()).sort((a, b) => {
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
  });
}

function serializeCSV(rows) {
  const headers = REQUIRED_USER_HEADERS;
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
  ];
  return `${lines.join('\n')}\n`;
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[,"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function getUserById(userId) {
  const { rows } = await readUsersCSV();
  return rows.find((row) => row.user_id === userId) || null;
}

async function findOrCreateUser({ email, provider, providerUserId, displayName }) {
  const normalizedEmail = email?.toLowerCase() || '';
  const { sha, rows } = await readUsersCSV();

  let user = rows.find((row) => row.provider_user_id === providerUserId && row.auth_provider === provider);
  if (!user && normalizedEmail) {
    user = rows.find((row) => row.email === normalizedEmail);
  }

  const now = new Date().toISOString();

  if (!user) {
    user = {
      user_id: crypto.randomUUID(),
      email: normalizedEmail,
      auth_provider: provider,
      provider_user_id: providerUserId,
      display_name: displayName || normalizedEmail.split('@')[0],
      created_at: now,
      last_login_at: now,
      plan_tier: FREE_PLAN.tier,
      credits_total: String(FREE_PLAN.monthly_credits),
      credits_remaining: String(FREE_PLAN.monthly_credits),
      credits_balance: String(FREE_PLAN.monthly_credits),
      daily_credit_limit: String(PLAN_DAILY_CAPS[FREE_PLAN.tier] ?? ''),
      credits_last_reset: new Date().toISOString(),
      monthly_reset_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      newsletter_opt_in: 'true',
      account_status: 'active',
      stripe_customer_id: '',
      stripe_subscription_id: '',
      billing_status: 'active'
    };
    rows.push(user);
  } else {
    user.email = normalizedEmail || user.email;
    user.auth_provider = provider;
    user.provider_user_id = providerUserId || user.provider_user_id;
    user.display_name = displayName || user.display_name;
    user.last_login_at = now;
  }

  await writeUsersCSV(rows, sha, `auth: update user ${user.user_id}`);
  return user;
}

async function updateUser(userId, patch) {
  const { sha, rows } = await readUsersCSV();
  const user = rows.find((row) => row.user_id === userId);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }
  Object.entries(patch).forEach(([key, value]) => {
    user[key] = value;
  });
  await writeUsersCSV(rows, sha, `billing: update user ${userId}`);
  return user;
}

async function routeModelForUser({ user, intentType, requestedModel, sessionId }) {
  const pool = getUsageAnalyticsPool();
  if (!pool) {
    return { model: requestedModel, reason: 'policy_default' };
  }

  const plan = user.plan_tier || 'free';
  const policy = await fetchPlanPolicy({ plan, intentType });
  if (!policy) {
    return { model: requestedModel, reason: 'policy_default' };
  }

  let reason = 'policy_default';
  let candidate = requestedModel && policy.allowed_models?.includes(requestedModel)
    ? requestedModel
    : policy.preferred_models?.[0];

  if (candidate && !(policy.allowed_models || []).includes(candidate)) {
    candidate = policy.allowed_models?.[0];
  }

  if (candidate && await isPremiumModel(candidate) && !policy.premium_allowed) {
    const nonPremium = await fetchFirstNonPremiumModel([
      ...(policy.preferred_models || []),
      ...(policy.allowed_models || [])
    ]);
    if (nonPremium) {
      candidate = nonPremium;
      reason = 'premium_blocked';
    }
  }

  const quota = await fetchMonthlyQuota({ userId: user.user_id, plan });
  const usageRatio = quota?.monthly_credits
    ? Number(quota.normalized_credits_used || 0) / Number(quota.monthly_credits)
    : 0;

  if (policy.allow_fallback && usageRatio >= 0.9) {
    const cheapest = await fetchCheapestAllowedModel(policy.allowed_models || []);
    if (cheapest) {
      candidate = cheapest;
      reason = 'quota_fallback';
    }
  }

  if (candidate && !(policy.allowed_models || []).includes(candidate)) {
    candidate = policy.allowed_models?.[policy.allowed_models.length - 1];
    reason = 'policy_default';
  }

  if (candidate) {
    await insertRouteDecision({
      userId: user.user_id,
      sessionId,
      intentType,
      requestedModel,
      routedModel: candidate,
      reason,
      plan
    });
  }

  return { model: candidate || requestedModel, reason };
}

async function appendUsageEntry({
  user,
  requestId,
  sessionId,
  eventType,
  intentType,
  model,
  inputTokens,
  outputTokens,
  inputChars,
  outputChars,
  totalTokens,
  reservedCredits,
  actualCredits,
  creditsCharged,
  latencyMs,
  status,
  timestamp
}) {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    return;
  }

  const timestampValue = timestamp || new Date().toISOString();
  const entry = {
    timestamp_utc: timestampValue,
    user_id: user.user_id,
    email: user.email,
    session_id: sessionId,
    event_type: eventType,
    request_id: requestId,
    intent_type: intentType,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    input_chars: inputChars,
    input_est_tokens: '',
    output_chars: outputChars,
    output_est_tokens: '',
    total_est_tokens: totalTokens,
    estimated_credits: reservedCredits,
    reserved_credits: reservedCredits,
    actual_credits: actualCredits,
    refunded_credits: 0,
    credits_charged: creditsCharged,
    credits_used: creditsCharged,
    latency_ms: latencyMs ?? '',
    status
  };

  if (eventType !== 'session_close') {
    const planTier = user.plan_tier || 'free';
    const [pricing, creditNormFactorRaw] = await Promise.all([
      fetchModelPricing({ model }),
      fetchPlanNormalizationFactor({ plan: planTier })
    ]);
    const creditNormFactor = Number.isFinite(Number(creditNormFactorRaw))
      ? Number(creditNormFactorRaw)
      : 1;
    const inputTokenValue = Number(inputTokens) || 0;
    const outputTokenValue = Number(outputTokens) || 0;
    const modelCostUsd = pricing
      ? (
        (inputTokenValue / 1000) * Number(pricing.cost_per_1k_input_tokens)
        + (outputTokenValue / 1000) * Number(pricing.cost_per_1k_output_tokens)
      ) * Number(pricing.credit_multiplier)
      : 0;
    await insertUsageEvent({
      userId: user.user_id,
      sessionId: sessionId || crypto.randomUUID(),
      intentType,
      model,
      inputTokens: inputTokenValue,
      outputTokens: outputTokenValue,
      creditsUsed: creditsCharged,
      creditNormFactor,
      modelCostUsd,
      latencyMs: latencyMs ?? 0,
      success: status === 'success'
    });
  }

  const { appendUsageLog } = await import('./api/usageLog.js');
  await appendUsageLog(process.env, entry);
}

async function findCreditLedgerEntry({ userId, turnId, reason }) {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO || !turnId) {
    return null;
  }

  try {
    const { content } = await readCreditLedger(process.env);
    const rows = parseCreditLedger(content);
    return rows.find((row) => {
      return row.user_id === userId && row.turn_id === turnId && row.reason === reason;
    }) || null;
  } catch (error) {
    console.warn('Failed to read credit ledger.', error);
    return null;
  }
}

async function appendCreditLedgerEntry(entry) {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    return;
  }

  try {
    await appendCreditLedger(process.env, entry);
  } catch (error) {
    console.warn('Failed to append credit ledger entry.', error);
  }
}

async function applyCreditDeduction({
  userId,
  sessionId,
  turnId,
  creditsToCharge,
  creditsTotal,
  metadata,
  reason = 'llm_usage'
}) {
  if (!Number.isFinite(creditsToCharge) || creditsToCharge <= 0) {
    return { nextBalance: resolveCreditsBalance(await getUserById(userId)), alreadyCharged: false };
  }

  const existing = await findCreditLedgerEntry({ userId, turnId, reason });
  if (existing) {
    const balanceAfter = Number(existing.balance_after);
    const resolvedBalance = Number.isFinite(balanceAfter)
      ? balanceAfter
      : resolveCreditsBalance(await getUserById(userId));
    if (Number.isFinite(balanceAfter)) {
      await updateUser(userId, {
        credits_balance: String(balanceAfter),
        credits_remaining: String(balanceAfter)
      });
    }
    return { nextBalance: resolvedBalance, alreadyCharged: true };
  }

  const freshUser = await getUserById(userId);
  if (!freshUser) {
    throw new Error(`User ${userId} not found`);
  }
  const currentBalance = resolveCreditsBalance(freshUser);
  if (currentBalance < creditsToCharge) {
    throw new Error('INSUFFICIENT_CREDITS');
  }
  const nextBalance = clampCredits(currentBalance - creditsToCharge, creditsTotal);

  await updateUser(userId, {
    credits_balance: String(nextBalance),
    credits_remaining: String(nextBalance)
  });

  await appendCreditLedgerEntry({
    timestamp_utc: new Date().toISOString(),
    user_id: userId,
    session_id: sessionId || '',
    turn_id: turnId || '',
    delta: -creditsToCharge,
    balance_after: nextBalance,
    reason,
    metadata: formatCreditLedgerMetadata(metadata)
  });

  return { nextBalance, alreadyCharged: false };
}

async function sendMagicEmail(email, link) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Missing RESEND_API_KEY');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.MAGIC_EMAIL_FROM || 'Maya <auth@primarydesignco.com>',
      to: email,
      subject: 'Sign in to Maya',
      html: `
        <p>Click to sign in:</p>
        <p><a href="${link}">Sign in to Maya</a></p>
        <p>This link expires in 15 minutes.</p>
      `
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send email: ${text}`);
  }
}

async function createStripeCheckoutSession({ mode, priceId, user, metadata = {}, successUrl, cancelUrl }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }

  const params = new URLSearchParams();
  params.set('mode', mode);
  params.set('success_url', `${successUrl.replace(/\/$/, '')}/?checkout=success`);
  params.set('cancel_url', `${cancelUrl.replace(/\/$/, '')}/?checkout=cancel`);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('client_reference_id', user.user_id);
  params.set('metadata[user_id]', user.user_id);

  Object.entries(metadata).forEach(([key, value]) => {
    params.set(`metadata[${key}]`, value);
  });

  if (user.stripe_customer_id) {
    params.set('customer', user.stripe_customer_id);
  } else {
    params.set('customer_email', user.email);
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stripe checkout failed: ${text}`);
  }

  return response.json();
}

async function createStripeBillingPortalSession({ customerId, returnUrl }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  const params = new URLSearchParams();
  params.set('customer', customerId);
  params.set('return_url', returnUrl);

  const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stripe billing portal failed: ${text}`);
  }

  return response.json();
}

function verifyStripeSignature({ rawBody, signatureHeader, webhookSecret }) {
  if (!webhookSecret) {
    throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  }
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const [key, value] = kv.split('=');
      return [key, value];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    throw new Error('Invalid signature header');
  }
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  if (!timingSafeEqual(signature, expected)) {
    throw new Error('Bad signature');
  }
  const toleranceSec = 5 * 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) {
    throw new Error('Timestamp outside tolerance');
  }
  return JSON.parse(rawBody);
}

async function handleStripeEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutSessionCompleted(event.data.object);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await onSubscriptionUpsert(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await onInvoicePaymentSucceeded(event.data.object);
      break;
    case 'invoice.payment_failed':
      await onInvoicePaymentFailed(event.data.object);
      break;
    default:
      break;
  }
}

async function onCheckoutSessionCompleted(session) {
  const userId = session.metadata?.user_id || session.client_reference_id;
  if (!userId) {
    throw new Error('Missing user_id');
  }

  const patch = {
    stripe_customer_id: session.customer || '',
    stripe_subscription_id: session.subscription || '',
    billing_status: 'active'
  };

  const purchaseType = session.metadata?.purchase_type;
  if (purchaseType === 'credits') {
    const credits = Number(session.metadata?.credits || 0);
    if (Number.isFinite(credits) && credits > 0) {
      const user = await getUserById(userId);
      if (user) {
        const nextRemaining = resolveCreditsBalance(user) + credits;
        patch.credits_remaining = String(nextRemaining);
        patch.credits_balance = String(nextRemaining);
      }
    }
  }

  await updateUser(userId, patch);
}

async function onSubscriptionUpsert(subscription) {
  const stripeCustomerId = subscription.customer;
  const stripeSubscriptionId = subscription.id;
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const plan = STRIPE_PLAN_MAP[priceId] || FREE_PLAN;
  const user = await findUserByStripeCustomer(stripeCustomerId);
  if (!user) {
    throw new Error(`No user for stripe_customer_id=${stripeCustomerId}`);
  }

  await updateUser(user.user_id, {
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    plan_tier: plan.tier,
    credits_total: String(plan.monthly_credits || FREE_PLAN.monthly_credits),
    credits_balance: String(resolveCreditsBalance(user)),
    daily_credit_limit: String(PLAN_DAILY_CAPS[plan.tier] ?? ''),
    billing_status: normalizeStripeSubStatus(subscription.status)
  });
}

async function onSubscriptionDeleted(subscription) {
  const stripeCustomerId = subscription.customer;
  const user = await findUserByStripeCustomer(stripeCustomerId);
  if (!user) return;

  const remaining = Math.min(
    resolveCreditsBalance(user),
    FREE_PLAN.monthly_credits
  );

  await updateUser(user.user_id, {
    billing_status: 'canceled',
    plan_tier: 'free',
    credits_total: String(FREE_PLAN.monthly_credits),
    credits_remaining: String(remaining),
    credits_balance: String(remaining),
    daily_credit_limit: String(PLAN_DAILY_CAPS.free ?? '')
  });
}

async function onInvoicePaymentSucceeded(invoice) {
  const stripeCustomerId = invoice.customer;
  const user = await findUserByStripeCustomer(stripeCustomerId);
  if (!user) return;

  const nextResetAt = invoice.lines?.data?.[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  await updateUser(user.user_id, {
    billing_status: 'active',
    credits_remaining: String(user.credits_total || FREE_PLAN.monthly_credits),
    credits_balance: String(user.credits_total || FREE_PLAN.monthly_credits),
    monthly_reset_at: nextResetAt
  });
}

async function onInvoicePaymentFailed(invoice) {
  const stripeCustomerId = invoice.customer;
  const user = await findUserByStripeCustomer(stripeCustomerId);
  if (!user) return;

  await updateUser(user.user_id, {
    billing_status: 'past_due'
  });
}

async function findUserByStripeCustomer(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const { rows } = await readUsersCSV();
  return rows.find((row) => row.stripe_customer_id === stripeCustomerId) || null;
}

function normalizeStripeSubStatus(status) {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  return 'canceled';
}
