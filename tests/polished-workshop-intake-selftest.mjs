import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPolishedWorkshopIntake } from '../src/assets/polished-workshop-intake.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const temp = mkdtempSync(join(tmpdir(), 'axm-workshop-intake-'));
const SOURCE_COMMIT = '1111111111111111111111111111111111111111';
const MERGE_COMMIT = '2222222222222222222222222222222222222222';
const TESTED_TREE = '3333333333333333333333333333333333333333';

try {
  const archivePath = join(temp, 'axm-workshop-polished.zip');
  const heroPath = join(temp, 'improvised-workshop.glb');
  const lod1Path = join(temp, 'improvised-workshop-lod1.glb');
  const archiveBytes = Buffer.from('exact-archive-fixture');
  const heroBytes = Buffer.from('exact-hero-glb-fixture');
  const lod1Bytes = Buffer.from('exact-lod1-glb-fixture');
  writeFileSync(archivePath, archiveBytes);
  writeFileSync(heroPath, heroBytes);
  writeFileSync(lod1Path, lod1Bytes);

  const reference = {
    schema: 'axm.global-state-rts.external-asset-reference/v0.1',
    assetId: 'building-improvised-workshop-polished-reference',
    status: 'REFERENCE_ACCEPTED_RUNTIME_NOT_ACCEPTED',
    source: { sha256: sha256(archiveBytes) },
    models: {
      hero: { file: 'improvised-workshop.glb', sha256: sha256(heroBytes) },
      lod1: { file: 'improvised-workshop-lod1.glb', sha256: sha256(lod1Bytes) }
    }
  };

  const verification = {
    schema: 'axm.rts-workshop-polish/v0.1',
    units: 'meters',
    glb_up: 'Y',
    glb_forward: '+Z',
    scope: 'fixture producer evidence only; no target RTS runtime claim',
    artifacts: {
      'improvised-workshop.glb': { sha256: reference.models.hero.sha256 },
      'improvised-workshop-lod1.glb': { sha256: reference.models.lod1.sha256 }
    }
  };
  const inspection = {
    'improvised-workshop.glb': {
      sha256: reference.models.hero.sha256,
      triangles: 100,
      vertices: 160,
      material_batches: 4,
      embedded_images: 8,
      bounds_y_up: { min: [-1, 0, -1], max: [1, 2, 1] }
    },
    'improvised-workshop-lod1.glb': {
      sha256: reference.models.lod1.sha256,
      triangles: 40,
      vertices: 70,
      material_batches: 4,
      embedded_images: 8,
      bounds_y_up: { min: [-1, 0, -1], max: [1, 2, 1] }
    }
  };
  const integrationReceipt = {
    source_commit: SOURCE_COMMIT,
    merge_commit: MERGE_COMMIT,
    tested_tree: TESTED_TREE,
    asset_validation: 'fixture validation'
  };
  writeFileSync(join(temp, 'verification.json'), `${JSON.stringify(verification)}\n`);
  writeFileSync(join(temp, 'glb-inspection.json'), `${JSON.stringify(inspection)}\n`);
  writeFileSync(join(temp, 'integration-receipt.json'), `${JSON.stringify(integrationReceipt)}\n`);

  const receipt = verifyPolishedWorkshopIntake({
    reference,
    archivePath,
    extractedDir: temp
  });
  assert.equal(receipt.status, 'BYTES_ACCEPTED_RUNTIME_NOT_RENDERED');
  assert.equal(receipt.candidateFor, 'building-workshop-a');
  assert.equal(receipt.exactReferenceMatches.archive.exactMatch, true);
  assert.equal(receipt.exactReferenceMatches.hero.exactMatch, true);
  assert.equal(receipt.exactReferenceMatches.lod1.exactMatch, true);
  assert.equal(receipt.producerEvidence.sourceCommit, SOURCE_COMMIT);
  assert.equal(receipt.producerEvidence.mergeCommit, MERGE_COMMIT);
  assert.equal(receipt.producerEvidence.testedTree, TESTED_TREE);
  assert.equal(receipt.producerEvidence.units, 'meters');
  assert.equal(receipt.producerEvidence.glbUp, 'Y');
  assert.equal(receipt.producerEvidence.glbForward, '+Z');
  assert.equal(receipt.consumerEvidence.packageBytes, 'TESTED');
  assert.equal(receipt.consumerEvidence.runtimeImport, 'NOT_TESTED');
  assert.equal(receipt.consumerEvidence.browserRender, 'NOT_TESTED');
  assert.equal(receipt.consumerEvidence.collision, 'NOT_TESTED');
  assert.equal(receipt.consumerEvidence.targetDeviceFps, 'NOT_TESTED');
  assert.equal(receipt.fallback.preserveProceduralPlaceholder, true);

  writeFileSync(heroPath, Buffer.from('tampered-hero'));
  assert.throws(
    () => verifyPolishedWorkshopIntake({ reference, archivePath, extractedDir: temp }),
    /hero GLB sha256 mismatch/,
    'tampered candidate bytes must fail closed'
  );
  writeFileSync(heroPath, heroBytes);

  verification.glb_up = 'Z';
  writeFileSync(join(temp, 'verification.json'), `${JSON.stringify(verification)}\n`);
  assert.throws(
    () => verifyPolishedWorkshopIntake({ reference, archivePath, extractedDir: temp }),
    /axis\/unit contract/,
    'producer coordinate mismatch must not be silently adapted'
  );
  verification.glb_up = 'Y';
  writeFileSync(join(temp, 'verification.json'), `${JSON.stringify(verification)}\n`);

  integrationReceipt.tested_tree = 'not-a-git-sha';
  writeFileSync(join(temp, 'integration-receipt.json'), `${JSON.stringify(integrationReceipt)}\n`);
  assert.throws(
    () => verifyPolishedWorkshopIntake({ reference, archivePath, extractedDir: temp }),
    /tested_tree must be a 40-character lowercase git sha/,
    'producer commit provenance must fail closed when malformed'
  );

  console.log('polished workshop exact-byte intake / provenance / runtime-hold selftest: PASS');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
