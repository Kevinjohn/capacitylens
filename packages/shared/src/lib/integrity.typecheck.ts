import { withoutAllocationAttribution } from './integrity.js';

const row = { id: 'a1', projectId: 'p1', updatedAt: 'before' } as const;
const cleared = withoutAllocationAttribution(row, 'after');

const preservedId: 'a1' = cleared.id;
const clearedProject: null = cleared.projectId;
const timestamp: string = cleared.updatedAt;

// @ts-expect-error A cleared allocation does not retain its previous project.
const previousProject: 'p1' = cleared.projectId;
// @ts-expect-error Restamping does not retain the old timestamp literal.
const previousTimestamp: 'before' = cleared.updatedAt;
// @ts-expect-error Both attribution and timestamp fields are required inputs.
withoutAllocationAttribution({ id: 'a1' });
// @ts-expect-error Attribution must be a project identifier or null.
withoutAllocationAttribution({ projectId: 42, updatedAt: 'before' });
// @ts-expect-error The row timestamp must be a string.
withoutAllocationAttribution({ projectId: 'p1', updatedAt: { value: 'before' } });
// @ts-expect-error A supplied restamp must be a timestamp string.
withoutAllocationAttribution(row, 42);
// @ts-expect-error A supplied restamp cannot be an object.
withoutAllocationAttribution(row, { value: 'after' });

void [preservedId, clearedProject, timestamp, previousProject, previousTimestamp];

function checkUnion(
  unionRow:
    | { kind: 'annotated'; note: string; projectId: string; updatedAt: string }
    | { kind: 'weighted'; weight: number; projectId: null; updatedAt: string },
) {
  const result = withoutAllocationAttribution(unionRow, 'after');
  const project: null = result.projectId;
  const updatedAt: string = result.updatedAt;
  if (result.kind === 'annotated') {
    const note: string = result.note;
    void note;
  } else {
    const weight: number = result.weight;
    void weight;
  }
  void [project, updatedAt];
}
void checkUnion;
