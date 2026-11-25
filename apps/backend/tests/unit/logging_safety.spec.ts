import { test } from '@japa/runner';
import { describeFailure } from '#services/logging_safety';
import { describeErrorIdentity } from '#config/logger';

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

test.group('describeErrorIdentity', () => {
  test('keeps an upper-case code and the class, never the message', ({ assert }) => {
    const error = Object.assign(new TypeError('Mail to clark.kent@wayne.example refused'), {
      code: 'E_MAIL_TRANSPORT',
    });
    assert.deepEqual(describeErrorIdentity(error), {
      errorName: 'TypeError',
      code: 'E_MAIL_TRANSPORT',
    });
  });

  test('drops a code a caller could shape', ({ assert }) => {
    const error = Object.assign(new Error('x'), { code: 'clark.kent@wayne.example' });
    assert.deepEqual(describeErrorIdentity(error), { errorName: 'Error' });
  });

  test('names a thrown non-Error value by its type', ({ assert }) => {
    assert.deepEqual(describeErrorIdentity('Bruce Wayne'), { errorName: 'string' });
  });
});
