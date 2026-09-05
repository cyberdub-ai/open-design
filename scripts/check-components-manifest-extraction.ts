import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractComponentsManifest,
  summarizeComponentsManifestForPrompt,
} from '../packages/contracts/src/design-systems/components-manifest.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const designSystemsRoot = path.join(repoRoot, 'design-systems');
const skippedDesignSystemDirectories = new Set(['_schema']);

type BrandSources = {
  id: string;
  fixturePath: string;
  tokensCss: string;
  fixtureHtml: string;
};

export async function checkComponentsManifestExtraction(): Promise<boolean> {
  const sources = await discoverBrandSources();
  const violations: string[] = [];
  let selectorCount = 0;
  let groupCount = 0;

  for (const source of sources) {
    try {
      const manifest = extractComponentsManifest({
        brandId: source.id,
        fixtureHtml: source.fixtureHtml,
        tokensCss: source.tokensCss,
      });
      const summary = summarizeComponentsManifestForPrompt(manifest);

      selectorCount += manifest.fixture.selectorCount;
      groupCount += manifest.groups.filter((group) => group.present).length;

      if (manifest.fixture.styleBlockCount === 0) {
        violations.push(`[${source.id}] ${toRepositoryPath(source.fixturePath)} has no <style> blocks to summarize.`);
      }
      if (manifest.fixture.selectorCount === 0) {
        violations.push(`[${source.id}] ${toRepositoryPath(source.fixturePath)} produced a manifest with zero CSS selectors.`);
      }
      if (!summary.includes(`components.manifest schema v${manifest.schemaVersion} for ${source.id}`)) {
        violations.push(`[${source.id}] manifest summary is missing its schema/id header.`);
      }
    } catch (err) {
      violations.push(
        `[${source.id}] failed to extract manifest from ${toRepositoryPath(source.fixturePath)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (violations.length > 0) {
    console.error('Design system component manifest extraction violations:');
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    console.error('Every compiled design system must remain consumable through the structured component manifest path.');
    return false;
  }

  console.log(
    `Design system component manifest extraction passed: ${sources.length} fixtures summarized (${selectorCount} selectors across ${groupCount} present component groups).`,
  );
  return true;
}

/**
 * A directory under `design-systems/` is a manifest fixture only once it has
 * been compiled, and "compiled" means both artifacts are present: `tokens.css`
 * and `components.html`. A directory carrying neither is an authored source
 * that was never compiled (or a local scratch brand outside git) and is not a
 * design system this check owns. A directory carrying exactly one of the two is
 * a broken compile and must fail loudly rather than be silently skipped.
 */
export async function discoverBrandSources(root: string = designSystemsRoot): Promise<BrandSources[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const sources: BrandSources[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || skippedDesignSystemDirectories.has(entry.name)) continue;

    const brandRoot = path.join(root, entry.name);
    const tokensPath = path.join(brandRoot, 'tokens.css');
    const fixturePath = path.join(brandRoot, 'components.html');
    const [tokensCss, fixtureHtml] = await Promise.all([
      readCompiledArtifact(tokensPath),
      readCompiledArtifact(fixturePath),
    ]);

    if (tokensCss === null && fixtureHtml === null) continue;
    if (tokensCss === null || fixtureHtml === null) {
      const missing = tokensCss === null ? tokensPath : fixturePath;
      throw new Error(
        `[${entry.name}] design system is half-compiled: ${toRepositoryPath(missing)} is missing while its counterpart exists.`,
      );
    }

    sources.push({
      id: entry.name,
      fixturePath,
      tokensCss,
      fixtureHtml,
    });
  }

  return sources.sort((a, b) => a.id.localeCompare(b.id));
}

async function readCompiledArtifact(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null;
    throw err;
  }
}

function toRepositoryPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  checkComponentsManifestExtraction().then((passed) => {
    process.exitCode = passed ? 0 : 1;
  }, (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
