export const SPLIT_LAYOUT_SCHEMA = 'axm.global-state-rts.split-layout/v0.1';

function assertSeatCount(seatCount) {
  if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 4) {
    throw new RangeError('seatCount must be an integer from 1 to 4');
  }
}

function rect(seatIndex, x, y, width, height) {
  return Object.freeze({
    seatIndex,
    seatId: `seat-${seatIndex}`,
    x,
    y,
    width,
    height
  });
}

export function normalizedSplitLayout(seatCount, { orientation = 'landscape' } = {}) {
  assertSeatCount(seatCount);
  if (!['landscape', 'portrait'].includes(orientation)) throw new RangeError('orientation must be landscape or portrait');

  if (seatCount === 1) return Object.freeze([rect(1, 0, 0, 1, 1)]);

  if (seatCount === 2) {
    return orientation === 'landscape'
      ? Object.freeze([rect(1, 0, 0, .5, 1), rect(2, .5, 0, .5, 1)])
      : Object.freeze([rect(1, 0, 0, 1, .5), rect(2, 0, .5, 1, .5)]);
  }

  if (seatCount === 3) {
    return orientation === 'landscape'
      ? Object.freeze([
          rect(1, 0, 0, 1 / 3, 1),
          rect(2, 1 / 3, 0, 1 / 3, 1),
          rect(3, 2 / 3, 0, 1 / 3, 1)
        ])
      : Object.freeze([
          rect(1, 0, 0, 1, 1 / 3),
          rect(2, 0, 1 / 3, 1, 1 / 3),
          rect(3, 0, 2 / 3, 1, 1 / 3)
        ]);
  }

  return Object.freeze([
    rect(1, 0, 0, .5, .5),
    rect(2, .5, 0, .5, .5),
    rect(3, 0, .5, .5, .5),
    rect(4, .5, .5, .5, .5)
  ]);
}

export function pixelSplitLayout(widthPx, heightPx, seatCount) {
  if (!Number.isInteger(widthPx) || widthPx <= 0 || !Number.isInteger(heightPx) || heightPx <= 0) {
    throw new RangeError('widthPx and heightPx must be positive integers');
  }
  const orientation = widthPx >= heightPx ? 'landscape' : 'portrait';
  const normalized = normalizedSplitLayout(seatCount, { orientation });

  return Object.freeze(normalized.map((viewport, index) => {
    const x0 = Math.round(viewport.x * widthPx);
    const y0 = Math.round(viewport.y * heightPx);
    const x1 = index === normalized.length - 1 && seatCount === 3 && orientation === 'landscape'
      ? widthPx
      : Math.round((viewport.x + viewport.width) * widthPx);
    const y1 = index === normalized.length - 1 && seatCount === 3 && orientation === 'portrait'
      ? heightPx
      : Math.round((viewport.y + viewport.height) * heightPx);
    return Object.freeze({
      seatIndex: viewport.seatIndex,
      seatId: viewport.seatId,
      x: x0,
      y: y0,
      width: Math.max(1, x1 - x0),
      height: Math.max(1, y1 - y0)
    });
  }));
}

export function createSeatView({ seatId, surfaceId = 'local-display-0', viewport = null, visualOptions = null } = {}) {
  if (typeof seatId !== 'string' || !seatId) throw new TypeError('seatId is required');
  return Object.freeze({
    schema: 'axm.global-state-rts.seat-view/v0.1',
    seatId,
    surfaceId: String(surfaceId),
    viewport,
    visualOptions,
    cameraStateOwner: seatId
  });
}
