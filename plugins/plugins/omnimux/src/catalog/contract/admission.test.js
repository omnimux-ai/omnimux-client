import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll, resetContractCache, DEFAULT_SPECS_DIR } from './load.js';
import { checkAdmission, isAdmissionStrictError } from './admission.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const invalidDir = join(__dirname, 'fixtures', 'invalid');
const validDir = join(__dirname, 'fixtures', 'valid');

test('admission ok on valid fixtures', () => {
  resetContractCache();
  const index = loadAll(validDir, { useCache: false });
  const report = checkAdmission(index);
  assert.equal(report.ok, true, JSON.stringify(report.issues.filter((i) => i.level === 'error'), null, 2));
});

test('admission fails on invalid fixtures dir (parse + schema)', () => {
  resetContractCache();
  const index = loadAll(invalidDir, { useCache: false });
  const report = checkAdmission(index);
  assert.equal(report.ok, false);
  const codes = new Set(report.issues.map((i) => i.code));
  assert.ok(codes.has('yaml_parse_error') || codes.has('output_type_missing') || codes.has('operation_unknown'));
  assert.ok(report.errorCount >= 1);
});

test('real specs admission ok under H1', () => {
  resetContractCache();
  const index = loadAll(DEFAULT_SPECS_DIR, { useCache: false });
  const report = checkAdmission(index);
  assert.equal(
    report.ok,
    true,
    JSON.stringify(
      report.issues.filter((i) => i.level === 'error'),
      null,
      2,
    ),
  );
});

test('isAdmissionStrictError ignores coverage_missing', () => {
  assert.equal(
    isAdmissionStrictError({ level: 'error', code: 'coverage_missing' }),
    false,
  );
  assert.equal(
    isAdmissionStrictError({ level: 'error', code: 'output_type_missing' }),
    true,
  );
  assert.equal(
    isAdmissionStrictError({ level: 'warning', code: 'legacy_key_used' }),
    false,
  );
});

test('duplicate model id across files is admission error', () => {
  resetContractCache();
  // invalid dir includes duplicate-a/b sharing dup-model
  const index = loadAll(invalidDir, { useCache: false });
  const report = checkAdmission(index);
  assert.ok(
    report.issues.some((i) => i.code === 'duplicate_model_id' && i.modelId === 'dup-model'),
    JSON.stringify(report.issues.filter((i) => i.code === 'duplicate_model_id')),
  );
});
