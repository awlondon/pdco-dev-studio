import type { PRTaskResult } from './types';

export default function PolicyPanel({ results }: { results: PRTaskResult[] }) {
  return (
    <div className="agents-widget">
      <h4>Policy</h4>
      {results
        .filter((result) => result.policy && !result.policy.allow_merge)
        .map((result) => (
          <div key={result.task_id} className="agents-row">
            <strong>{result.task_id} blocked</strong>
            <ul>
              {result.policy?.reasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
