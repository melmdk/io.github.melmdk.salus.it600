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

test('a problem that clears and comes back fires again', () => {
  let previous: string[] | null = null;
  const fired: string[][] = [];
  for (const problems of [['A'], [], ['A']]) {
    const result = computeDiagnostics(previous, problems);
    fired.push(result.newProblems);
    previous = problems;
  }
  // The first update only seeds; the comeback fires A again.
  assert.deepEqual(fired, [[], [], ['A']]);
});

test('a persistent problem fires nothing', () => {
  assert.deepEqual(computeDiagnostics(['A'], ['A']), { alarm: true, text: 'A', newProblems: [] });
});

test('null seed with no problems', () => {
  assert.deepEqual(computeDiagnostics(null, []), { alarm: false, text: '', newProblems: [] });
});
