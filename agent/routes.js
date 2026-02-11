import express from 'express';
import {
  createAgentRun,
  getAgentRunById,
  getFindingsByRunId,
  getFindingById,
  insertAgentFindings,
  markAgentRunFinished
} from './store.js';
import { runSimulatedAgentChecks } from './simulatedRunner.js';
import { buildCodexPatchPlan } from './codexPlan.js';

export function createAgentRouter({ getSessionFromRequest, verifyStripeSignature }) {
  const router = express.Router();

  router.post('/runs', async (req, res) => {
    try {
      const session = await getSessionFromRequest(req);
      if (!session) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }

      const target = String(req.body?.target || 'api');
      const configJson = req.body?.config_json && typeof req.body.config_json === 'object'
        ? req.body.config_json
        : {};
      const shouldRunSimulated = req.body?.simulate !== false;

      const run = await createAgentRun({
        userId: session.sub,
        target,
        configJson
      });

      let insertedFindings = [];
      let completedRun = run;
      let simulationSummary = null;
      if (shouldRunSimulated) {
        const simulation = await runSimulatedAgentChecks({
          verifyStripeSignature,
          authRoutes: ['/api/auth/google', '/api/auth/email/request', '/api/auth/logout'],
          authRateLimitEnabled: true,
          analyticsEndpoint: '/admin/usage/summary',
          stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'test_webhook_secret'
        });
        simulationSummary = simulation.summary;
        insertedFindings = await insertAgentFindings({
          runId: run.id,
          findings: simulation.findings
        });
        completedRun = await markAgentRunFinished({ runId: run.id, status: 'completed' });
      }

      return res.status(201).json({
        ok: true,
        run: completedRun,
        findings_count: insertedFindings.length,
        simulation_summary: simulationSummary
      });
    } catch (error) {
      console.error('Failed to create agent run.', error);
      return res.status(500).json({ ok: false, error: 'Failed to create agent run' });
    }
  });

  router.get('/runs/:id', async (req, res) => {
    try {
      const session = await getSessionFromRequest(req);
      if (!session) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const run = await getAgentRunById({ runId: req.params.id, userId: session.sub });
      if (!run) {
        return res.status(404).json({ ok: false, error: 'Run not found' });
      }
      return res.json({ ok: true, run });
    } catch (error) {
      console.error('Failed to fetch agent run.', error);
      return res.status(500).json({ ok: false, error: 'Failed to fetch agent run' });
    }
  });

  router.get('/runs/:id/findings', async (req, res) => {
    try {
      const session = await getSessionFromRequest(req);
      if (!session) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const findings = await getFindingsByRunId({ runId: req.params.id, userId: session.sub });
      return res.json({ ok: true, findings });
    } catch (error) {
      console.error('Failed to fetch run findings.', error);
      return res.status(500).json({ ok: false, error: 'Failed to fetch run findings' });
    }
  });

  router.get('/findings/:id/codex', async (req, res) => {
    try {
      const session = await getSessionFromRequest(req);
      if (!session) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const finding = await getFindingById({ findingId: req.params.id, userId: session.sub });
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
