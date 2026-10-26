import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiagnostics } from '../lib/diagnostics';

test('first update seeds without firing', () => {
  assert.deepEqual(computeDiagnostics(null, ['Low battery']), { alarm: true, text: 'Low battery', newProblems: [] });
});

test('reports only new problems', () => {
  const r = computeDiagnostics(['A'], ['A', 'B']);
  assert.deepEqual(r, { alarm: true, text: 'A, B', newProblems: ['B'] });
});

test('no problems', () => {
  assert.deepEqual(computeDiagnostics([], []), { alarm: false, text: '', newProblems: [] });
});
