import React, { useCallback, useState } from 'react';
import ExecutionGraph from './ExecutionGraph';
import PRMonitor from './PRMonitor';
import PolicyPanel from './PolicyPanel';
import BudgetPanel from './BudgetPanel';
import { useAgentSocket } from './useAgentSocket';
import type { AgentRunResponse, PRTaskResult, TaskGraph } from './types';

export default function AgentsPanel() {
  const [graph, setGraph] = useState<TaskGraph | null>(null);
  const [results, setResults] = useState<PRTaskResult[]>([]);
  const [budget, setBudget] = useState<AgentRunResponse['budget']>();
  const [taskStates, setTaskStates] = useState<Record<string, string>>({});

  const runAgents = useCallback(async () => {
    const response = await fetch('http://localhost:3000/multi-agent-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective: 'create something cool',
        constraints: { risk: 'medium' }
      })
    });

    const data: AgentRunResponse = await response.json();
    setGraph(data.task_graph);
    setResults(data.tasks);
    setBudget(data.budget);

    const initialStates: Record<string, string> = {};
    data.tasks.forEach((result) => {
      if (result.status) {
        initialStates[result.task_id] = result.status;
      }
    });
    setTaskStates(initialStates);
  }, []);

  const handleCIUpdate = useCallback((ci: any) => {
    if (!ci.task_id) return;
    setTaskStates((prev) => ({
      ...prev,
      [ci.task_id]: ci.conclusion === 'failure' ? 'blocked' : ci.status === 'in_progress' ? 'running' : prev[ci.task_id]
    }));
  }, []);

  const handlePRUpdate = useCallback((pr: any) => {
    if (!pr.task_id) return;
    setTaskStates((prev) => ({
      ...prev,
      [pr.task_id]: pr.merged ? 'merged' : prev[pr.task_id]
    }));
  }, []);

  useAgentSocket(handleCIUpdate, handlePRUpdate);

  return (
    <div className="agents-panel">
      <button onClick={runAgents}>Run via Agents</button>

      {graph && (
        <div className="agents-layout">
          <div className="agents-graph-wrap">
            <ExecutionGraph tasks={graph.tasks} taskStates={taskStates} />
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
