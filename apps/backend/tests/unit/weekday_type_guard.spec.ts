import { test } from '@japa/runner';
import { isWeekday } from '#models_support/scalar_column';

test('the weekday type guard accepts each weekday from 0 to 6', ({ assert }) => {
  for (const day of [0, 1, 2, 3, 4, 5, 6]) assert.isTrue(isWeekday(day), `weekday ${day}`);
});

test('the weekday type guard rejects values outside the weekday numbers', ({ assert }) => {
  for (const value of [7, -1, 1.5, '1', null]) assert.isFalse(isWeekday(value), String(value));
});
