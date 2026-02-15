import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExecutionGraph from './ExecutionGraph';
import PRMonitor from './PRMonitor';
import PolicyPanel from './PolicyPanel';
import BudgetPanel from './BudgetPanel';
import DiffInspectionPanel from './DiffInspectionPanel';
import DualDiffPanel from './DualDiffPanel';
import { analyzeFileSemanticDiff } from './semanticDiff';
import { useAgentSocket } from './useAgentSocket';
import type { AgentEvent, AgentRunResponse, PRTaskResult, TaskGraph } from './types';
import { requireApiBase } from '../config/runtime';

export default function AgentsPanel() {
  const [graph, setGraph] = useState<TaskGraph | null>(null);
  const [results, setResults] = useState<PRTaskResult[]>([]);
  const [budget, setBudget] = useState<AgentRunResponse['budget']>();
  const [eventLog, setEventLog] = useState<AgentEvent[]>([]);
  const [timelineIndex, setTimelineIndex] = useState<number>(0);
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);
  const [compareIndexA, setCompareIndexA] = useState<number | null>(null);
  const [compareIndexB, setCompareIndexB] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [mergedTaskEvent, setMergedTaskEvent] = useState<{ taskId: string; nonce: number } | null>(null);
  const previousDerivedStateRef = useRef<Record<string, string>>({});

  const recordEvent = useCallback((event: Omit<AgentEvent, 'timestamp'>) => {
    setEventLog((prev) => [...prev, { ...event, timestamp: Date.now() }]);
  }, []);

  const reconstructState = useCallback(
    (index: number) => {
      const state: Record<string, string> = {};

      for (let i = 0; i <= index && i < eventLog.length; i += 1) {
        const event = eventLog[i];

        if (event.type === 'initial') {
          state[event.task_id] = event.status || 'created';
        }

        if (event.type === 'ci') {
          if (event.status === 'in_progress') state[event.task_id] = 'running';
          if (event.conclusion === 'failure') state[event.task_id] = 'blocked';
          if (event.conclusion === 'success') state[event.task_id] = 'ci_green';
        }

        if (event.type === 'pr' && event.merged) {
          state[event.task_id] = 'merged';
        }
      }

      return state;
    },
    [eventLog]
  );

  const derivedTaskStates = useMemo(() => reconstructState(timelineIndex), [reconstructState, timelineIndex]);

  const orderedCompareIndexes = useMemo(() => {
    if (compareIndexA === null || compareIndexB === null) return null;
    return {
      a: Math.min(compareIndexA, compareIndexB),
      b: Math.max(compareIndexA, compareIndexB)
    };
  }, [compareIndexA, compareIndexB]);

  const reconstructRepoState = useCallback(
    (index: number) => {
      const repo: Record<string, string> = {};

      for (let i = 0; i <= index && i < eventLog.length; i += 1) {
        const event = eventLog[i];

        if (event.diff?.files) {
          event.diff.files.forEach((file) => {
            repo[file.path] = file.after ?? '';
          });
        }
      }

      return repo;
    },
    [eventLog]
  );

  const computeSnapshotDiff = useCallback(
    (a: number, b: number) => {
      const stateA = reconstructRepoState(a);
      const stateB = reconstructRepoState(b);

      const allPaths = new Set([...Object.keys(stateA), ...Object.keys(stateB)]);

      return Array.from(allPaths).reduce<
        Array<{ path: string; before: string; after: string; semantic: ReturnType<typeof analyzeFileSemanticDiff> }>
      >((diffs, path) => {
        const before = stateA[path] || '';
        const after = stateB[path] || '';

        if (before !== after) {
          diffs.push({ path, before, after, semantic: analyzeFileSemanticDiff(path, before, after) });
        }

        return diffs;
      }, []);
    },
    [reconstructRepoState]
  );

  const runAgents = useCallback(async () => {
    const response = await fetch(`${requireApiBase()}/api/agent/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective: 'create something cool',
        constraints: { risk: 'medium' }
      })
    });

    let data: AgentRunResponse;
    try {
      data = await response.json();
    } catch {
      throw new Error('Server returned invalid JSON');
    }

    if (!response.ok) {
      throw new Error((data as { error?: string })?.error || 'Run failed');
    }

    setGraph(data.task_graph);
    setResults(data.tasks);
    setBudget(data.budget);
    setEventLog([]);
    setTimelineIndex(0);
    setSelectedEventIndex(null);
    setCompareIndexA(null);
    setCompareIndexB(null);
    setCompareMode(false);
    setIsPlaying(false);
    setMergedTaskEvent(null);
    previousDerivedStateRef.current = {};

    data.tasks.forEach((result) => {
      if (!result.status) return;

      recordEvent({
        type: 'initial',
        task_id: result.task_id,
        status: result.status,
        pr_number: result.pr_number,
        pr_url: result.pr_url,
        policy: result.policy
          ? { reasons: result.policy.reasons, risk_level: result.policy.risk_level }
          : undefined,
        diff: (result as PRTaskResult & { diff?: AgentEvent['diff'] }).diff
      });
    });
  }, [recordEvent]);

  const handleCIUpdate = useCallback(
    (ci: any) => {
      if (!ci.task_id) return;
      recordEvent({
        type: 'ci',
        task_id: ci.task_id,
        status: ci.status,
        conclusion: ci.conclusion
      });
    },
    [recordEvent]
  );

  const handlePRUpdate = useCallback(
    (pr: any) => {
      if (!pr.task_id) return;

      if (pr.policy?.reasons?.length) {
        recordEvent({
          type: 'policy',
          task_id: pr.task_id,
          policy: {
            reasons: pr.policy.reasons,
            risk_level: pr.policy.risk_level || 'unknown'
          },
          pr_number: pr.pr_number,
          pr_url: pr.pr_url
        });
      }

      recordEvent({
        type: 'pr',
        task_id: pr.task_id,
        merged: pr.merged,
        pr_number: pr.pr_number,
        pr_url: pr.pr_url,
        diff: pr.diff
      });
    },
    [recordEvent]
  );

  useAgentSocket(handleCIUpdate, handlePRUpdate);

  useEffect(() => {
    if (!eventLog.length) {
      setTimelineIndex(0);
      setSelectedEventIndex(null);
      setCompareIndexA(null);
      setCompareIndexB(null);
      return;
    }

    setTimelineIndex((prev) => (prev >= eventLog.length - 2 ? eventLog.length - 1 : prev));
  }, [eventLog.length]);

  useEffect(() => {
    if (!eventLog.length) {
      setSelectedEventIndex(null);
      return;
    }

    setSelectedEventIndex((prev) => {
      if (prev === null) return timelineIndex;
      return Math.min(prev, eventLog.length - 1);
    });
  }, [eventLog.length, timelineIndex]);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setTimelineIndex((prev) => {
        if (prev >= eventLog.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isPlaying, eventLog.length]);

  useEffect(() => {
    Object.entries(derivedTaskStates).forEach(([taskId, state]) => {
      if (state === 'merged' && previousDerivedStateRef.current[taskId] !== 'merged') {
        setMergedTaskEvent({ taskId, nonce: Date.now() + Math.random() });
      }
    });

    previousDerivedStateRef.current = derivedTaskStates;
  }, [derivedTaskStates]);

  return (
    <div className="agents-panel">
      <button onClick={runAgents}>Run via Agents</button>

      {graph && (
        <div className="agents-layout">
          <div className="agents-graph-wrap">
            <ExecutionGraph tasks={graph.tasks} taskStates={derivedTaskStates} mergedTaskEvent={mergedTaskEvent} />
            <div style={{ marginTop: 20 }}>
              <button
                onClick={() => {
                  setIsPlaying(false);
                  setTimelineIndex((prev) => {
                    const next = Math.max(prev - 1, 0);
                    setSelectedEventIndex(next);
                    return next;
                  });
                }}
              >
                ◀ Step
              </button>
              <button onClick={() => setIsPlaying((playing) => !playing)} style={{ marginLeft: 8 }}>
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                onClick={() => {
                  setIsPlaying(false);
                  setTimelineIndex((prev) => {
                    const next = Math.min(prev + 1, Math.max(eventLog.length - 1, 0));
                    setSelectedEventIndex(next);
                    return next;
                  });
                }}
                style={{ marginLeft: 8 }}
              >
                Step ▶
              </button>

              <input
                type="range"
                min={0}
                max={Math.max(eventLog.length - 1, 0)}
                value={timelineIndex}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setIsPlaying(false);
                  setTimelineIndex(idx);

                  if (compareMode) {
                    if (compareIndexA === null) {
                      setCompareIndexA(idx);
                      setCompareIndexB(null);
                    } else {
                      setCompareIndexB(idx);
                    }
                  } else {
                    setSelectedEventIndex(idx);
                  }
                }}
                style={{ width: '400px', marginLeft: 20 }}
              />

              <span style={{ marginLeft: 12 }}>
                {timelineIndex} / {Math.max(eventLog.length - 1, 0)}
              </span>

              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() => {
                    setCompareMode((enabled) => {
                      const next = !enabled;

                      if (next) {
                        setCompareIndexA(null);
                        setCompareIndexB(null);
                      } else {
                        setSelectedEventIndex(timelineIndex);
                      }

                      return next;
                    });
                  }}
                >
                  {compareMode ? 'Exit Compare Mode' : 'Enter Compare Mode'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                {eventLog.map((event, index) => (
                  <div
                    key={`${event.type}-${event.task_id}-${event.timestamp}-${index}`}
                    onClick={() => {
                      setIsPlaying(false);
                      setTimelineIndex(index);
                      setSelectedEventIndex(index);
                    }}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background:
                        event.type === 'ci'
                          ? '#ffaa00'
                          : event.type === 'pr'
                            ? '#00f2ff'
                            : event.type === 'policy'
                              ? '#ff4d6d'
                              : '#888',
                      cursor: 'pointer'
                    }}
                  />
                ))}
              </div>

              {compareMode && orderedCompareIndexes !== null && (
                <DualDiffPanel
                  indexA={orderedCompareIndexes.a}
                  indexB={orderedCompareIndexes.b}
                  diffs={computeSnapshotDiff(orderedCompareIndexes.a, orderedCompareIndexes.b)}
                />
              )}

              {!compareMode && selectedEventIndex !== null && <DiffInspectionPanel event={eventLog[selectedEventIndex]} />}
            </div>
          </div>
          <div className="agents-sidebar">
            <PRMonitor results={results} />
            <PolicyPanel results={results} />
            <BudgetPanel budget={budget} />
          </div>
        </div>
      )}
    </div>
  );
}
