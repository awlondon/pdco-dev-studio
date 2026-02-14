export type Task = {
  id: string;
  title?: string;
  description?: string;
  dependencies?: string[];
};

export type TaskGraph = {
  tasks: Task[];
};

export type PRTaskResult = {
  task_id: string;
  pr_number?: number;
  pr_url?: string;
  status: string;
  policy?: {
    allow_merge: boolean;
    reasons: string[];
    risk_level: string;
  };
};

export type AgentRunResponse = {
  task_graph: TaskGraph;
  tasks: PRTaskResult[];
  budget?: {
    tokens_used: number;
    api_calls: number;
  };
};
