// `skipDiscoveryBrief` is the daemon's switch for automated project runs: it
// tells the system prompt to treat the first message as the brief instead of
// opening a discovery `<question-form>` and waiting for a human
// (`packages/contracts/src/prompts/system.ts`). The HTTP surface has accepted
// it since upstream added it, but no `od` verb could set it — so the one
// audience the flag exists for, an external agent driving OpenDesign through
// the CLI, was the audience that could not reach it. Fork commit `78cdef47d1`
// announced `--skip-discovery` in its message and never touched `cli.ts`.
//
// The web UI is the deliberate exemption from the dual-surface rule here: a
// human opening the New Project panel is exactly the case discovery is for.
//
// Stub-server + exec-the-real-cli pattern follows cli-files-write.test.ts.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

interface StubServer {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

async function startStubServer(): Promise<StubServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', body: raw });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ project: { id: 'stub-project' }, conversationId: 'stub-conversation' }));
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub server has no address');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveRun) => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const child = spawn(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: DAEMON_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 20_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('close', (code) => resolveRun({ stdout, stderr, code }));
    child.stdin.end();
  });
}

function createRequestBody(stub: StubServer): Record<string, unknown> {
  const created = stub.requests.find((req) => req.method === 'POST' && req.url === '/api/projects');
  if (!created) throw new Error(`no POST /api/projects captured; saw ${JSON.stringify(stub.requests)}`);
  return JSON.parse(created.body) as Record<string, unknown>;
}

describe('od project create --skip-discovery', () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await startStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.requests.length = 0;
  });

  it('sends skipDiscoveryBrief when the flag is passed', async () => {
    const result = await runCli([
      'project',
      'create',
      '--name',
      'Automated run',
      '--skip-discovery',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(createRequestBody(stub).skipDiscoveryBrief).toBe(true);
  });

  it('omits skipDiscoveryBrief when the flag is absent', async () => {
    const result = await runCli([
      'project',
      'create',
      '--name',
      'Interactive run',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(createRequestBody(stub)).not.toHaveProperty('skipDiscoveryBrief');
  });

  it('documents the flag in `od project help`', async () => {
    const result = await runCli(['project', 'help']);

    expect(result.stdout).toContain('--skip-discovery');
  });
});
