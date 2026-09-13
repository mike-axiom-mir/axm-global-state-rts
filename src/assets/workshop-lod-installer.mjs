import { selectWorkshopRuntimeLod } from './workshop-lod-policy.mjs';

export const WORKSHOP_LOD_INSTALLER_SCHEMA = 'axm.global-state-rts.workshop-lod-installer/v0.1';

function arrayBufferLike(value, label) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new TypeError(`${label} bytes must be an ArrayBuffer or typed-array view`);
}

function variantForRole(variants, role) {
  const variant = variants?.[role];
  if (!variant || typeof variant !== 'object') throw new Error(`missing workshop LOD variant: ${role}`);
  if (!/^[a-f0-9]{64}$/.test(String(variant.expectedSha256 || ''))) {
    throw new TypeError(`${role} expectedSha256 must be a lowercase SHA-256 hex digest`);
  }
  return Object.freeze({
    role,
    bytes: arrayBufferLike(variant.bytes, `${role}`),
    expectedSha256: variant.expectedSha256
  });
}

export async function installWorkshopLodForView({
  view,
  variants,
  install,
  assetId = 'building-workshop-a',
  uniformScale = 1,
  focus = false
} = {}) {
  if (!view || view.mode !== 'local-rts') throw new Error('local-rts seat view required for workshop LOD selection');
  if (!Number.isFinite(view.local?.distanceM)) throw new TypeError('local-rts view must expose finite distanceM');
  if (typeof install !== 'function') throw new TypeError('install callback required');
  if (typeof assetId !== 'string' || !assetId) throw new TypeError('assetId required');
  if (!Number.isFinite(uniformScale) || uniformScale <= 0 || uniformScale > 100) {
    throw new RangeError('uniformScale must be >0 and <=100');
  }

  const selection = selectWorkshopRuntimeLod(view.local.distanceM);
  const variant = variantForRole(variants, selection.role);
  const receipt = await install({
    assetId,
    bytes: variant.bytes,
    expectedSha256: variant.expectedSha256,
    uniformScale,
    focus
  });

  if (!receipt || receipt.sha256 !== variant.expectedSha256) {
    throw new Error('workshop LOD install receipt did not bind to selected producer bytes');
  }

  return Object.freeze({
    schema: WORKSHOP_LOD_INSTALLER_SCHEMA,
    status: 'SELECTED_VARIANT_INSTALLED',
    selection,
    installedRole: selection.role,
    installedSha256: receipt.sha256,
    receipt,
    farCandidateStatus: selection.farCandidateStatus,
    nonclaim: 'This callable installs the evidence-bound tactical/RTS tier only; far automatic handoff, mass-building performance and target-device FPS remain separate gates.'
  });
}
