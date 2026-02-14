import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import {
  artifactExtension,
  createBlogEmbedHelpers,
  exportArtifactsPack,
  importArtifactsPack,
  readArtifacts,
  saveArtifact
} from './artifactsStore';
import AgentsPanel from './agents/AgentsPanel';

const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
const isDev = import.meta.env.DEV;
const layoutStorageKey = 'pdco.devstudio.layout.v1';

const panelDefinitions = {
  editor: { title: 'Editor', zone: 'center', allowUndock: false },
  preview: { title: 'Preview', zone: 'right', allowUndock: true },
  console: { title: 'Console / Logs', zone: 'bottom', allowUndock: true },
  files: { title: 'Files', zone: 'left', allowUndock: true },
  tasks: { title: 'Tasks', zone: 'right', allowUndock: true },
  agents: { title: 'Agents', zone: 'right', allowUndock: true },
  settings: { title: 'Settings', zone: 'right', allowUndock: true }
};

const defaultLayout = {
  left: 280,
  right: 360,
  panels: {
    editor: { visible: true, docked: true },
    preview: { visible: true, docked: true },
    console: { visible: true, docked: true },
    files: { visible: true, docked: true },
    tasks: { visible: true, docked: true },
    agents: { visible: true, docked: true },
    settings: { visible: false, docked: true }
  }
};

function readStoredLayout() {
  if (typeof window === 'undefined') {
    return defaultLayout;
  }

  try {
    const raw = window.localStorage.getItem(layoutStorageKey);
    if (!raw) {
      return defaultLayout;
    }
    const parsed = JSON.parse(raw);

    return {
      ...defaultLayout,
      ...parsed,
      panels: {
        ...defaultLayout.panels,
        ...(parsed?.panels || {})
      }
    };
  } catch {
    return defaultLayout;
  }
}

function useRenderCounter(name) {
  const countRef = useRef(0);
  countRef.current += 1;

  useEffect(() => {
    if (isDev) {
      window.__workspaceRenderCounts = window.__workspaceRenderCounts || {};
      window.__workspaceRenderCounts[name] = countRef.current;
    }
  });

  return isDev ? countRef.current : null;
}

const RenderBadge = memo(function RenderBadge({ name }) {
  const count = useRenderCounter(name);
  if (!isDev) {
    return null;
  }
  return <span className="render-badge">renders: {count}</span>;
});

const PanelFrame = memo(function PanelFrame({ id, title, layout, onToggleVisible, onToggleDock, children }) {
  const isVisible = layout.visible;
  return (
    <section className={`panel ${isVisible ? '' : 'panel-hidden'}`}>
      <header className="panel-header">
        <strong>{title}</strong>
        <div className="panel-actions">
          <button onClick={() => onToggleVisible(id)}>{isVisible ? 'Hide' : 'Show'}</button>
          {panelDefinitions[id].allowUndock && (
            <button onClick={() => onToggleDock(id)}>{layout.docked ? 'Undock' : 'Dock'}</button>
          )}
        </div>
      </header>
      <RenderBadge name={title} />
      <div className="panel-body">{children}</div>
    </section>
  );
});

const EditorPanel = memo(function EditorPanel({ value, onChange, panelLayout, onToggleVisible }) {
  return (
    <PanelFrame
      id="editor"
      title={panelDefinitions.editor.title}
      layout={panelLayout}
      onToggleVisible={onToggleVisible}
      onToggleDock={() => {}}
    >
      <textarea
        className="editor-input"
        value={value}
        onChange={onChange}
        spellCheck={false}
        placeholder="Type code here..."
      />
    </PanelFrame>
  );
});

const PreviewPanel = memo(function PreviewPanel({ panelLayout, onToggleVisible, onToggleDock }) {
  const previewText = useMemo(() => `API base URL: ${apiUrl}`, []);
  return (
    <PanelFrame
      id="preview"
      title={panelDefinitions.preview.title}
      layout={panelLayout}
      onToggleVisible={onToggleVisible}
      onToggleDock={onToggleDock}
    >
      {previewText}
    </PanelFrame>
  );
});

