// sandboxController.js
// Minimal, explicit, animation-safe execution controller

export function createSandboxController({
  iframe: initialIframe,
  statusEl,
  maxFiniteMs = 4000,
} = {}) {
  let iframe = initialIframe;
  let mode = "idle"; // idle | finite | animation
  let startTime = 0;
  let frameCount = 0;
  let rafId = null;
  let timeoutId = null;
  let running = false;

  function logStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function resetCounters() {
    startTime = performance.now();
    frameCount = 0;
  }

  function detectMode(code) {
    if (
      code.includes("requestAnimationFrame") ||
      code.includes("<canvas") ||
      code.includes("getContext('2d')") ||
      code.includes("getContext(\"2d\")")
    ) {
      return "animation";
    }
    return "finite";
  }

  function clearTimers() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function stop(reason = "stopped") {
    running = false;
    clearTimers();
    logStatus(`⛔ stopped (${reason})`);
  }

  function pause() {
    running = false;
    logStatus("⏸ paused");
  }

  function resume() {
    if (mode !== "animation") return;
    running = true;
    requestFrameLoop();
  }

  function requestFrameLoop() {
    if (!running) return;
    rafId = requestAnimationFrame(() => {
      frameCount++;
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      logStatus(`🟢 running • ${frameCount} frames • ${elapsed}s`);
      requestFrameLoop();
    });
  }

  function inject(code) {
    if (!iframe) {
      stop("missing iframe");
      return;
    }
    clearTimers();
    resetCounters();

    mode = detectMode(code);
    running = true;

    logStatus(`▶ executing (${mode})`);

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(code);
    doc.close();

    if (mode === "finite") {
      timeoutId = setTimeout(() => {
        stop("timeout");
      }, maxFiniteMs);
    }

    if (mode === "animation") {
      requestFrameLoop();
    }
  }

  return {
    run(code) {
      inject(code);
    },
    setIframe(nextIframe) {
      iframe = nextIframe;
    },
    stop,
    pause,
    resume,
    get state() {
      return {
        mode,
        running,
        frameCount,
        elapsedMs: performance.now() - startTime,
      };
    },
  };
}
