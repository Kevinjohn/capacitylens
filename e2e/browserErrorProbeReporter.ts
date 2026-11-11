import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

const probeAnnotation = 'browser-error-probe';
const controlAnnotation = 'browser-error-control';
const gateSentinelPrefix = 'BROWSER_ERROR_GATE_PROBE:';
const observerSentinelPrefix = 'BROWSER_ERROR_OBSERVER_ENVELOPE_SENTINEL:';

type ProbeDefinition = {
  title: string;
  kind: 'error' | 'observer-failure';
  eventType?: 'error' | 'unhandledrejection';
  message: string;
  reason?: string;
};

const probeDefinitions = new Map<string, ProbeDefinition>([
  [
    'sync-error',
    {
      title: 'uncaught task ErrorEvent reaches the browser error gate',
      kind: 'error',
      eventType: 'error',
      message: `${gateSentinelPrefix}sync-error`,
    },
  ],
  [
    'inline-sync-error',
    {
      title: 'an initial inline script ErrorEvent reaches the browser error gate',
      kind: 'error',
      eventType: 'error',
      message: `${gateSentinelPrefix}inline-sync-error`,
    },
  ],
  [
    'async-unhandled-rejection',
    {
      title: 'native unhandledrejection reaches the browser error gate',
      kind: 'error',
      eventType: 'unhandledrejection',
      message: `${gateSentinelPrefix}async-unhandled-rejection`,
    },
  ],
  [
    'primitive-unhandled-rejection',
    {
      title: 'primitive unhandledrejection reaches the browser error gate',
      kind: 'error',
      eventType: 'unhandledrejection',
      message: `${gateSentinelPrefix}primitive-unhandled-rejection`,
    },
  ],
  [
    'post-reload-error',
    {
      title: 'the browser error gate remains active after reload',
      kind: 'error',
      eventType: 'error',
      message: `${gateSentinelPrefix}post-reload-error`,
    },
  ],
  [
    'beforeunload-error',
    {
      title: 'beforeunload ErrorEvent reaches the browser error gate',
      kind: 'error',
      eventType: 'error',
      message: `${gateSentinelPrefix}beforeunload-error`,
    },
  ],
  [
    'secondary-context-error',
    {
      title: 'registered secondary contexts are covered by the browser error gate',
      kind: 'error',
      eventType: 'error',
      message: `${gateSentinelPrefix}secondary-context-error`,
    },
  ],
  [
    'iframe-error',
    {
      title: 'iframe ErrorEvents reach the browser error gate',
      kind: 'error',
      eventType: 'error',
      message: `${gateSentinelPrefix}iframe-error`,
    },
  ],
  [
    'popup-error',
    {
      title: 'popup ErrorEvents reach the browser error gate',
      kind: 'error',
      eventType: 'error',
      message: `${gateSentinelPrefix}popup-error`,
    },
  ],
  [
    'secondary-close-error',
    {
      title: 'an observed secondary-context fault remains a failure on close',
      kind: 'error',
      eventType: 'error',
      message: `${gateSentinelPrefix}secondary-close-error`,
    },
  ],
  [
    'page-close-beforeunload-error',
    {
      title: 'a true page-close beforeunload ErrorEvent reaches the browser error gate',
      kind: 'error',
      eventType: 'error',
      message: `${gateSentinelPrefix}page-close-beforeunload-error`,
    },
  ],
  [
    'malformed-null-envelope',
    {
      title: 'null observer envelopes produce a structured observer failure',
      kind: 'observer-failure',
      message: `${observerSentinelPrefix}null`,
      reason: 'expected an object envelope, received null',
    },
  ],
  [
    'malformed-array-envelope',
    {
      title: 'array observer envelopes produce a structured observer failure',
      kind: 'observer-failure',
      message: `${observerSentinelPrefix}[]`,
      reason: 'expected an object envelope, received an array',
    },
  ],
  [
    'malformed-missing-field',
    {
      title: 'missing observer fields produce a structured observer failure',
      kind: 'observer-failure',
      message: `${gateSentinelPrefix}malformed-missing-field`,
      reason: 'token must be a string',
    },
  ],
  [
    'malformed-field-envelope',
    {
      title: 'invalid observer fields produce a structured observer failure',
      kind: 'observer-failure',
      message: `${gateSentinelPrefix}malformed-field-envelope`,
      reason: 'eventType must be error or unhandledrejection',
    },
  ],
]);

const controlDefinitions = new Map([
  [
    'caught-cancelled-read',
    'caught rejection and canceled background read during reload do not fail the gate',
  ],
  ['resource-error-event', 'resource error events do not fail the browser error gate'],
]);

type ProbeAnnotation = {
  id: string;
  kind: ProbeDefinition['kind'];
  eventType?: ProbeDefinition['eventType'];
  message: string;
  reason?: string;
};

