import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const bin = "node dist/index.js";

describe("simulate", () => {
  beforeAll(() => {
    execSync("npm run build", { stdio: "ignore" });
  });

  it("generates plan and issues", () => {
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
    expect(html).toContain(".app-header");
  });

  it("styles the mono HTML theme", () => {
    const outDir = join(".tmp", "out-mono-theme");
    execSync(`rm -rf ${outDir}`);
    execSync(`${bin} simulate -i examples/backlog.yml -o ${outDir} --html-theme mono`, { stdio: "ignore" });
    const html = readFileSync(join(outDir, "report", "index.html"), "utf8");
    expect(html).toContain(".app-header");
    expect(html).toContain("color-scheme: dark");
  });

  it("can disable the HTML report", () => {
    const outDir = join(".tmp", "out-no-html");
    execSync(`rm -rf ${outDir}`);
    execSync(`${bin} simulate -i examples/backlog.yml -o ${outDir} --no-html-report`, { stdio: "ignore" });
    expect(existsSync(join(outDir, "report", "index.html"))).toBe(false);
  });

  it("can clean an existing output directory", () => {
    const outDir = join(".tmp", "out-clean");
    execSync(`rm -rf ${outDir}`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "stale.txt"), "stale");
    expect(existsSync(join(outDir, "stale.txt"))).toBe(true);

    execSync(`${bin} simulate -i examples/backlog.yml -o ${outDir} --clean --no-html-report`, { stdio: "ignore" });
    expect(existsSync(join(outDir, "stale.txt"))).toBe(false);
    expect(existsSync(join(outDir, "plan.md"))).toBe(true);
  });

  it("supports per-item acceptance and risks", () => {
    const outDir = join(".tmp", "out-overrides");
    execSync(`rm -rf ${outDir}`);
    mkdirSync(outDir, { recursive: true });
    const backlogPath = join(outDir, "backlog.yml");
    writeFileSync(
      backlogPath,
      [
        "project: Overrides",
        "items:",
        "  - id: ov-001",
        "    title: Add thing",
        "    pitch: Do the thing.",
        "    tasks:",
        "      - Do A",
        "    acceptance:",
        "      - Custom acceptance",
        "    risks:",
        "      - Custom risk"
      ].join("\n")
    );

    execSync(`${bin} simulate -i ${backlogPath} -o ${outDir} --no-html-report`, { stdio: "ignore" });

    const plan = readFileSync(join(outDir, "plan.md"), "utf8");
    expect(plan).toContain("Acceptance:");
    expect(plan).toContain("- Custom acceptance");
    expect(plan).toContain("Risks:");
    expect(plan).toContain("- Custom risk");

    const issue = readFileSync(join(outDir, "issues", "01-ov-001-add-thing.md"), "utf8");
    expect(issue).toContain("Acceptance criteria:");
    expect(issue).toContain("- Custom acceptance");
  });

  it("rejects duplicate item IDs", () => {
    const outDir = join(".tmp", "out-duplicate-ids");
    execSync(`rm -rf ${outDir}`);
    mkdirSync(outDir, { recursive: true });
    const backlogPath = join(outDir, "backlog.yml");
    writeFileSync(
      backlogPath,
      [
        "project: Dupes",
        "items:",
        "  - id: dup-1",
        "    title: One",
        "    pitch: One",
        "  - id: dup-1",
        "    title: Two",
        "    pitch: Two"
      ].join("\n")
    );

    const result = spawnSync("node", ["dist/index.js", "simulate", "-i", backlogPath, "-o", outDir, "--dry-run"], {
      encoding: "utf8"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Duplicate backlog item id(s): dup-1");
    expect(result.stderr).not.toContain(" at ");
  });
});

describe("publish", () => {
  it("skips issues already recorded in publish state (dry-run)", () => {
    const outDir = join(".tmp", "out-publish");
    execSync(`rm -rf ${outDir}`);
    execSync(`${bin} simulate -i examples/backlog.yml -o ${outDir}`, { stdio: "ignore" });

    const reportDir = join(outDir, "report");
    mkdirSync(reportDir, { recursive: true });
    const stateFile = join(reportDir, "publish-state.json");
    writeFileSync(
      stateFile,
      `${JSON.stringify(
        {
          version: 1,
          created: {
            "gp-001": {
              title: "Bootstrap repo",
              labels: ["status:backlog", "docs", "ci"],
              url: "https://github.com/o/r/issues/1",
              number: 1
            }
          }
        },
        null,
        2
      )}\n`
    );

    const reportCsv = join(reportDir, "summary.csv");
    const issuesDir = join(outDir, "issues");
    const stdout = execSync(
      `${bin} publish --repo o/r --issues-dir ${issuesDir} --report-csv ${reportCsv} --dry-run`,
      { encoding: "utf8" }
    );

    const dryRunLines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("[dry-run]"));
    expect(dryRunLines.join("\n")).not.toContain("Bootstrap repo");
    expect(dryRunLines.join("\n")).toContain("Plan generator MVP");
  });
});
