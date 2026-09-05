/** Fixed structural limits; existing debt is bounded per file, symbol and metric below. */
export const functionLimits = Object.freeze({ lines: 100, complexity: 12, depth: 4 });

const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const integerAtLeast = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
const unitKey = ({ path, symbol }) => JSON.stringify([path, symbol]);
const exceptionKey = ({ path, symbol, metric }) => JSON.stringify([path, symbol, metric]);

function exceptionErrors(exceptions, taskIds) {
  if (!Array.isArray(exceptions)) return ["Expected an array of bounded function exceptions."];
  const errors = [];
  const seen = new Set();
  for (const [index, entry] of exceptions.entries()) {
    const label = `Function exception ${index + 1}`;
    if (!entry || Object.keys(entry).sort().join(",") !== "baseline,metric,path,reason,symbol,task") {
      errors.push(`${label}: expected path, symbol, metric, baseline, reason and task.`);
      continue;
    }
    if (![entry.path, entry.symbol, entry.reason, entry.task].every(nonempty)) {
      errors.push(`${label}: path, symbol, reason and task must be nonempty strings.`);
    }
    if (
      !Object.hasOwn(functionLimits, entry.metric) ||
      !integerAtLeast(entry.baseline, functionLimits[entry.metric] + 1)
    ) {
      errors.push(`${label}: expected a known metric and an integer baseline above its limit.`);
    }
    if (!taskIds.has(entry.task)) errors.push(`${label}: unknown cleanup task ${entry.task}.`);
    const key = exceptionKey(entry);
    if (seen.has(key)) errors.push(`${label}: duplicate exception for ${entry.path} ${entry.symbol} ${entry.metric}.`);
    seen.add(key);
  }
  return errors;
}

function measurementErrors(units) {
  const errors = [];
  const seen = new Set();
  for (const entry of units) {
    if (
      !nonempty(entry.path) ||
      !nonempty(entry.symbol) ||
      !integerAtLeast(entry.startLine, 1) ||
      !(
        integerAtLeast(entry.lines, 0) ||
        (entry.lines === null && ["class-field-initializer", "program"].includes(entry.origin))
      ) ||
      !integerAtLeast(entry.complexity, 1) ||
      !integerAtLeast(entry.depth, 0)
    )
      errors.push(`Invalid function measurement: ${entry.path} ${entry.symbol}.`);
    const key = unitKey(entry);
    if (seen.has(key)) errors.push(`Duplicate function measurement: ${entry.path} ${entry.symbol}.`);
    seen.add(key);
  }
  return errors;
}

function staleException(entry, units) {
  const unit = units.get(unitKey(entry));
  const label = `${entry.path} ${entry.symbol} ${entry.metric}`;
  if (!unit) return `${label}: stale exception, file or symbol missing.`;
  if (unit[entry.metric] === null || unit[entry.metric] <= functionLimits[entry.metric]) {
    return `${label}: stale exception, metric resolved; remove entry.`;
  }
  return null;
}

/**
 * Evaluate measured units without I/O. Exceptions bind one exact file/symbol/metric to a growth
 * cap, reason and real task heading. Reject invalid measurements/policy, duplicates, growth and
 * deleted or resolved exceptions. A length exception never relaxes complexity or nesting.
 */
export function evaluateFunctionBudgets(units, exceptions, taskIds) {
  const errors = [...exceptionErrors(exceptions, taskIds), ...measurementErrors(units)];
  if (errors.length) return { valid: false, errors };
  const byUnit = new Map(units.map((entry) => [unitKey(entry), entry]));
  const byMetric = new Map(exceptions.map((entry) => [exceptionKey(entry), entry]));
  for (const unit of units) {
    for (const [metric, limit] of Object.entries(functionLimits)) {
      const exception = byMetric.get(exceptionKey({ ...unit, metric }));
      const ceiling = exception?.baseline ?? limit;
      if (unit[metric] !== null && unit[metric] > ceiling) {
        errors.push(
          `${unit.path}:${unit.startLine} ${unit.symbol}: ${metric} ${unit[metric]} exceeds ${ceiling}` +
            (exception ? ` (bounded by ${exception.task}).` : "; no exception listed."),
        );
      }
    }
  }
  for (const entry of exceptions) {
    const error = staleException(entry, byUnit);
    if (error) errors.push(error);
  }
  return { valid: errors.length === 0, errors };
}
