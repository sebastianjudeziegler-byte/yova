import { writeFileSync } from "node:fs";
import { caseId, publicError, redact } from "./core.mjs";

export default class LiveGateReporter {
  cases = new Map();
  errors = [];

  record(test) {
    const result = test.result();
    const file = test.module.relativeModuleId.replaceAll("\\", "/");
    const id = caseId(file, test.fullName);
    this.cases.set(id, { id, file, name: test.fullName, state: result.state, errors: (result.errors ?? []).map((error) => publicError(error)), durationMs: test.diagnostic()?.duration ?? 0 });
  }

  save() {
    if (!process.env.YOVA_LIVE_REPORT) throw new Error("The live reporter needs its runner-owned output path.");
    writeFileSync(process.env.YOVA_LIVE_REPORT, redact(JSON.stringify({ cases: [...this.cases.values()], errors: this.errors }, null, 2), process.env));
  }

  onTestModuleCollected(testModule) {
    for (const test of testModule.children.allTests()) this.record(test);
    this.save();
  }

  onTestCaseResult(test) {
    this.record(test);
    this.save();
  }

  onTestRunEnd(modules, errors) {
    this.errors = errors.map((error) => publicError(error));
    for (const testModule of modules) {
      for (const test of testModule.children.allTests()) this.record(test);
      this.errors.push(...testModule.errors().map((error) => publicError(error)));
      for (const suite of testModule.children.allSuites()) this.errors.push(...suite.errors().map((error) => publicError(error)));
    }
    this.save();
  }
}
