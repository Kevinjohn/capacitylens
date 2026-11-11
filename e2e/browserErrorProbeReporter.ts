import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

const probeAnnotation = 'browser-error-probe';
const controlAnnotation = 'browser-error-control';
const expectedProbeIds = [
  'sync-error',
  'async-unhandled-rejection',
  'post-reload-error',
  'beforeunload-error',
  'secondary-context-error',
  'iframe-error',
  'secondary-close-error',
];
const probeTitles = new Map([
  ['native synchronous ErrorEvent reaches the browser error gate', 'sync-error'],
  ['native unhandledrejection reaches the browser error gate', 'async-unhandled-rejection'],
  ['the browser error gate remains active after reload', 'post-reload-error'],
  ['beforeunload ErrorEvent reaches the browser error gate', 'beforeunload-error'],
  [
    'registered secondary contexts are covered by the browser error gate',
    'secondary-context-error',
  ],
  ['iframe ErrorEvents reach the browser error gate', 'iframe-error'],
  [
    'secondary context errors are retained through immediate context close',
    'secondary-close-error',
  ],
]);
const controlTitle =
  'caught rejection and canceled background read during reload do not fail the gate';

export default class BrowserErrorProbeReporter implements Reporter {
  private readonly expectedByProject = new Map<string, Set<string>>();
  private readonly seenProbes = new Map<string, number>();
  private readonly failures: string[] = [];
  private readonly controlProjects = new Set<string>();
  private readonly controlsSeen = new Map<string, number>();
  private runStarted = false;

  onBegin(_config: FullConfig, suite: Suite) {
    const gateTests = suite
      .allTests()
      .filter((test) => test.location.file.endsWith('/browser-error-gate.db.spec.ts'));
    for (const test of gateTests) {
      const project = test.parent.project()?.name;
      if (!project) continue;
      const id = probeTitles.get(test.title);
      if (id) {
        if (!this.expectedByProject.has(project)) this.expectedByProject.set(project, new Set());
        this.expectedByProject.get(project)!.add(id);
      }
      if (test.title === controlTitle) this.controlProjects.add(project);
    }
  }

  onTestBegin() {
    this.runStarted = true;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const probe = test.annotations.find((annotation) => annotation.type === probeAnnotation);
    const control = test.annotations.find((annotation) => annotation.type === controlAnnotation);

    if (probe) {
      const separator = probe.description?.indexOf('|') ?? -1;
      if (separator < 1) {
        this.failures.push(`${test.title}: malformed browser error probe annotation.`);
        return;
      }
      const id = probe.description!.slice(0, separator);
      const sentinel = probe.description!.slice(separator + 1);
      const project = test.parent.project()?.name ?? '<unknown-project>';
      const key = `${project}/${id}`;
      this.seenProbes.set(key, (this.seenProbes.get(key) ?? 0) + 1);
      if (!expectedProbeIds.includes(id) || sentinel !== `BROWSER_ERROR_GATE_PROBE:${id}`) {
        this.failures.push(`${test.title}: unexpected probe id or sentinel.`);
      }
      const recordsAnnotation = result.annotations.find(
        (annotation) => annotation.type === 'browser-error-observer-records',
      );
      let records: Array<{ kind?: string; eventType?: string; message?: string }> = [];
      try {
        records = JSON.parse(recordsAnnotation?.description ?? '[]') as typeof records;
      } catch {
        this.failures.push(`${test.title}: observer records were not valid JSON.`);
      }
      const errors = result.errors.map((error) => error.message ?? '');
      const record = records[0];
      if (
        result.status !== 'failed' ||
        errors.length !== 1 ||
        !(errors[0] ?? '').includes(sentinel) ||
        records.length !== 1 ||
        record?.kind !== 'error' ||
        record?.message !== sentinel ||
        (record?.eventType !== 'error' && record?.eventType !== 'unhandledrejection')
      ) {
        this.failures.push(
          `${test.title}: expected exactly one native record with message ${JSON.stringify(sentinel)} and one fixture failure, got ${records.length} native record(s), status ${result.status}, and ${errors.length} result error(s).`,
        );
      }
    }

    if (control) {
      const project = test.parent.project()?.name ?? '<unknown-project>';
      this.controlsSeen.set(project, (this.controlsSeen.get(project) ?? 0) + 1);
      if (result.status !== 'passed' || result.errors.length !== 0) {
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
        const key = `${project}/${id}`;
        const count = this.seenProbes.get(key) ?? 0;
        if (count === 0) this.failures.push(`Missing browser error probe for ${project}: ${id}.`);
        if (count > 1) this.failures.push(`Browser error probe ran ${count} times: ${key}.`);
      }
    }
    for (const project of this.controlProjects) {
      const controls = this.controlsSeen.get(project) ?? 0;
      if (controls !== 1) {
        this.failures.push(
          `Expected one passing browser error control for ${project}, got ${controls}.`,
        );
      }
    }
    if (this.failures.length === 0) return;

    for (const failure of this.failures) console.error(`[browser-error-gate] ${failure}`);
    return { status: result.status === 'passed' ? 'failed' : result.status };
  }
}
