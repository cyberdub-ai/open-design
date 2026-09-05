import { describe, expect, it } from 'vitest';

import { writeComposedPromptToChildStdin } from '../src/runtimes/chat-run-lifecycle.js';

// The fork keeps Claude on `promptInputFormat: 'stream-json'` so the daemon can
// stream further user messages into a turn that is already running. That only
// works while the child's stdin stays open, and "stays open" is invisible in a
// diff: the plain-text branch right next to it writes and closes, so a merge
// that resolves this conflict toward the common shape silently removes mid-turn
// input. It has happened once already (v0.20.2 landed stdin closed; b93beada73
// put it back). These tests assert the observable effect — what was written,
// and whether `end()` was called — not the value of a flag.

type Recorded = {
  writes: string[];
  ended: boolean;
  flushed: number;
};

function fakeStdin(accepted = true, throwOnWrite?: NodeJS.ErrnoException) {
  const recorded: Recorded = { writes: [], ended: false, flushed: 0 };
  const stdin = {
    write(chunk: string, _encoding: BufferEncoding, cb: (err?: Error | null) => void) {
      if (throwOnWrite) throw throwOnWrite;
      recorded.writes.push(chunk);
      cb(null);
      return accepted;
    },
    end() {
      recorded.ended = true;
    },
  };
  return { stdin, recorded, onFlush: () => { recorded.flushed += 1; } };
}

describe('writeComposedPromptToChildStdin', () => {
  it('keeps stdin open for a stream-json runtime', () => {
    const { stdin, recorded, onFlush } = fakeStdin();

    const result = writeComposedPromptToChildStdin(stdin, 'draw me a duck', 'stream-json', onFlush);

    expect(recorded.ended).toBe(false);
    expect(result.stdinOpen).toBe(true);
  });

  it('writes the stream-json prompt as one JSONL user message', () => {
    const { stdin, recorded, onFlush } = fakeStdin();

    writeComposedPromptToChildStdin(stdin, 'draw me a duck', 'stream-json', onFlush);

    expect(recorded.writes).toHaveLength(1);
    const line = recorded.writes[0]!;
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trimEnd()).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'draw me a duck' }] },
    });
    expect(recorded.flushed).toBe(1);
  });

  it('closes stdin for a text runtime', () => {
    const { stdin, recorded, onFlush } = fakeStdin();

    const result = writeComposedPromptToChildStdin(stdin, 'draw me a duck', 'text', onFlush);

    expect(recorded.writes).toEqual(['draw me a duck']);
    expect(recorded.ended).toBe(true);
    expect(result.stdinOpen).toBe(false);
  });

  it('treats a runtime that declares no format as text', () => {
    const { stdin, recorded, onFlush } = fakeStdin();

    const result = writeComposedPromptToChildStdin(stdin, 'draw me a duck', undefined, onFlush);

    expect(recorded.ended).toBe(true);
    expect(result.stdinOpen).toBe(false);
  });

  it('reports backpressure on both paths', () => {
    const streamJson = fakeStdin(false);
    const text = fakeStdin(false);

    expect(
      writeComposedPromptToChildStdin(streamJson.stdin, 'p', 'stream-json', streamJson.onFlush)
        .stdinBackpressure,
    ).toBe(true);
    expect(
      writeComposedPromptToChildStdin(text.stdin, 'p', 'text', text.onFlush).stdinBackpressure,
    ).toBe(true);
  });

  // A child that exited before the first write raises EPIPE. It has already
  // routed its failure through the stderr/exit handlers, so the write must not
  // turn into a second, louder error on the way out.
  it('swallows EPIPE from a child that already exited', () => {
    const epipe: NodeJS.ErrnoException = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    const { stdin, onFlush } = fakeStdin(true, epipe);

    expect(() => writeComposedPromptToChildStdin(stdin, 'p', 'stream-json', onFlush)).not.toThrow();
  });

  it('rethrows a non-EPIPE stdin failure', () => {
    const boom: NodeJS.ErrnoException = Object.assign(new Error('boom'), { code: 'ENOSPC' });
    const { stdin, onFlush } = fakeStdin(true, boom);

    expect(() => writeComposedPromptToChildStdin(stdin, 'p', 'stream-json', onFlush)).toThrow(/boom/);
  });
});
