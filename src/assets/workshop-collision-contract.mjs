export const WORKSHOP_COLLISION_SCHEMA = 'axm.global-state-rts.workshop-collision/v0.1';
export const WORKSHOP_COLLISION_ASSET_ID = 'building-workshop-a';

// Derived from the verified Y-up bounds of the detailed Universal Creation workshop.
// This is a conservative broad-phase gameplay footprint, not a mesh-accurate physics hull.
const SOURCE_BOUNDS = Object.freeze({
  minX: -2.910788059234619,
  maxX: 2.744092301249278,
  minY: 0,
  maxY: 4.78499972820282,
  minZ: -2.3190720622904504,
  maxZ: 2.2659785747528076
});

const SAFETY_MARGIN_M = 0.12;
const DEG_TO_RAD = Math.PI / 180;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return Number(value);
}

function rotateLocalToWorld(x, z, yawRad) {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return Object.freeze({ x: x * c + z * s, z: -x * s + z * c });
}

function rotateWorldToLocal(x, z, yawRad) {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return Object.freeze({ x: x * c - z * s, z: x * s + z * c });
}

export function workshopCollisionContract() {
  const centerLocalX = (SOURCE_BOUNDS.minX + SOURCE_BOUNDS.maxX) / 2;
  const centerLocalZ = (SOURCE_BOUNDS.minZ + SOURCE_BOUNDS.maxZ) / 2;
  const halfWidthM = (SOURCE_BOUNDS.maxX - SOURCE_BOUNDS.minX) / 2 + SAFETY_MARGIN_M;
  const halfDepthM = (SOURCE_BOUNDS.maxZ - SOURCE_BOUNDS.minZ) / 2 + SAFETY_MARGIN_M;
  return Object.freeze({
    schema: WORKSHOP_COLLISION_SCHEMA,
    assetId: WORKSHOP_COLLISION_ASSET_ID,
    status: 'DERIVED_BROADPHASE_NOT_GAMEPLAY_ACCEPTED',
    source: Object.freeze({
      kind: 'verified-glb-bounds',
      boundsYUp: SOURCE_BOUNDS
    }),
    shape: Object.freeze({
      type: 'oriented-box-footprint',
      centerLocalXM: centerLocalX,
      centerLocalZM: centerLocalZ,
      halfWidthM,
      halfDepthM,
      minYM: SOURCE_BOUNDS.minY,
      maxYM: SOURCE_BOUNDS.maxY,
      safetyMarginM: SAFETY_MARGIN_M
    }),
    nonclaims: Object.freeze([
      'This broad-phase footprint is not mesh-accurate collision.',
      'Doorways, stairs, loose props and roof surfaces are not represented separately.',
      'A derived visual bound does not prove navigation or gameplay acceptance.',
      'Target-device physics performance is not measured by this contract.'
    ])
  });
}

export function workshopCollisionForFixture(fixture) {
  if (!fixture || fixture.assetId !== WORKSHOP_COLLISION_ASSET_ID) {
    throw new TypeError(`fixture for ${WORKSHOP_COLLISION_ASSET_ID} required`);
  }
  const xM = finite(fixture.xM, 'fixture.xM');
  const zM = finite(fixture.zM, 'fixture.zM');
  const yawDeg = finite(fixture.yawDeg || 0, 'fixture.yawDeg');
  const yawRad = yawDeg * DEG_TO_RAD;
  const contract = workshopCollisionContract();
  const offset = rotateLocalToWorld(contract.shape.centerLocalXM, contract.shape.centerLocalZM, yawRad);
  return Object.freeze({
    schema: WORKSHOP_COLLISION_SCHEMA,
    assetId: WORKSHOP_COLLISION_ASSET_ID,
    fixtureId: fixture.id || null,
    status: contract.status,
    centerXM: xM + offset.x,
    centerZM: zM + offset.z,
    yawDeg,
    yawRad,
    halfWidthM: contract.shape.halfWidthM,
    halfDepthM: contract.shape.halfDepthM,
    minYM: contract.shape.minYM,
    maxYM: contract.shape.maxYM,
    source: contract.source,
    nonclaims: contract.nonclaims
  });
}

export function pointInsideWorkshopFootprint(collision, xM, zM, { paddingM = 0 } = {}) {
  if (!collision || collision.schema !== WORKSHOP_COLLISION_SCHEMA) throw new TypeError('workshop collision required');
  finite(xM, 'xM');
  finite(zM, 'zM');
  if (!Number.isFinite(paddingM) || paddingM < 0) throw new RangeError('paddingM must be finite and >= 0');
  const local = rotateWorldToLocal(xM - collision.centerXM, zM - collision.centerZM, collision.yawRad);
  return Math.abs(local.x) <= collision.halfWidthM + paddingM
    && Math.abs(local.z) <= collision.halfDepthM + paddingM;
}

export function clampPointOutsideWorkshopFootprint(collision, xM, zM, { paddingM = 0.35 } = {}) {
  if (!collision || collision.schema !== WORKSHOP_COLLISION_SCHEMA) throw new TypeError('workshop collision required');
  finite(xM, 'xM');
  finite(zM, 'zM');
  if (!Number.isFinite(paddingM) || paddingM < 0) throw new RangeError('paddingM must be finite and >= 0');

  const local = rotateWorldToLocal(xM - collision.centerXM, zM - collision.centerZM, collision.yawRad);
  const halfX = collision.halfWidthM + paddingM;
  const halfZ = collision.halfDepthM + paddingM;
  if (Math.abs(local.x) > halfX || Math.abs(local.z) > halfZ) {
    return Object.freeze({ xM, zM, changed: false });
  }

  const pushX = halfX - Math.abs(local.x);
  const pushZ = halfZ - Math.abs(local.z);
  let correctedX = local.x;
  let correctedZ = local.z;
  if (pushX <= pushZ) correctedX = (local.x < 0 ? -1 : 1) * halfX;
  else correctedZ = (local.z < 0 ? -1 : 1) * halfZ;

  const world = rotateLocalToWorld(correctedX, correctedZ, collision.yawRad);
  return Object.freeze({
    xM: collision.centerXM + world.x,
    zM: collision.centerZM + world.z,
    changed: true
  });
}
