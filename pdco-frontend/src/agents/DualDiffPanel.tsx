import React from 'react';
import type { SemanticChange } from './semanticDiff';

type SnapshotDiff = {
  path: string;
  before: string;
  after: string;
  semantic: SemanticChange[];
};

export default function DualDiffPanel({
  indexA,
  indexB,
  diffs
}: {
  indexA: number;
  indexB: number;
  diffs: SnapshotDiff[];
}) {
  return (
    <div
      style={{
        marginTop: 20,
        padding: 16,
        background: '#0d0d15',
        border: '1px solid #333',
        borderRadius: 8
      }}
    >
      <h3>
        Snapshot Diff: T{indexA} → T{indexB}
      </h3>

      {diffs.length === 0 && <div>No changes between these timepoints.</div>}

      {diffs.map((file, i) => (
        <div key={`${file.path}-${i}`} style={{ marginTop: 16 }}>
          <div style={{ color: '#00f2ff' }}>{file.path}</div>

          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 6
            }}
          >
            <pre
              style={{
                flex: 1,
                background: '#111',
                padding: 10,
                overflow: 'auto',
                maxHeight: 250
              }}
            >
              {file.before}
            </pre>

            <pre
              style={{
                flex: 1,
                background: '#1a1f1a',
                padding: 10,
                overflow: 'auto',
                maxHeight: 250,
                color: '#00ff88'
              }}
            >
              {file.after}
            </pre>
          </div>

          {file.semantic.length > 0 && (
            <div
              style={{
                marginTop: 6,
                padding: 6,
                background: '#111a22',
                border: '1px solid #224'
              }}
            >
              <strong>Semantic Changes:</strong>
              <ul>
                {file.semantic.map((change, semanticIndex) => (
                  <li key={`${change.type}-${change.name ?? semanticIndex}`}>
                    {change.type} {change.name ? `(${change.name})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
