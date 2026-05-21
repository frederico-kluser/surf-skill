// Progress logger — writes one self-contained line per event to stderr.
//
// Design constraints (researched 2026-05-20):
//   - stdout stays clean (the LLM/pipe parses JSON or Markdown there).
//   - stderr is line-based, unbuffered, plain text. NO ANSI animation,
//     NO `\r` rewrites — those become noise in non-TTY captures and
//     burn tokens when the agent reads back the stderr at the end of
//     the bash call.
//   - Each line is self-contained: `[surf HH:MM:SS] SYMBOL message`.
//     Agents can grep these lines; humans can read them.
//   - `SURF_QUIET=1` env or setSilent(true) silences output (for tests
//     and scripts that capture stderr).
//
// Symbols (Unicode, fits any terminal):
//   ▸ start of an operation/attempt
//   ✓ success
//   ✗ failure
//   ↻ retry / backoff
//   ⓘ informational
//   ⚠ warning / soft issue (e.g. key burned)
//   ⏱ timing / summary

import { stderr } from 'node:process';

const SYMBOLS = {
  start:   '▸',
  success: '✓',
  fail:    '✗',
  retry:   '↻',
  info:    'ⓘ',
  warn:    '⚠',
  done:    '⏱',
};

let silent = process.env.SURF_QUIET === '1';

export function setSilent(v) {
  silent = !!v;
}

export function isSilent() {
  return silent;
}

function ts() {
  const d = new Date();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function write(symbolKey, msg) {
  if (silent) return;
  const sym = SYMBOLS[symbolKey] || '·';
  stderr.write(`[surf ${ts()}] ${sym} ${msg}\n`);
}

export const progress = {
  start:   (msg) => write('start', msg),
  success: (msg) => write('success', msg),
  fail:    (msg) => write('fail', msg),
  retry:   (msg) => write('retry', msg),
  info:    (msg) => write('info', msg),
  warn:    (msg) => write('warn', msg),
  done:    (msg) => write('done', msg),
};

// Convenience: time an async block. Emits start/done with elapsed.
export async function timed(label, fn) {
  const t0 = Date.now();
  progress.start(label);
  try {
    const r = await fn();
    progress.done(`${label} (${Date.now() - t0}ms)`);
    return r;
  } catch (e) {
    progress.fail(`${label} (${Date.now() - t0}ms): ${e.message || e}`);
    throw e;
  }
}
