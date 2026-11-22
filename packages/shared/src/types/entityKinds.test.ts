import { describe, expect, it } from 'vitest';
import { ACTIVITY_KINDS, RESOURCE_KINDS } from './entities.js';

describe('entity kind lists', () => {
  it('lists every resource kind once', () => {
    expect(RESOURCE_KINDS).toEqual(['person', 'placeholder', 'external']);
  });

  it('lists every activity kind once', () => {
    expect(ACTIVITY_KINDS).toEqual(['project', 'internal', 'allProjects']);
  });
});