export default class BrowserErrorProbeReporter implements Reporter {
  private readonly expectedByProject = new Map<string, Set<string>>();
  private readonly probesSeen = new Map<string, number>();
  private readonly controlsExpected = new Map<string, Set<string>>();
  private readonly controlsSeen = new Map<string, number>();
  private readonly failures: string[] = [];
  private runStarted = false;

  onBegin(_config: FullConfig, suite: Suite) {
    const gateTests = suite
      .allTests()
      .filter((test) => test.location.file.endsWith('/browser-error-gate.db.spec.ts'));
    for (const test of gateTests) {
      const project = test.parent.project()?.name;
      if (!project) continue;
      const probe = [...probeDefinitions].find(([, definition]) => definition.title === test.title);
      if (probe) {
        if (!this.expectedByProject.has(project)) this.expectedByProject.set(project, new Set());
        this.expectedByProject.get(project)!.add(probe[0]);
      }
      const control = [...controlDefinitions].find(([, title]) => title === test.title);
      if (control) {
        if (!this.controlsExpected.has(project)) this.controlsExpected.set(project, new Set());
        this.controlsExpected.get(project)!.add(control[0]);
      }
    }
  }

  onTestBegin() {
    this.runStarted = true;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const probe = result.annotations.find((annotation) => annotation.type === probeAnnotation);
    const control = result.annotations.find((annotation) => annotation.type === controlAnnotation);
    const project = test.parent.project()?.name ?? '<unknown-project>';

    if (probe) {
      let annotation: ProbeAnnotation | undefined;
      try {
        annotation = JSON.parse(probe.description ?? '') as ProbeAnnotation;
      } catch {
        this.failures.push(`${test.title}: malformed browser error probe annotation.`);
      }
      const definition = annotation ? probeDefinitions.get(annotation.id) : undefined;
      const key = annotation ? `${project}/${annotation.id}` : `${project}/<malformed>`;
      this.probesSeen.set(key, (this.probesSeen.get(key) ?? 0) + 1);
      if (
        !annotation ||
        !definition ||
        definition.title !== test.title ||
        annotation.kind !== definition.kind ||
        annotation.eventType !== definition.eventType ||
        annotation.message !== definition.message
      ) {
        this.failures.push(`${test.title}: unexpected probe definition.`);
      }

      const recordsAnnotation = result.annotations.find(
        (item) => item.type === 'browser-error-observer-records',
      );
      let records: Array<{
        kind?: string;
        eventType?: string;
        message?: string;
        reason?: string;
      }> = [];
      try {
        records = JSON.parse(recordsAnnotation?.description ?? '[]') as typeof records;
      } catch {
        this.failures.push(`${test.title}: observer records were not valid JSON.`);
      }
      const errors = result.errors.map((error) => error.message ?? '');
      const record = records[0];
      if (
        !definition ||
        result.status !== 'failed' ||
        errors.length !== 1 ||
        !(errors[0] ?? '').includes(definition.message) ||
        records.length !== 1 ||
        record?.kind !== definition.kind ||
        record?.eventType !== definition.eventType ||
        record?.message !== definition.message ||
        record?.reason !== definition.reason
      ) {
        this.failures.push(
          `${test.title}: expected exactly one ${definition?.kind ?? 'valid'} record with message ${JSON.stringify(definition?.message)}, got ${records.length} record(s), status ${result.status}, and ${errors.length} result error(s). Records: ${JSON.stringify(records)}`,
        );
      }
    }

    if (control) {
      const id = control.description ?? '';
      const key = `${project}/${id}`;
      this.controlsSeen.set(key, (this.controlsSeen.get(key) ?? 0) + 1);
      if (
        controlDefinitions.get(id) !== test.title ||
        result.status !== 'passed' ||
        result.errors.length !== 0
      ) {
        this.failures.push(
          `${test.title}: browser error observer control must pass without errors.`,
        );
      }
    }
  }

  async onEnd(result: { status: 'passed' | 'failed' | 'timedout' | 'interrupted' }) {
    if (!this.runStarted) return;
    for (const [project, expectedIds] of this.expectedByProject) {
      for (const id of expectedIds) {
        const count = this.probesSeen.get(`${project}/${id}`) ?? 0;
        if (count !== 1)
          this.failures.push(`Expected one probe for ${project}/${id}, got ${count}.`);
      }
    }
    for (const [project, expectedIds] of this.controlsExpected) {
      for (const id of expectedIds) {
        const count = this.controlsSeen.get(`${project}/${id}`) ?? 0;
        if (count !== 1) {
          this.failures.push(`Expected one control for ${project}/${id}, got ${count}.`);
        }
      }
    }
    if (this.failures.length === 0) return;

    for (const failure of this.failures) console.error(`[browser-error-gate] ${failure}`);
    return { status: result.status === 'passed' ? 'failed' : result.status };
  }
}