const ConsolePanel = memo(function ConsolePanel({ panelLayout, onToggleVisible, onToggleDock }) {
  const [logs] = useState(['Build started…', 'Dev server ready on :5173', '0 errors · 0 warnings']);
  return (
    <PanelFrame
      id="console"
      title={panelDefinitions.console.title}
      layout={panelLayout}
      onToggleVisible={onToggleVisible}
      onToggleDock={onToggleDock}
    >
      {logs.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </PanelFrame>
  );
});

const FilesPanel = memo(function FilesPanel({ panelLayout, onToggleVisible, onToggleDock, editorValue }) {
  const [filter, setFilter] = useState('');
  const [artifactName, setArtifactName] = useState('');
  const [artifactType, setArtifactType] = useState('text/html');
  const [artifactTags, setArtifactTags] = useState('demo');
  const [artifactSource, setArtifactSource] = useState('manual');
  const [artifacts, setArtifacts] = useState(() => readArtifacts());
  const [selectedArtifactId, setSelectedArtifactId] = useState('');

  const filteredArtifacts = useMemo(() => {
    const search = filter.trim().toLowerCase();
    if (!search) {
      return artifacts;
    }
    return artifacts.filter((artifact) => {
      const text = `${artifact.name} ${artifact.type} ${artifact.tags.join(' ')}`.toLowerCase();
      return text.includes(search);
    });
  }, [artifacts, filter]);

  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) || filteredArtifacts[0] || null;

  const saveCurrentArtifact = useCallback(() => {
    const record = saveArtifact({
      name: artifactName || `Artifact ${new Date().toLocaleString()}`,
      type: artifactType,
      source: artifactSource,
      content: editorValue,
      tags: artifactTags
    });
    setArtifacts(readArtifacts());
    setSelectedArtifactId(record.id);
  }, [artifactName, artifactSource, artifactTags, artifactType, editorValue]);

  const downloadBlob = useCallback((blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportSelectedArtifact = useCallback(() => {
    if (!selectedArtifact) {
      return;
    }
    const extension = artifactExtension(selectedArtifact.type);
    downloadBlob(new Blob([selectedArtifact.content], { type: selectedArtifact.type }), `${selectedArtifact.name}.${extension}`);
  }, [downloadBlob, selectedArtifact]);

  const exportArtifactBundle = useCallback(() => {
    const payload = exportArtifactsPack(artifacts);
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'project-artifacts-pack.json');
  }, [artifacts, downloadBlob]);

  const importArtifactBundle = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const result = importArtifactsPack(payload);
      if (result.ok) {
        const nextArtifacts = readArtifacts();
        setArtifacts(nextArtifacts);
        setSelectedArtifactId(nextArtifacts[0]?.id || '');
      }
    } catch {
      // Invalid pack; ignored.
    }
    event.target.value = '';
  }, []);

  const copyHelper = useCallback(async (mode) => {
    if (!selectedArtifact) {
      return;
    }
    const helpers = createBlogEmbedHelpers(selectedArtifact);
    await navigator.clipboard.writeText(mode === 'iframe' ? helpers.iframe : helpers.markdown);
  }, [selectedArtifact]);

  return (
    <PanelFrame
      id="files"
      title={panelDefinitions.files.title}
      layout={panelLayout}
      onToggleVisible={onToggleVisible}
      onToggleDock={onToggleDock}
    >
      <input className="panel-input" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter artifacts…" />
      <input className="panel-input" value={artifactName} onChange={(event) => setArtifactName(event.target.value)} placeholder="Artifact name" />
      <input className="panel-input" value={artifactType} onChange={(event) => setArtifactType(event.target.value)} placeholder="Artifact type (e.g. image/svg+xml)" />
      <input className="panel-input" value={artifactTags} onChange={(event) => setArtifactTags(event.target.value)} placeholder="Tags (comma-separated)" />
      <select className="panel-input" value={artifactSource} onChange={(event) => setArtifactSource(event.target.value)}>
        <option value="manual">manual</option>
        <option value="agent">agent</option>
      </select>
      <div className="artifact-actions">
        <button onClick={saveCurrentArtifact}>Save from editor</button>
        <button onClick={exportSelectedArtifact} disabled={!selectedArtifact}>Export selected</button>
        <button onClick={exportArtifactBundle} disabled={!artifacts.length}>Export bundle (JSON)</button>
      </div>
      <label className="import-label">
        Import bundle
        <input type="file" accept="application/json" onChange={importArtifactBundle} />
      </label>

      <div className="artifact-list">
        {filteredArtifacts.map((artifact) => (
          <button
            key={artifact.id}
            className={`artifact-row ${artifact.id === selectedArtifact?.id ? 'artifact-row-selected' : ''}`}
            onClick={() => setSelectedArtifactId(artifact.id)}
          >
            <strong>{artifact.name}</strong>
            <small>{artifact.type} · {artifact.source}</small>
          </button>
        ))}
      </div>

      {selectedArtifact && (
        <div className="artifact-details">
          <div><strong>Created:</strong> {new Date(selectedArtifact.created_at).toLocaleString()}</div>
          <div><strong>Tags:</strong> {selectedArtifact.tags.join(', ') || 'none'}</div>
          <div className="artifact-actions">
            <button onClick={() => copyHelper('iframe')}>Copy iframe snippet</button>
            <button onClick={() => copyHelper('markdown')}>Copy markdown ![]()</button>
          </div>
        </div>
      )}
    </PanelFrame>
  );
});

