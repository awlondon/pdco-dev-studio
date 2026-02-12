const MAX_SAMPLES_PER_METRIC = 120;

function toFixed(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Number(num.toFixed(digits));
}

function percentile(values, p) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function createFrontendPerfStore() {
  const measures = new Map();
  const counters = new Map();
  const listeners = new Set();

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener(getSnapshot());
      } catch (error) {
        console.warn('Perf listener failed.', error);
      }
    });
  };

  const pushMeasure = (name, durationMs, meta = {}) => {
    if (!name || !Number.isFinite(durationMs)) {
      return;
    }
    const current = measures.get(name) || [];
    current.push({
      durationMs,
      at: Date.now(),
      meta
    });
    if (current.length > MAX_SAMPLES_PER_METRIC) {
      current.splice(0, current.length - MAX_SAMPLES_PER_METRIC);
    }
    measures.set(name, current);
    notify();
  };

  const addCount = (name, delta = 1) => {
    counters.set(name, (counters.get(name) || 0) + delta);
    notify();
  };

  const measure = (name, startMark, endMark, meta = {}) => {
    if (!window.performance?.measure) {
      return null;
    }
    try {
      const measureName = `${name}::${Date.now()}`;
      window.performance.measure(measureName, {
        start: startMark,
        end: endMark
      });
      const entries = window.performance.getEntriesByName(measureName, 'measure');
      const entry = entries.at(-1);
      if (entry) {
        pushMeasure(name, entry.duration, meta);
      }
      window.performance.clearMeasures(measureName);
      return entry?.duration ?? null;
    } catch {
      return null;
    }
  };

  const mark = (name) => {
    if (!name || !window.performance?.mark) {
      return;
    }
    try {
      window.performance.mark(name);
    } catch {
      // no-op
    }
  };

  const start = (name, meta = {}) => {
    const startMark = `${name}:start:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    mark(startMark);
    return {
      end(extraMeta = {}) {
        const endMark = `${name}:end:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        mark(endMark);
        const duration = measure(name, startMark, endMark, { ...meta, ...extraMeta });
        if (window.performance?.clearMarks) {
          window.performance.clearMarks(startMark);
          window.performance.clearMarks(endMark);
        }
        return duration;
      }
    };
  };

  const getSnapshot = () => {
    const measureSummary = {};
    for (const [name, values] of measures.entries()) {
      const durations = values.map((entry) => entry.durationMs).filter(Number.isFinite);
      measureSummary[name] = {
        count: durations.length,
        lastMs: toFixed(durations.at(-1), 1),
        avgMs: toFixed(durations.reduce((acc, value) => acc + value, 0) / Math.max(1, durations.length), 1),
        p50Ms: toFixed(percentile(durations, 50), 1),
        p95Ms: toFixed(percentile(durations, 95), 1)
      };
    }
    const counterSummary = {};
    for (const [name, value] of counters.entries()) {
      counterSummary[name] = value;
    }
    return {
      measures: measureSummary,
      counters: counterSummary,
      updatedAt: Date.now()
    };
  };

  return {
    mark,
    measure,
    start,
    pushMeasure,
    addCount,
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(getSnapshot());
      return () => listeners.delete(listener);
    }
  };
}

export { createFrontendPerfStore, percentile };
