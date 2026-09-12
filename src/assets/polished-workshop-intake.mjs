import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const POLISHED_WORKSHOP_RECEIPT_SCHEMA = 'axm.global-state-rts.external-asset-intake-receipt/v0.1';

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function verifyHash(path, expected, label) {
  const actual = sha256File(path);
  if (actual !== expected) throw new Error(`${label} sha256 mismatch: expected ${expected}, got ${actual}`);
  return Object.freeze({
    file: basename(path),
    bytes: statSync(path).size,
    sha256: actual,
    exactMatch: true
  });
}

function verifyReference(reference) {
  if (!reference || typeof reference !== 'object') throw new TypeError('reference object required');
  if (reference.schema !== 'axm.global-state-rts.external-asset-reference/v0.1') {
    throw new Error(`unsupported reference schema: ${reference.schema}`);
  }
  if (reference.status !== 'REFERENCE_ACCEPTED_RUNTIME_NOT_ACCEPTED') {
    throw new Error(`reference must remain runtime-unaccepted, got ${reference.status}`);
  }
  assertString(reference.assetId, 'reference.assetId');
  assertString(reference?.source?.sha256, 'reference.source.sha256');
  for (const slot of ['hero', 'lod1']) {
    assertString(reference?.models?.[slot]?.file, `reference.models.${slot}.file`);
    assertString(reference?.models?.[slot]?.sha256, `reference.models.${slot}.sha256`);
  }
}

function verifyProducerEvidence(extractedDir, reference) {
  const verificationPath = join(extractedDir, 'verification.json');
  const inspectionPath = join(extractedDir, 'glb-inspection.json');
  const verification = readJson(verificationPath);
  const inspection = readJson(inspectionPath);

  if (verification.schema !== 'axm.rts-workshop-polish/v0.1') {
    throw new Error(`unexpected producer verification schema: ${verification.schema}`);
  }
  if (verification.units !== 'meters' || verification.glb_up !== 'Y' || verification.glb_forward !== '+Z') {
    throw new Error('producer axis/unit contract does not match Global State RTS asset intake requirements');
  }

  for (const slot of ['hero', 'lod1']) {
    const model = reference.models[slot];
    const producerArtifact = verification?.artifacts?.[model.file];
    const inspected = inspection?.[model.file];
    if (!producerArtifact || producerArtifact.sha256 !== model.sha256) {
      throw new Error(`${slot} producer artifact hash does not match pinned reference`);
    }
    if (!inspected || inspected.sha256 !== model.sha256) {
      throw new Error(`${slot} independent GLB inspection hash does not match pinned reference`);
    }
  }

  const hero = inspection[reference.models.hero.file];
  const lod1 = inspection[reference.models.lod1.file];
  if (!(lod1.triangles < hero.triangles)) throw new Error('LOD1 must contain fewer triangles than hero GLB');

  return Object.freeze({
    verificationSchema: verification.schema,
    units: verification.units,
    glbUp: verification.glb_up,
    glbForward: verification.glb_forward,
    heroInspection: Object.freeze({
      triangles: hero.triangles,
      vertices: hero.vertices,
      materialBatches: hero.material_batches,
      embeddedImages: hero.embedded_images,
      boundsYUp: hero.bounds_y_up
    }),
    lod1Inspection: Object.freeze({
      triangles: lod1.triangles,
      vertices: lod1.vertices,
      materialBatches: lod1.material_batches,
      embeddedImages: lod1.embedded_images,
      boundsYUp: lod1.bounds_y_up
    }),
    producerScope: verification.scope
  });
}

export function verifyPolishedWorkshopIntake({
  reference,
  archivePath,
  extractedDir,
  targetAssetId = 'building-workshop-a'
}) {
  verifyReference(reference);
  assertString(archivePath, 'archivePath');
  assertString(extractedDir, 'extractedDir');
  assertString(targetAssetId, 'targetAssetId');

  const archive = verifyHash(archivePath, reference.source.sha256, 'package archive');
  const heroPath = join(extractedDir, reference.models.hero.file);
  const lod1Path = join(extractedDir, reference.models.lod1.file);
  const hero = verifyHash(heroPath, reference.models.hero.sha256, 'hero GLB');
  const lod1 = verifyHash(lod1Path, reference.models.lod1.sha256, 'LOD1 GLB');
  const producerEvidence = verifyProducerEvidence(extractedDir, reference);

  return Object.freeze({
    schema: POLISHED_WORKSHOP_RECEIPT_SCHEMA,
    assetId: reference.assetId,
    candidateFor: targetAssetId,
    status: 'BYTES_ACCEPTED_RUNTIME_NOT_RENDERED',
    exactReferenceMatches: Object.freeze({ archive, hero, lod1 }),
    producerEvidence,
    consumerEvidence: Object.freeze({
      packageBytes: 'TESTED',
      glbBytes: 'TESTED',
      declaredUnitsAndAxis: 'TESTED',
      runtimeImport: 'NOT_TESTED',
      browserRender: 'NOT_TESTED',
      localRtsPlacement: 'NOT_TESTED',
      splitScreenReadability: 'NOT_TESTED',
      collision: 'NOT_TESTED',
      navigation: 'NOT_TESTED',
      drawCallPerformance: 'NOT_TESTED',
      targetDeviceFps: 'NOT_TESTED'
    }),
    fallback: Object.freeze({
      preserveProceduralPlaceholder: true,
      reason: 'Exact external bytes are accepted for intake, but browser/runtime acceptance has not occurred.'
    }),
    nonclaims: Object.freeze([
      'Exact package bytes do not prove browser import or rendering.',
      'Producer geometry inspection does not prove Global State RTS scale, collision, navigation, draw-call cost, split-screen readability or FPS.',
      'The procedural workshop placeholder remains the runtime fallback until separate target-side evidence exists.'
    ])
  });
}
