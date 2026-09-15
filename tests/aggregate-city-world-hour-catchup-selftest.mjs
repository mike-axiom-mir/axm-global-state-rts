import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAggregateCity } from '../src/sim/aggregate-city.mjs';
import {
  createAggregateCityWorldHourCatchupAuthority
} from '../src/hosted/aggregate-city-world-hour-catchup.mjs';
import {
  createFileWorldJournalStore,
  createMemoryWorldJournalStore
} from '../src/hosted/journal-store.mjs';
import { WORLD_HOUR_MS } from '../src/hosted/world-clock.mjs';
import { buildWorldLandmarks } from '../src/world/world-landmarks.mjs';

const worldSeed = 'aggregate-city-world-hour-catchup-selftest';
const landmarks = buildWorldLandmarks({
  worldSeed,
  majorCityCount: 3,
  regionalCityCount: 8
});
const landmark = landmarks.majorCities[0];
const epochMs = 5_000_000;
const initialWorldHour = 200;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axm-city-catchup-'));
const journalPath = path.join(tempDir, 'city-catchup.jsonl');

function hourlyReference(targetWorldHour) {
  const city = createAggregateCity(landmark, { worldSeed });
  const elapsedHours = targetWorldHour - initialWorldHour;
  for (let index = 0; index < elapsedHours; index++) city.advance(3600);
  return city.snapshot();
}

try {
  const authority = createAggregateCityWorldHourCatchupAuthority({
    landmark,
    worldSeed,
    initialWorldHour,
    epochMs,
    store: createFileWorldJournalStore(journalPath)
  });

  const genesis = authority.snapshot();
  assert.equal(genesis.initialWorldHour, initialWorldHour);
  assert.equal(genesis.lastProcessedWorldHour, initialWorldHour);
  assert.equal(genesis.journalRevision, 1, 'genesis is durable evidence rather than implicit process memory');
  assert.equal(genesis.city.elapsedSeconds, 0);

  const targetHour = initialWorldHour + 6;
  const nowMs = epochMs + targetHour * WORLD_HOUR_MS + Math.floor(WORLD_HOUR_MS / 3);
  const first = authority.catchUpToNow(nowMs);
  assert.equal(first.accepted, true);
  assert.equal(first.reused, false);
  assert.equal(first.elapsedWorldHours, 6);
  assert.equal(first.snapshot.lastProcessedWorldHour, targetHour);
  assert.equal(first.snapshot.city.elapsedSeconds, 6 * 3600);
  assert.deepEqual(first.snapshot.city, hourlyReference(targetHour), 'catch-up resolves the same bounded hourly transitions as an active hourly reference');

  const firstRevision = first.snapshot.journalRevision;
  const firstHead = first.snapshot.journalHeadHash;
  const duplicate = authority.catchUpToWorldHour(targetHour);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.snapshot.journalRevision, firstRevision, 'same target hour cannot double-produce or append another transition');
  assert.equal(duplicate.snapshot.journalHeadHash, firstHead);

  const backward = authority.catchUpToWorldHour(targetHour - 1);
  assert.equal(backward.accepted, false);
  assert.equal(backward.reason, 'world-time-cannot-move-backward');
  assert.equal(authority.snapshot().journalRevision, firstRevision, 'backward requests cannot mutate canonical catch-up state');

  const restarted = createAggregateCityWorldHourCatchupAuthority({
    landmark,
    worldSeed,
    initialWorldHour,
    epochMs,
    store: createFileWorldJournalStore(journalPath)
  });
  assert.deepEqual(restarted.snapshot(), authority.snapshot(), 'restart replays the durable journal to the identical city state and hash');

  const secondTarget = initialWorldHour + 12;
  const second = restarted.catchUpToWorldHour(secondTarget);
  assert.equal(second.accepted, true);
  assert.equal(second.elapsedWorldHours, 6);
  assert.deepEqual(second.snapshot.city, hourlyReference(secondTarget));
  assert.equal(second.snapshot.journalRevision, firstRevision + 1);

  const restartAfterSecond = createAggregateCityWorldHourCatchupAuthority({
    landmark,
    worldSeed,
    epochMs,
    store: createFileWorldJournalStore(journalPath)
  });
  assert.deepEqual(restartAfterSecond.snapshot(), restarted.snapshot(), 'persisted genesis supplies the restart world-hour anchor when configuration omits it');

  const humanObserved = createAggregateCityWorldHourCatchupAuthority({
    landmark,
    worldSeed,
    initialWorldHour,
    store: createMemoryWorldJournalStore()
  });
  const machineObserved = createAggregateCityWorldHourCatchupAuthority({
    landmark,
    worldSeed,
    initialWorldHour,
    store: createMemoryWorldJournalStore()
  });
  humanObserved.catchUpToWorldHour(initialWorldHour + 9);
  machineObserved.catchUpToWorldHour(initialWorldHour + 9);
  assert.equal(humanObserved.snapshot().stateHash, machineObserved.snapshot().stateHash, 'physical world-time result does not depend on human/machine controller kind');
  assert.deepEqual(humanObserved.snapshot().city, machineObserved.snapshot().city);

  const bounded = createAggregateCityWorldHourCatchupAuthority({
    landmark,
    worldSeed,
    initialWorldHour,
    maxCatchupHours: 4,
    store: createMemoryWorldJournalStore()
  });
  const tooFar = bounded.catchUpToWorldHour(initialWorldHour + 5);
  assert.equal(tooFar.accepted, false);
  assert.equal(tooFar.reason, 'catchup-window-exceeds-bound');
  assert.equal(bounded.snapshot().lastProcessedWorldHour, initialWorldHour);
  assert.equal(bounded.snapshot().journalRevision, 1, 'oversized catch-up is rejected before partial advancement');

  const tamperPath = path.join(tempDir, 'tampered-city-catchup.jsonl');
  fs.copyFileSync(journalPath, tamperPath);
  const lines = fs.readFileSync(tamperPath, 'utf8').trim().split(/\r?\n/);
  const tamperedEntry = JSON.parse(lines.at(-1));
  tamperedEntry.citySnapshot.food += 1;
  lines[lines.length - 1] = JSON.stringify(tamperedEntry);
  fs.writeFileSync(tamperPath, `${lines.join('\n')}\n`, 'utf8');
  assert.throws(() => createAggregateCityWorldHourCatchupAuthority({
    landmark,
    worldSeed,
    epochMs,
    store: createFileWorldJournalStore(tamperPath)
  }), /catch-up (entryHash|persisted state hash) mismatch/, 'persisted state tampering fails closed on replay');

  assert.throws(() => createAggregateCityWorldHourCatchupAuthority({
    landmark,
    worldSeed: `${worldSeed}-wrong`,
    epochMs,
    store: createFileWorldJournalStore(journalPath)
  }), /worldSeed mismatch/, 'restart cannot silently reinterpret durable evidence under another world seed');

  console.log('bounded durable aggregate-city world-hour catch-up selftest: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
