// @ts-nocheck
export {
  AGENT_DEFS,
  getAgentDef,
  readLocalAgentProfileDefs,
} from './runtimes/registry.js';
export { detectAgents, detectAgentsStream } from './runtimes/detection.js';
export {
  resolveOnPath,
  inspectAgentExecutableResolution,
  resolveAgentExecutable,
} from './runtimes/executables.js';
export { applyAgentLaunchEnv, resolveAgentLaunch } from './runtimes/launch.js';
export { resolveAgentBin } from './runtimes/resolution.js';
export { openDesignAmrTraceEnv, spawnEnvForAgent } from './runtimes/env.js';
export { buildLiveArtifactsMcpServersForAgent } from './runtimes/mcp.js';
export {
    // ... 1362 lines omitted
export {
    // ... 1361 lines omitted
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import path from 'node:path';
import { homedir } from 'node:os';
import { wellKnownUserToolchainBins } from '@open-design/platform';
// ... 1354 more lines (total: 1375)