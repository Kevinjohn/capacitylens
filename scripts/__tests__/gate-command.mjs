import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(
  process.env.CAPACITYLENS_GATE_LOG,
  JSON.stringify({ args, cwd: process.cwd(), sentinel: process.env.CAPACITYLENS_GATE_SENTINEL }) + "\n",
);
if (JSON.stringify(args) === process.env.CAPACITYLENS_GATE_FAIL_COMMAND) {
  if (process.env.CAPACITYLENS_GATE_SIGNAL) process.kill(process.pid, process.env.CAPACITYLENS_GATE_SIGNAL);
  else process.exit(Number(process.env.CAPACITYLENS_GATE_FAIL_CODE));
}
