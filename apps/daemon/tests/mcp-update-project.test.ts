import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleMcpToolCall } from '../src/mcp.js';
import { _resetMcpWorkspaceContextCacheForTests } from '../src/mcp-workspace-context.js';

// `update_project` is fork behavior that an upstream merge has already dropped
// once (restored by e733c1118f) and re-landed schema-only a second time. Its
// tool definition is covered by tests/mcp-write-tools.test.ts; what was never
// covered is what the tool DOES: which HTTP verb it speaks, that it refuses an
// empty patch before touching the daemon, that omitted fields stay omitted
// rather than being sent as nulls, and that a rename drops the name->id cache
// so the next lookup does not resolve against the old name.

const originalFetch = globalThis.fetch;

function withDirectory(
  fn: (url: string, init?: RequestInit) => Promise<Response>,
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/workspace/directory')) {
      return new Response(JSON.stringify({ items: [], activeWorkspaceId: null }), { status: 200 });
    }
    return fn(url, init);
  };
}

function firstText(result: { content: Array<{ text: string }> }): string {
  const item = result.content[0];
  if (!item) throw new Error('expected MCP text content');
  return item.text;
}

// mcp.ts caches the project list per baseUrl for 5 s; a shared baseUrl would
// let one test's fixture answer another test's lookup.
let portCounter = 19400;
function nextBaseUrl(): string {
  portCounter += 1;
  return `http://127.0.0.1:${portCounter}`;
}

describe('public MCP update_project', () => {
  afterEach(() => {
    _resetMcpWorkspaceContextCacheForTests();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('patches only the fields it was given', async () => {
    const base = nextBaseUrl();
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/projects')) {
        return new Response(
          JSON.stringify({ projects: [{ id: 'project-1', name: 'Demo' }] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: 'project-1', name: 'Demo' }), { status: 200 });
    });
    vi.stubGlobal('fetch', withDirectory(fetchMock));

    await handleMcpToolCall(base, 'update_project', {
      project: 'Demo',
      skillId: 'deck',
    });

    const [patchUrl, patchInit] = fetchMock.mock.calls.at(-1)!;
    expect(patchUrl).toBe(`${base}/api/projects/project-1`);
    expect(patchInit?.method).toBe('PATCH');
    expect(JSON.parse(String(patchInit?.body))).toEqual({ skillId: 'deck' });
  });

  it('передаёт контекст workspace при обновлении проекта', async () => {
    const base = nextBaseUrl();
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/workspace/directory')) {
        return Response.json({
          items: [{
            workspaceId: 'ws-personal', workspaceName: 'Personal',
            workspaceType: 'personal', workspaceMemberId: 'mem-1',
            role: 'owner', memberStatus: 'active', lifecycleState: 'active',
          }],
          activeWorkspaceId: 'ws-personal',
        });
      }
      if (url.endsWith('/projects')) {
        return Response.json({ projects: [{ id: 'project-1', name: 'Demo' }] });
      }
      return Response.json({ id: 'project-1', name: 'Renamed' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleMcpToolCall(base, 'update_project', {
      project: 'Demo', name: 'Renamed',
    });

    expect(result.isError).toBeFalsy();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch?.[0]).toBe(`${base}/api/projects/project-1`);
    expect(patch?.[1]?.headers).toMatchObject({
      'x-od-workspace-id': 'ws-personal',
      'x-od-workspace-member-id': 'mem-1',
    });
  });

  it('refuses an empty patch without calling the daemon', async () => {
    const base = nextBaseUrl();
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/projects')) {
        return new Response(
          JSON.stringify({ projects: [{ id: 'project-1', name: 'Demo' }] }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', withDirectory(fetchMock));

    const result = await handleMcpToolCall(base, 'update_project', { project: 'Demo' });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/no fields to update/i);
    const patched = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patched).toEqual([]);
  });

  // The cache is keyed by base URL and lives 5 s. A rename inside that window
  // would otherwise leave the tool resolving the OLD name to the project and
  // the NEW name to nothing at all — the exact confusion an agent that renames
  // and then keeps working walks into.
  it('drops the project-list cache after a rename so the new name resolves', async () => {
    const base = nextBaseUrl();
    let renamed = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/projects')) {
        return new Response(
          JSON.stringify({
            projects: [{ id: 'project-1', name: renamed ? 'Renamed' : 'Demo' }],
          }),
          { status: 200 },
        );
      }
      if (init?.method === 'PATCH') {
        renamed = true;
        return new Response(JSON.stringify({ id: 'project-1', name: 'Renamed' }), { status: 200 });
      }
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', withDirectory(fetchMock));

    await handleMcpToolCall(base, 'update_project', { project: 'Demo', name: 'Renamed' });
    const after = await handleMcpToolCall(base, 'list_files', { project: 'Renamed' });

    expect(after.isError).toBeFalsy();
    const listCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/projects'));
    expect(listCalls.length).toBeGreaterThan(1);
  });

  // A patch that is not a rename must NOT pay for a refetch: the cache exists
  // because agents make several name lookups in a row.
  it('keeps the cache when the patch is not a rename', async () => {
    const base = nextBaseUrl();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/projects')) {
        return new Response(
          JSON.stringify({ projects: [{ id: 'project-1', name: 'Demo' }] }),
          { status: 200 },
        );
      }
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ id: 'project-1', name: 'Demo' }), { status: 200 });
      }
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', withDirectory(fetchMock));

    await handleMcpToolCall(base, 'update_project', { project: 'Demo', pendingPrompt: 'go on' });
    await handleMcpToolCall(base, 'list_files', { project: 'Demo' });

    const listCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/projects'));
    expect(listCalls).toHaveLength(1);
  });
});
