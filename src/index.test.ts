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
    execSync(
      `${bin} simulate -i examples/backlog.yml -o ${outDir} --issue-template examples/templates/issue.md --plan-template examples/templates/plan.md --report report`,
      { stdio: "ignore" }
    );

    const plan = readFileSync(join(outDir, "plan.md"), "utf8");
    expect(plan).toContain("Execution Plan");

    const issue = readFileSync(join(outDir, "issues", "01-gp-001-bootstrap-repo.md"), "utf8");
    expect(issue).toContain("ID: gp-001");

    const summaryJson = readFileSync(join(outDir, "report", "summary.json"), "utf8");
    expect(summaryJson).toContain("\"gp-001\"");

    const summaryCsv = readFileSync(join(outDir, "report", "summary.csv"), "utf8");
    expect(summaryCsv).toContain("gp-001");

    const html = readFileSync(join(outDir, "report", "index.html"), "utf8");
    expect(html).toContain("GitHub Project Pilot Report");
  });
});