const TasksPanel = memo(function TasksPanel({ panelLayout, onToggleVisible, onToggleDock }) {
  const [draft, setDraft] = useState('Implement smoke test');
  return (
    <PanelFrame
      id="tasks"
      title={panelDefinitions.tasks.title}
      layout={panelLayout}
      onToggleVisible={onToggleVisible}
      onToggleDock={onToggleDock}
    >
      <input className="panel-input" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <div>Open tasks: 3</div>
    </PanelFrame>
  );
});

const SettingsPanel = memo(function SettingsPanel({ panelLayout, onToggleVisible, onToggleDock }) {
  const [safeMode, setSafeMode] = useState(true);
  return (
    <PanelFrame
      id="settings"
      title={panelDefinitions.settings.title}
      layout={panelLayout}
      onToggleVisible={onToggleVisible}
      onToggleDock={onToggleDock}
    >
      <label className="settings-toggle">
        <input type="checkbox" checked={safeMode} onChange={(event) => setSafeMode(event.target.checked)} />
        Safe mode rollout
      </label>
    </PanelFrame>
  );
});

const AgentsWorkspacePanel = memo(function AgentsWorkspacePanel({ panelLayout, onToggleVisible, onToggleDock }) {
  return (
    <PanelFrame
      id="agents"
      title={panelDefinitions.agents.title}
      layout={panelLayout}
      onToggleVisible={onToggleVisible}
      onToggleDock={onToggleDock}
    >
      <AgentsPanel />
    </PanelFrame>
  );
});

