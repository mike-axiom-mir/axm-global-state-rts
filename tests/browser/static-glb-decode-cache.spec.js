import { expect, test } from '@playwright/test';

function captureRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText || 'failed'})`));
  return failures;
}

test('four static GLB instances share one decoded template while keeping disposable wrappers separate', async ({ page }) => {
  const failures = captureRuntimeFailures(page);
  const response = await page.goto('http://127.0.0.1:4174/game/?players=1', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);

  const evidence = await page.evaluate(async () => {
    const [{ createStaticGlbFixture }, cache] = await Promise.all([
      import('/tests/helpers/static-glb-fixture.mjs'),
      import('/src/assets/cached-static-glb-runtime.mjs')
    ]);
    const bytes = createStaticGlbFixture();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');

    const builds = await Promise.all(Array.from({ length: 4 }, () => cache.buildStaticGlbScene(bytes, { expectedSha256: sha256 })));
    const statuses = builds.map(result => result.receipt.decodedTemplateCache.status);
    const meshes = builds.map(result => {
      let first = null;
      result.object.traverse(object => {
        if (!first && object.isMesh) first = object;
      });
      return first;
    });

    let wrongHashRejected = false;
    try {
      await cache.buildStaticGlbScene(bytes, { expectedSha256: '0'.repeat(64) });
    } catch (error) {
      wrongHashRejected = String(error.message).includes('hash mismatch');
    }

    return {
      sha256,
      statuses,
      stats: cache.staticGlbDecodeCacheStats(),
      receipts: builds.map(result => ({
        sha256: result.receipt.sha256,
        triangles: result.receipt.triangles,
        materials: result.receipt.materials,
        embeddedImages: result.receipt.embeddedImages
      })),
      distinctObjects: new Set(builds.map(result => result.object.uuid)).size === 4,
      distinctGeometries: meshes.every((mesh, index) => meshes.every((other, otherIndex) => index === otherIndex || mesh.geometry !== other.geometry)),
      distinctMaterials: meshes.every((mesh, index) => meshes.every((other, otherIndex) => index === otherIndex || mesh.material !== other.material)),
      distinctTextures: meshes.every((mesh, index) => meshes.every((other, otherIndex) => index === otherIndex || mesh.material.map !== other.material.map)),
      sharedDecodedImageSource: meshes.every(mesh => mesh.material.map?.source === meshes[0].material.map?.source),
      wrongHashRejected
    };
  });

  expect(evidence.statuses.filter(status => status === 'MISS')).toHaveLength(1);
  expect(evidence.statuses.filter(status => status === 'HIT')).toHaveLength(3);
  expect(evidence.stats.templates).toBe(1);
  expect(evidence.stats.templateBuilds).toBe(1);
  expect(evidence.stats.cacheMisses).toBe(1);
  expect(evidence.stats.cacheHits).toBe(3);
  expect(evidence.stats.instances).toBe(4);
  expect(evidence.distinctObjects).toBe(true);
  expect(evidence.distinctGeometries).toBe(true);
  expect(evidence.distinctMaterials).toBe(true);
  expect(evidence.distinctTextures).toBe(true);
  expect(evidence.sharedDecodedImageSource).toBe(true);
  expect(evidence.wrongHashRejected).toBe(true);
  for (const receipt of evidence.receipts) {
    expect(receipt.sha256).toBe(evidence.sha256);
    expect(receipt.triangles).toBe(1);
    expect(receipt.materials).toBe(1);
    expect(receipt.embeddedImages).toBe(1);
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
