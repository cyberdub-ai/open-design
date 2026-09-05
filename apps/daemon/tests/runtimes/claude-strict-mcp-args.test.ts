import { afterEach, describe, expect, it, vi } from 'vitest';

import { claudeAgentDef } from '../../src/runtimes/defs/claude.js';

// Fork behavior with no coverage until now, and live in the deployed daemon
// (`OD_CLAUDE_STRICT_MCP=1` in the service unit). Without
// `--strict-mcp-config`, claude-code merges the operator's own user-level
// `~/.claude.json` MCP servers into the agent it spawns, so a run inherits
// whatever the human happened to have enabled — extra tools, extra token cost,
// and a non-reproducible tool surface. The flag is one push into an argv
// array: precisely the shape a merge conflict resolves away in silence.
describe('claude buildArgs strict MCP config', () => {
  const original = process.env.OD_CLAUDE_STRICT_MCP;

  afterEach(() => {
    if (original === undefined) delete process.env.OD_CLAUDE_STRICT_MCP;
    else process.env.OD_CLAUDE_STRICT_MCP = original;
    vi.unstubAllEnvs();
  });

  it('emits --strict-mcp-config when OD_CLAUDE_STRICT_MCP=1', () => {
    vi.stubEnv('OD_CLAUDE_STRICT_MCP', '1');

    const args = claudeAgentDef.buildArgs('prompt', [], [], {}, {});

    expect(args).toContain('--strict-mcp-config');
  });

  it('leaves the flag off by default so an unset daemon keeps claude-code defaults', () => {
    delete process.env.OD_CLAUDE_STRICT_MCP;

    const args = claudeAgentDef.buildArgs('prompt', [], [], {}, {});

    expect(args).not.toContain('--strict-mcp-config');
  });

  // Opt-in is exactly "1". A truthy-looking value such as `true` or `0` must
  // not silently enable or disable it out of step with the documented switch.
  it('treats any value other than "1" as off', () => {
    for (const value of ['0', 'true', 'yes', '']) {
      vi.stubEnv('OD_CLAUDE_STRICT_MCP', value);
      expect(claudeAgentDef.buildArgs('prompt', [], [], {}, {})).not.toContain(
        '--strict-mcp-config',
      );
    }
  });

  // The flag must land before the permission mode that closes the argv, i.e.
  // inside the flag list claude-code parses, not appended after the prompt.
  it('emits the flag alongside the other CLI flags', () => {
    vi.stubEnv('OD_CLAUDE_STRICT_MCP', '1');

    const args = claudeAgentDef.buildArgs('prompt', [], [], {}, {});

    expect(args.indexOf('--strict-mcp-config')).toBeLessThan(args.indexOf('--permission-mode'));
  });
});
