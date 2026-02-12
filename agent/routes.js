import express from 'express';
import {
  createAgentRun,
  getAgentRunById,
  getAgentRunByIdAny,
  getFindingsByRunId,
  getFindingById,
  insertAgentFindings,
  listAgentEventsAfter,
  listAgentRunsByUserId,
  markAgentRunFinished
} from './store.js';
import { runSimulatedAgentChecks } from './simulatedRunner.js';
import { buildCodexPatchPlan } from './codexPlan.js';
import { appendEvent } from './events.js';

function serializeRunForList(run) {
  return {
    id: run.id,
    status: run.status,
    active: run.active,
    phase: run.phase,
    startedAt: run.started_at,
    updatedAt: run.updated_at,
    lastEventId: run.last_event_id || 0
  };
}

function serializeRunSnapshot(run) {
  return {
    ...serializeRunForList(run),
    userId: run.user_id,
    partialOutput: run.partial_output || null
  };
}

export function createAgentRouter({ getSessionFromRequest, verifyStripeSignature, store = {} }) {
  const router = express.Router();
  const db = {
    createAgentRun: store.createAgentRun || createAgentRun,
    getAgentRunById: store.getAgentRunById || getAgentRunById,
    getAgentRunByIdAny: store.getAgentRunByIdAny || getAgentRunByIdAny,
    listAgentEventsAfter: store.listAgentEventsAfter || listAgentEventsAfter,
    listAgentRunsByUserId: store.listAgentRunsByUserId || listAgentRunsByUserId,
    appendEvent: store.appendEvent || appendEvent,
    getFindingsByRunId: store.getFindingsByRunId || getFindingsByRunId,
    getFindingById: store.getFindingById || getFindingById,
    insertAgentFindings: store.insertAgentFindings || insertAgentFindings,
    markAgentRunFinished: store.markAgentRunFinished || markAgentRunFinished
  };

  async function requireAuth(req, res, next) {
    try {
      const session = await getSessionFromRequest(req);
      if (!session) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      req.user = session;
      return next();
    } catch (error) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  async function loadOwnedRun(req, res, next) {
    const run = await db.getAgentRunByIdAny({ runId: req.params.id });
    if (!run) {
      return res.status(404).json({ ok: false, error: 'Run not found' });
    }
    if (!req.user?.sub || run.user_id !== req.user.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    req.agentRun = run;
    return next();
  }

  router.get('/runs', requireAuth, async (req, res) => {
    try {
      const runs = await db.listAgentRunsByUserId({ userId: req.user.sub });
      return res.json({ ok: true, runs: runs.map(serializeRunForList) });
    } catch (error) {
      console.error('Failed to list agent runs.', error);
      return res.status(500).json({ ok: false, error: 'Failed to list runs' });
    }
  });

  router.get('/runs/:id', requireAuth, loadOwnedRun, async (req, res) => {
    return res.json({
      ok: true,
      run: serializeRunSnapshot(req.agentRun),
      lastEventId: req.agentRun.last_event_id || 0
    });
  });

  router.get('/runs/:id/events', requireAuth, loadOwnedRun, async (req, res) => {
    try {
      const after = Math.max(0, Number(req.query.after || 0));
      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 500)));
      const events = await db.listAgentEventsAfter({ runId: req.agentRun.id, after, limit });
      const maxId = events.length > 0 ? events[events.length - 1].id : req.agentRun.last_event_id || 0;
      return res.json({ ok: true, events, lastEventId: maxId });
    } catch (error) {
      console.error('Failed to load run events.', error);
      return res.status(500).json({ ok: false, error: 'Failed to load run events' });
    }
  });

  router.post('/runs', requireAuth, async (req, res) => {
    try {
      const target = String(req.body?.target || 'api');
      const configJson = req.body?.config_json && typeof req.body.config_json === 'object'
        ? req.body.config_json
        : {};
      const shouldRunSimulated = req.body?.simulate !== false;

      const run = await db.createAgentRun({ userId: req.user.sub, target, configJson });
      const firstEvent = await db.appendEvent({
        runId: run.id,
        userId: req.user.sub,
        type: 'AGENT_START',
        payload: { target }
      });

      if (shouldRunSimulated) {
        const simulation = await runSimulatedAgentChecks({
          verifyStripeSignature,
          authRoutes: ['/api/auth/google', '/api/auth/email/request', '/api/auth/logout'],
          authRateLimitEnabled: true,
          analyticsEndpoint: '/admin/usage/summary',
          stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'test_webhook_secret'
        });
        await db.insertAgentFindings({ runId: run.id, findings: simulation.findings });
        await db.appendEvent({ runId: run.id, userId: req.user.sub, type: 'AGENT_COMPLETE', payload: {} });
        await db.markAgentRunFinished({ runId: run.id, status: 'COMPLETED' });
      }

      const current = await db.getAgentRunById({ runId: run.id, userId: req.user.sub });
      return res.status(201).json({
        ok: true,
        run: serializeRunSnapshot(current),
        lastEventId: firstEvent.id
      });
    } catch (error) {
      console.error('Failed to create agent run.', error);
      return res.status(500).json({ ok: false, error: 'Failed to create agent run' });
    }
  });

  router.post('/runs/:id/cancel', requireAuth, loadOwnedRun, async (req, res) => {
    try {
      await db.appendEvent({ runId: req.agentRun.id, userId: req.user.sub, type: 'AGENT_CANCEL', payload: {} });
      return res.json({ ok: true });
    } catch (error) {
      console.error('Failed to cancel run.', error);
      return res.status(500).json({ ok: false, error: 'Failed to cancel run' });
    }
  });

  router.get('/runs/:id/findings', requireAuth, loadOwnedRun, async (req, res) => {
    try {
      const findings = await db.getFindingsByRunId({ runId: req.params.id, userId: req.user.sub });
      return res.json({ ok: true, findings });
    } catch (error) {
      console.error('Failed to fetch run findings.', error);
      return res.status(500).json({ ok: false, error: 'Failed to fetch run findings' });
    }
  });

  router.get('/findings/:id/codex', requireAuth, async (req, res) => {
    try {
      const finding = await db.getFindingById({ findingId: req.params.id, userId: req.user.sub });
      if (!finding) {
        return res.status(404).json({ ok: false, error: 'Finding not found' });
      }

      const plan = buildCodexPatchPlan(finding);
      return res.json({ ok: true, finding_id: finding.id, codex_patch_plan: plan });
    } catch (error) {
      console.error('Failed to generate codex patch plan.', error);
      return res.status(500).json({ ok: false, error: 'Failed to generate codex patch plan' });
    }
  });

  return router;
}
