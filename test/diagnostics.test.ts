import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiagnostics, fireProblemTriggers } from '../lib/diagnostics';

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

/** A Homey stand-in that records problem_started triggers. */
function fakeHomey(fail: (problem: string) => boolean = () => false) {
  const fired: Array<{ card: string; tokens: Record<string, unknown> }> = [];
  let lookups = 0;
  const homey = {
    flow: {
      getTriggerCard(card: string) {
        lookups += 1;
        return {
          trigger(tokens: Record<string, unknown>) {
            fired.push({ card, tokens });
            return fail(String(tokens.problem)) ? Promise.reject(new Error('flow down')) : Promise.resolve(true);
          },
        };
      },
    },
  };
  return { homey, fired, lookups: () => lookups };
}

test('fireProblemTriggers fires problem_started once per new problem', () => {
  const { homey, fired } = fakeHomey();
  fireProblemTriggers(homey, 'Kældertrappe', ['Low battery', 'Lost link with Gateway'], () => assert.fail('no error expected'));
  assert.deepEqual(fired, [
    { card: 'problem_started', tokens: { device: 'Kældertrappe', problem: 'Low battery' } },
    { card: 'problem_started', tokens: { device: 'Kældertrappe', problem: 'Lost link with Gateway' } },
  ]);
});

test('fireProblemTriggers does nothing without new problems', () => {
  const { homey, fired, lookups } = fakeHomey();
  fireProblemTriggers(homey, 'Stue', [], () => undefined);
  assert.deepEqual(fired, []);
  assert.equal(lookups(), 0);
});

test('a failed trigger is reported and does not stop the others', async () => {
  const { homey, fired } = fakeHomey((problem) => problem === 'A');
  const errors: unknown[] = [];
  fireProblemTriggers(homey, 'Stue', ['A', 'B'], (err: unknown) => errors.push(err));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fired.map((f) => f.tokens.problem), ['A', 'B']);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /flow down/);
});
