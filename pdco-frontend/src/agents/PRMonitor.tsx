import type { PRTaskResult } from './types';

export default function PRMonitor({ results }: { results: PRTaskResult[] }) {
  return (
    <div className="agents-widget">
      <h4>PR Monitor</h4>
      {results.map((result) =>
        result.pr_number ? (
          <div key={result.pr_number} className="agents-row">
            PR #{result.pr_number} – {result.status}
          </div>
        ) : null
      )}
    </div>
  );
}
