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

test('four static GLB instances share immutable heavy resources and independent object wrappers', async ({ page }) => {
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

    const beforeDispose = cache.staticGlbDecodeCacheStats();
    meshes[0].geometry.dispose();
    meshes[0].material.dispose();
    meshes[0].material.map.dispose();
    const afterDispose = cache.staticGlbDecodeCacheStats();

    return {
      sha256,
      statuses,
      beforeDispose,
      afterDispose,
      receipts: builds.map(result => ({
        sha256: result.receipt.sha256,
        triangles: result.receipt.triangles,
        materials: result.receipt.materials,
        embeddedImages: result.receipt.embeddedImages,
        resourceMode: result.receipt.decodedTemplateCache.resourceMode
      })),
      distinctObjects: new Set(builds.map(result => result.object.uuid)).size === 4,
      sharedGeometries: meshes.every(mesh => mesh.geometry === meshes[0].geometry),
      sharedMaterials: meshes.every(mesh => mesh.material === meshes[0].material),
      sharedTextures: meshes.every(mesh => mesh.material.map === meshes[0].material.map),
      sharedResourceMarkers: meshes.every(mesh => (
        mesh.userData.axmSharedDecodedResources === true
        && mesh.geometry.userData.axmSharedImmutableResource === true
        && mesh.material.userData.axmSharedImmutableResource === true
        && mesh.material.map.userData.axmSharedImmutableResource === true
      )),
      wrongHashRejected
    };
  });

  expect(evidence.statuses.filter(status => status === 'MISS')).toHaveLength(1);
  expect(evidence.statuses.filter(status => status === 'HIT')).toHaveLength(3);
  expect(evidence.beforeDispose.templates).toBe(1);
  expect(evidence.beforeDispose.templateBuilds).toBe(1);
  expect(evidence.beforeDispose.cacheMisses).toBe(1);
  expect(evidence.beforeDispose.cacheHits).toBe(3);
  expect(evidence.beforeDispose.instances).toBe(4);
  expect(evidence.beforeDispose.hashBuilds).toBe(1);
  expect(evidence.beforeDispose.hashHits).toBe(4); // 3 sibling callers + rejected wrong-hash caller.
  expect(evidence.beforeDispose.resourceMode).toBe('SHARED_IMMUTABLE_GEOMETRY_MATERIAL_TEXTURE');
  expect(evidence.beforeDispose.sharedGeometries).toBeGreaterThan(0);
  expect(evidence.beforeDispose.sharedMaterials).toBeGreaterThan(0);
  expect(evidence.beforeDispose.sharedTextures).toBeGreaterThan(0);
  expect(evidence.distinctObjects).toBe(true);
  expect(evidence.sharedGeometries).toBe(true);
  expect(evidence.sharedMaterials).toBe(true);
  expect(evidence.sharedTextures).toBe(true);
  expect(evidence.sharedResourceMarkers).toBe(true);
  expect(evidence.wrongHashRejected).toBe(true);
  expect(evidence.afterDispose.suppressedDisposals - evidence.beforeDispose.suppressedDisposals).toBe(3);
  for (const receipt of evidence.receipts) {
    expect(receipt.sha256).toBe(evidence.sha256);
    expect(receipt.triangles).toBe(1);
    expect(receipt.materials).toBe(1);
    expect(receipt.embeddedImages).toBe(1);
    expect(receipt.resourceMode).toBe('SHARED_IMMUTABLE_GEOMETRY_MATERIAL_TEXTURE');
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
