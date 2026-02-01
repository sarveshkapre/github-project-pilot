import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const bin = "node dist/index.js";

describe("simulate", () => {
  it("generates plan and issues", () => {
    execSync("npm run build", { stdio: "ignore" });
    const outDir = join(".tmp", "out");
    execSync(`rm -rf ${outDir}`);
    execSync(`${bin} simulate -i examples/backlog.yml -o ${outDir}`, { stdio: "ignore" });

    const plan = readFileSync(join(outDir, "plan.md"), "utf8");
    expect(plan).toContain("Execution Plan");

    const issue = readFileSync(join(outDir, "issues", "01-bootstrap-repo.md"), "utf8");
    expect(issue).toContain("Labels: status:backlog");
  });
});
