import assert from 'node:assert/strict';
import test from 'node:test';

function setupEditorEnvironment() {
  const elements = new Map();

  const document = {
    head: {
      appendChild(node) {
        if (typeof node._onLoad === 'function') {
          node._onLoad();
        }
      }
    },
    createElement() {
      return {
        setAttribute() {},
        addEventListener(event, handler) {
          if (event === 'load') this._onLoad = handler;
          if (event === 'error') this._onError = handler;
        }
      };
    },
    querySelector() {
      return null;
    },
    getElementById(id) {
      return elements.get(id) || null;
    }
  };

  const amdRequire = (_modules, resolve) => resolve();
  amdRequire.config = () => {};

  const monaco = {
    KeyMod: { Shift: 1, CtrlCmd: 2 },
    KeyCode: { Tab: 9, KeyG: 71, Enter: 13 },
    MarkerSeverity: { Warning: 4, Error: 8 },
    editor: {
      create(container, options = {}) {
        let modelOptions = {};
        const model = {
          updateOptions(next) {
            modelOptions = { ...modelOptions, ...next };
          },
          getLineCount() {
            return String(options.value || '').split('\n').length;
          }
        };
        return {
          _value: options.value || '',
          _disposed: false,
          getModel() { return model; },
          getValue() { return this._value; },
          setValue(value) { this._value = value; },
          getPosition() { return { lineNumber: 1, column: 1 }; },
          setPosition() {},
          getScrollTop() { return 0; },
          setScrollTop() {},
          focus() {},
          revealLineInCenter() {},
          onDidChangeModelContent() { return { dispose() {} }; },
          addCommand() { return 1; },
          addAction() {},
          trigger() {},
          updateOptions() {},
          dispose() { this._disposed = true; }
        };
      },
      setModelLanguage() {},
      setModelMarkers() {}
    }
  };

  global.document = document;
  global.window = {
    require: amdRequire,
    monaco,
    dispatchEvent() {},
    addEventListener() {}
  };
  global.monaco = monaco;

  return {
    registerContainer(id, container) {
      elements.set(id, container);
    }
  };
}

test('editorManager mounts editor instance and unmount disposes it', async () => {
  const env = setupEditorEnvironment();
  const container = {};
  env.registerContainer('editor', container);

  const module = await import(`../editorManager.js?test=${Date.now()}`);
  const { editorManager } = module;

  const api = await editorManager.mount('editor', { value: 'const a = 1;' });
  assert.equal(api.getValue(), 'const a = 1;');

  editorManager.unmount('editor');
  assert.equal(container.__editorInstance, undefined);
});

test('editorManager mount throws when container cannot be found', async () => {
  setupEditorEnvironment();
  const module = await import(`../editorManager.js?test=${Date.now()}-missing`);

  await assert.rejects(
    () => module.editorManager.mount('missing-container', { value: 'x' }),
    /Editor container not found/
  );
});
