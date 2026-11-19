import { test } from '@japa/runner';
import { describeFailure } from '#services/logging_safety';

test.group('describeFailure', () => {
  test('names a thrown non-Error value by its type and reports no frames', ({ assert }) => {
    assert.deepEqual(describeFailure('Bruce Wayne'), {
      errorName: 'string',
      stack: [],
      causes: [],
    });
  });

  test('reports an error with no stack by its class alone', ({ assert }) => {
    const error = new RangeError('Bruce Wayne');
    error.stack = undefined;
    assert.deepEqual(describeFailure(error), { errorName: 'RangeError', stack: [], causes: [] });
  });

  test('keeps only stack frames, never the message line', ({ assert }) => {
    const { stack } = describeFailure(new Error('Bruce Wayne'));
    assert.isAbove(stack.length, 0);
    for (const line of stack) assert.match(line, /^\s+at /);
    assert.notInclude(stack.join('\n'), 'Bruce Wayne');
  });

  test('reports five causes of a six-deep chain', ({ assert }) => {
    let error: Error = new SyntaxError('sixth');
    for (const ErrorClass of [URIError, EvalError, RangeError, ReferenceError, TypeError]) {
      error = new ErrorClass('Selina Kyle', { cause: error });
    }
    const outer = new Error('Alfred Pennyworth', { cause: error });
    assert.deepEqual(describeFailure(outer).causes, [
      'TypeError',
      'ReferenceError',
      'RangeError',
      'EvalError',
      'URIError',
    ]);
  });
});