function App() {
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [layout, setLayout] = useState(() => readStoredLayout());
  const [editorValue, setEditorValue] = useState('<h1>PDCo Dev Studio</h1>');
  const shellRef = useRef(null);
  const dragRef = useRef({ active: false, side: null, value: 0 });

  const hasLeftPanel = layout.panels.files.visible && layout.panels.files.docked;
  const hasRightPanel = ['preview', 'tasks', 'settings'].some((id) => layout.panels[id].visible && layout.panels[id].docked);
  const dockIsVisible = layout.panels.console.visible && layout.panels.console.docked;

  const shellStyle = useMemo(
    () => ({
      '--left-width': `${hasLeftPanel ? layout.left : 48}px`,
      '--right-width': `${hasRightPanel ? layout.right : 48}px`,
      '--dock-height': dockIsVisible ? '180px' : '40px'
    }),
    [dockIsVisible, hasLeftPanel, hasRightPanel, layout.left, layout.right]
  );

  useEffect(() => {
    window.localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
  }, [layout]);

  const onEditorChange = useCallback((event) => {
    setEditorValue(event.target.value);
  }, []);

  const togglePanelVisible = useCallback((panelId) => {
    setLayout((current) => ({
      ...current,
      panels: {
        ...current.panels,
        [panelId]: {
          ...current.panels[panelId],
          visible: !current.panels[panelId].visible
        }
      }
    }));
  }, []);

  const togglePanelDock = useCallback((panelId) => {
    setLayout((current) => ({
      ...current,
      panels: {
        ...current.panels,
        [panelId]: {
          ...current.panels[panelId],
          docked: !current.panels[panelId].docked,
          visible: true
        }
      }
    }));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(defaultLayout);
  }, []);

  const exportLayout = useCallback(() => {
    const layoutJson = JSON.stringify(layout, null, 2);
    const blob = new Blob([layoutJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pdco-layout.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [layout]);

  const onDividerStart = useCallback((side) => (event) => {
    dragRef.current = {
      active: true,
      side,
      value: side === 'left' ? layout.left : layout.right
    };
    event.preventDefault();
  }, [layout.left, layout.right]);

  useEffect(() => {
    const onMove = (event) => {
      if (!dragRef.current.active || !shellRef.current) {
        return;
      }

      const shellRect = shellRef.current.getBoundingClientRect();
      const minPanelWidth = 180;
      const maxPanelWidth = 420;

      if (dragRef.current.side === 'left') {
        const next = Math.min(maxPanelWidth, Math.max(minPanelWidth, event.clientX - shellRect.left));
        dragRef.current.value = next;
        shellRef.current.style.setProperty('--left-width', `${next}px`);
      }

      if (dragRef.current.side === 'right') {
        const fromRight = shellRect.right - event.clientX;
        const next = Math.min(maxPanelWidth, Math.max(minPanelWidth, fromRight));
        dragRef.current.value = next;
        shellRef.current.style.setProperty('--right-width', `${next}px`);
      }
    };

    const onUp = () => {
      if (!dragRef.current.active) {
        return;
      }
      const { side, value } = dragRef.current;
      dragRef.current = { active: false, side: null, value: 0 };
      setLayout((current) => ({ ...current, ...(side === 'left' ? { left: value } : { right: value }) }));
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const floatingPanels = Object.keys(layout.panels).filter(
    (id) => id !== 'editor' && id !== 'agents' && layout.panels[id].visible && !layout.panels[id].docked
  );

  const frontendOrigin = typeof window === 'undefined' ? 'unknown' : window.location.origin;
  const runtimeLabel = isDev ? 'local-dev' : 'production-build';

  return (
    <div className="workspace-root">
      <div className="frontend-origin-badge" role="status" aria-live="polite">
        <strong>{runtimeLabel}</strong>
        <span>{frontendOrigin}</span>
      </div>
      <div className="workspace-toolbar">
        <strong>Workspace Layout</strong>
        <button onClick={() => setAgentsOpen((open) => !open)}>{agentsOpen ? 'Close Agents' : 'Open Agents'}</button>
        <button onClick={resetLayout}>Reset layout</button>
        <button onClick={exportLayout}>Export layout JSON</button>
      </div>

      <div className="workspace-main">
        <div className="workspace-studio">
          <main className="workspace-shell" ref={shellRef} style={shellStyle}>
            <div className="left-column">
              <FilesPanel panelLayout={layout.panels.files} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} editorValue={editorValue} />
            </div>
            <div className="divider" onMouseDown={onDividerStart('left')} />

            <section className="center-column">
              <EditorPanel value={editorValue} onChange={onEditorChange} panelLayout={layout.panels.editor} onToggleVisible={togglePanelVisible} />
              <ConsolePanel panelLayout={layout.panels.console} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} />
            </section>

            <div className="divider" onMouseDown={onDividerStart('right')} />

            <section className="right-column">
              <PreviewPanel panelLayout={layout.panels.preview} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} />
              <TasksPanel panelLayout={layout.panels.tasks} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} />
              <SettingsPanel panelLayout={layout.panels.settings} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} />
            </section>
          </main>

          {!!floatingPanels.length && (
            <aside className="floating-area">
              {floatingPanels.includes('preview') && (
                <PreviewPanel panelLayout={layout.panels.preview} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} />
              )}
              {floatingPanels.includes('console') && (
                <ConsolePanel panelLayout={layout.panels.console} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} />
              )}
              {floatingPanels.includes('files') && (
                <FilesPanel panelLayout={layout.panels.files} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} editorValue={editorValue} />
              )}
              {floatingPanels.includes('tasks') && (
                <TasksPanel panelLayout={layout.panels.tasks} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} />
              )}
              {floatingPanels.includes('settings') && (
                <SettingsPanel panelLayout={layout.panels.settings} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} />
              )}
            </aside>
          )}
        </div>

        {agentsOpen && (
          <aside className="agents-dock">
            <AgentsWorkspacePanel panelLayout={layout.panels.agents} onToggleVisible={togglePanelVisible} onToggleDock={togglePanelDock} />
          </aside>
        )}
      </div>
    </div>
  );
}

export default App;
