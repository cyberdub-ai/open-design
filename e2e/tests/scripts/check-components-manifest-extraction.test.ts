import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { discoverBrandSources } from "../../../scripts/check-components-manifest-extraction.ts";

async function writeBrand(
  root: string,
  id: string,
  files: { tokensCss?: string; fixtureHtml?: string },
): Promise<void> {
  const brandRoot = path.join(root, id);
  await mkdir(brandRoot, { recursive: true });
  await writeFile(path.join(brandRoot, "DESIGN.md"), `# ${id}\n`, "utf8");
  if (files.tokensCss !== undefined) {
    await writeFile(path.join(brandRoot, "tokens.css"), files.tokensCss, "utf8");
  }
  if (files.fixtureHtml !== undefined) {
    await writeFile(path.join(brandRoot, "components.html"), files.fixtureHtml, "utf8");
  }
}

test("brand discovery skips design systems that were never compiled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-design-brands-"));

  await writeBrand(root, "acme", {
    tokensCss: ":root { --acme-fg: #111; }",
    fixtureHtml: "<style>.btn { color: var(--acme-fg); }</style><button class=\"btn\">Go</button>",
  });
  // A brand directory carrying only its authored DESIGN.md has no compiled
  // artifacts, so it is a design-system source, not a manifest fixture.
  await writeBrand(root, "uncompiled", {});
  await mkdir(path.join(root, "_schema"), { recursive: true });

  const sources = await discoverBrandSources(root);

  assert.deepEqual(
    sources.map((source) => source.id),
    ["acme"],
  );

  await rm(root, { force: true, recursive: true });
});

test("brand discovery fails loudly on a half-compiled design system", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-design-brands-"));

  await writeBrand(root, "halfway", { tokensCss: ":root { --fg: #111; }" });

  await assert.rejects(
    () => discoverBrandSources(root),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /halfway/);
      assert.match(message, /components\.html/);
      return true;
    },
  );

  await rm(root, { force: true, recursive: true });
});
