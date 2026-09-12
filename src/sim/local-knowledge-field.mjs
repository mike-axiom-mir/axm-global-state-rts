export const LOCAL_KNOWLEDGE_FIELD_SCHEMA = 'axm.global-state-rts.local-knowledge-field/v0.1';

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function positive(value, label) {
  finite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero`);
  return value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function keyFor(cx, cz) {
  return `${cx}:${cz}`;
}

export class LocalKnowledgeField {
  constructor(region, { cellSizeM = 96 } = {}) {
    if (!region?.id || !Number.isFinite(region.halfSizeM) || region.halfSizeM <= 0) {
      throw new TypeError('region with id and positive halfSizeM required');
    }
    positive(cellSizeM, 'cellSizeM');
    this.schema = LOCAL_KNOWLEDGE_FIELD_SCHEMA;
    this.region = region;
    this.cellSizeM = cellSizeM;
    this.minCell = Math.floor(-region.halfSizeM / cellSizeM);
    this.maxCell = Math.floor(region.halfSizeM / cellSizeM);
    this.visible = new Set();
    this.explored = new Set();
    this.revision = 0;
    this.lastSimulationRevision = -1;
    this.lastLightingPhase = null;
  }

  #coordinateToCell(xM, zM) {
    finite(xM, 'xM');
    finite(zM, 'zM');
    return {
      cx: clamp(Math.floor(xM / this.cellSizeM), this.minCell, this.maxCell),
      cz: clamp(Math.floor(zM / this.cellSizeM), this.minCell, this.maxCell)
    };
  }

  #markDisc(targetSet, source, radiusM) {
    positive(radiusM, 'radiusM');
    const center = this.#coordinateToCell(source.xM, source.zM);
    const reach = Math.ceil(radiusM / this.cellSizeM) + 1;
    const radiusSq = radiusM * radiusM;
    const half = this.cellSizeM * 0.5;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = center.cx + dx;
        const cz = center.cz + dz;
        if (cx < this.minCell || cx > this.maxCell || cz < this.minCell || cz > this.maxCell) continue;
        const centerXM = (cx + 0.5) * this.cellSizeM;
        const centerZM = (cz + 0.5) * this.cellSizeM;
        const nearestXM = clamp(source.xM, centerXM - half, centerXM + half);
        const nearestZM = clamp(source.zM, centerZM - half, centerZM + half);
        const distSq = (nearestXM - source.xM) ** 2 + (nearestZM - source.zM) ** 2;
        if (distSq <= radiusSq) targetSet.add(keyFor(cx, cz));
      }
    }
  }

  observeSimulationSnapshot(snapshot) {
    if (!snapshot || snapshot.regionId !== this.region.id) throw new TypeError('snapshot must belong to this region');
    const nextVisible = new Set();
    const crewRadius = positive(snapshot.environment?.crewVisionRadiusM, 'crewVisionRadiusM');
    for (const crew of snapshot.crew || []) this.#markDisc(nextVisible, crew, crewRadius);

    if (snapshot.lightTower?.active) {
      this.#markDisc(
        nextVisible,
        snapshot.lightTower.position,
        positive(snapshot.environment?.lightTowerVisionRadiusM, 'lightTowerVisionRadiusM')
      );
    }

    let changed = nextVisible.size !== this.visible.size;
    if (!changed) {
      for (const key of nextVisible) {
        if (!this.visible.has(key)) {
          changed = true;
          break;
        }
      }
    }

    let newlyExplored = 0;
    for (const key of nextVisible) {
      if (!this.explored.has(key)) {
        this.explored.add(key);
        newlyExplored += 1;
      }
    }

    this.visible = nextVisible;
    this.lastSimulationRevision = Number(snapshot.revision) || 0;
    this.lastLightingPhase = snapshot.environment?.lightingPhase || 'day';
    if (changed || newlyExplored) this.revision += 1;
    return this.stats();
  }

  cellStatus(cx, cz) {
    const key = keyFor(cx, cz);
    if (this.visible.has(key)) return 'visible';
    if (this.explored.has(key)) return 'explored-memory';
    return 'unexplored';
  }

  statusAt(xM, zM) {
    const { cx, cz } = this.#coordinateToCell(xM, zM);
    return this.cellStatus(cx, cz);
  }

  isVisible(xM, zM) {
    return this.statusAt(xM, zM) === 'visible';
  }

  isExplored(xM, zM) {
    return this.statusAt(xM, zM) !== 'unexplored';
  }

  cellsAround(centerXM, centerZM, radiusM) {
    finite(centerXM, 'centerXM');
    finite(centerZM, 'centerZM');
    positive(radiusM, 'radiusM');
    const center = this.#coordinateToCell(centerXM, centerZM);
    const reach = Math.ceil(radiusM / this.cellSizeM);
    const cells = [];
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = center.cx + dx;
        const cz = center.cz + dz;
        if (cx < this.minCell || cx > this.maxCell || cz < this.minCell || cz > this.maxCell) continue;
        const xM = (cx + 0.5) * this.cellSizeM;
        const zM = (cz + 0.5) * this.cellSizeM;
        if (Math.hypot(xM - centerXM, zM - centerZM) > radiusM + this.cellSizeM) continue;
        cells.push(Object.freeze({ cx, cz, key: keyFor(cx, cz), xM, zM, status: this.cellStatus(cx, cz) }));
      }
    }
    return Object.freeze(cells);
  }

  stats() {
    return Object.freeze({
      schema: LOCAL_KNOWLEDGE_FIELD_SCHEMA,
      regionId: this.region.id,
      revision: this.revision,
      cellSizeM: this.cellSizeM,
      visibleCells: this.visible.size,
      exploredCells: this.explored.size,
      lightingPhase: this.lastLightingPhase,
      simulationRevision: this.lastSimulationRevision
    });
  }
}

export function createLocalKnowledgeField(region, options = {}) {
  return new LocalKnowledgeField(region, options);
}
