import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The fork points memory extraction at a self-hosted Ollama through
// OLLAMA_HOST; the deployed daemon runs with it set to a LAN host. The env
// read sits in a module-level constant table, so it is resolved once at import
// and is invisible to any test that imports the module normally — which is why
// this behavior had no coverage at all and would survive an upstream merge
// only by luck. These specs load the module under a stubbed environment and
// assert the request the extractor actually issues.

const dataDir = path.join(process.env.OD_DATA_DIR as string, 'memory-ollama-host-test');
const originalFetch = globalThis.fetch;

async function loadExtractorWithEnv(ollamaHost: string | undefined) {
  vi.resetModules();
  if (ollamaHost === undefined) vi.stubEnv('OLLAMA_HOST', '');
  else vi.stubEnv('OLLAMA_HOST', ollamaHost);
  const [{ extractWithLLM }, memory, extractions] = await Promise.all([
    import('../src/memory-llm.js'),
    import('../src/memory.js'),
    import('../src/memory-extractions.js'),
  ]);
  extractions.__resetExtractionsForTests();
  await fsp.rm(memory.memoryDir(dataDir), { recursive: true, force: true });
  await memory.writeMemoryConfig(dataDir, { chatExtractionEnabled: true });
  return extractWithLLM;
}

async function captureExtractorUrl(ollamaHost: string | undefined): Promise<string | null> {
  const extractWithLLM = await loadExtractorWithEnv(ollamaHost);
  let capturedUrl: string | null = null;
  globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    capturedUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"entries":[]}' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  await extractWithLLM(
    dataDir,
    { userMessage: 'I prefer dark mode.', assistantMessage: 'Noted.' },
    {
      projectRoot: null,
      chatAgentId: null,
      chatProvider: {
        provider: 'ollama',
        apiKey: 'ollama-local',
        baseUrl: '',
        apiVersion: '',
        model: '',
      },
    },
  );

  return capturedUrl;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('memory extraction Ollama host', () => {
  it('sends the extraction to OLLAMA_HOST when the provider omits a base URL', async () => {
    const url = await captureExtractorUrl('http://ollama.test:11434');

    expect(url).not.toBeNull();
    expect(String(url).startsWith('http://ollama.test:11434')).toBe(true);
  });

  it('falls back to a local Ollama when OLLAMA_HOST is unset', async () => {
    const url = await captureExtractorUrl(undefined);

    expect(String(url).startsWith('http://localhost:11434')).toBe(true);
  });
});
