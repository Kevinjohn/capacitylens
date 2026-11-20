import type { AppData } from '@capacitylens/shared/types/entities';
import type StateTransformer from '#transformers/state_transformer';

type Projected = ReturnType<StateTransformer['toObject']>;

/** The transformer returns the wire state unchanged in shape. */
const projectedIsAppData = (value: Projected): AppData => value;
const appDataIsProjected = (value: AppData): Projected => value;

void projectedIsAppData;
void appDataIsProjected;
