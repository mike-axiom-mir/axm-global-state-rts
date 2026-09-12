#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPolishedWorkshopIntake } from '../src/assets/polished-workshop-intake.mjs';

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = value;
  }
  return values;
}

export function runPolishedWorkshopIntakeCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const referencePath = resolve(args.reference || `${repoRoot}/assets/polished-workshop-reference.v0.1.json`);
  const archivePath = resolve(args.archive || '');
  const extractedDir = resolve(args.extracted || '');
  if (!args.archive || !args.extracted) {
    throw new Error('usage: --archive PACKAGE.zip --extracted EXTRACTED_DIR [--reference FILE] [--write RECEIPT.json]');
  }

  const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
  const receipt = verifyPolishedWorkshopIntake({ reference, archivePath, extractedDir });
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (args.write) {
    const outputPath = resolve(args.write);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, text, 'utf8');
  }
  process.stdout.write(text);
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runPolishedWorkshopIntakeCli();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
