type GlyphState = Record<string, any>;

const GLYPH_MAP: Record<string, string> = {
  '⟁INTENT': 'intent.primary',
  '⟲STATE': 'state.mode',
  '⌬SCOPE': 'scope',
  '∆HARD': 'constraints.hard',
  '∆SOFT': 'constraints.soft',
  'ψSTYLE': 'style',
  'ΩOUT': 'output.format',
  'λMODEL': 'routing.model_class',
  'λLATENCY': 'routing.latency_bias'
};

export function compileGlyphs(
  glyphText: string,
  previousState: GlyphState = {}
): GlyphState {
  const lines = glyphText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const patch: GlyphState = {};

  for (const line of lines) {
    const [symbol, rawPayload] = line.split(':');
    if (!rawPayload || !(symbol in GLYPH_MAP)) {
      continue;
    }

    const payload = rawPayload.trim();
    const path = GLYPH_MAP[symbol];

    applyGlyph(patch, symbol, payload, path);
  }

  return deepMerge(previousState, patch);
}

function applyGlyph(
  patch: GlyphState,
  symbol: string,
  payload: string,
  path: string
) {
  switch (symbol) {
    case '⟁INTENT':
      setPath(patch, path, payload.toLowerCase());
      break;
    case '⟲STATE':
      setPath(patch, path, payload.toLowerCase());
      break;
    case '⌬SCOPE': {
      const [runtime, files, framework] = payload.split('|');
      patch.scope = {
        ...(runtime && { runtime: runtime.toLowerCase() }),
        ...(files && { files: files.toLowerCase() }),
        ...(framework && { framework: framework.toLowerCase() })
      };
      break;
    }
    case '∆HARD':
    case '∆SOFT': {
      const key = symbol === '∆HARD' ? 'hard' : 'soft';
      patch.constraints ??= {};
      patch.constraints[key] = payload
        .split(',')
        .map(value => value.trim().toLowerCase());
      break;
    }
    case 'ψSTYLE': {
      const [tone, verbosity, comments] = payload.split('|');
      patch.style = {
        ...(tone && { tone: tone.toLowerCase() }),
        ...(verbosity && { verbosity: verbosity.toLowerCase() }),
        ...(comments && { comments: comments.toLowerCase() })
      };
      break;
    }
    case 'ΩOUT':
      patch.output = {
        format: normalizeOutput(payload)
      };
      break;
    case 'λMODEL':
      patch.routing = {
        ...(patch.routing || {}),
        model_class: payload.toLowerCase()
      };
      break;
    case 'λLATENCY':
      patch.routing = {
        ...(patch.routing || {}),
        latency_bias: payload.toLowerCase()
      };
      break;
  }
}

function setPath(obj: any, path: string, value: any) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    current[keys[i]] ??= {};
    current = current[keys[i]];
  }
  current[keys.at(-1)!] = value;
}

function normalizeOutput(value: string) {
  return value
    .toLowerCase()
    .replace('_only', '')
    .replace('_', '+');
}

function deepMerge(target: any, source: any): any {
  for (const key of Object.keys(source)) {
    if (
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      source[key] !== null
    ) {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
