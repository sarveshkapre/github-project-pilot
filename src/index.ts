#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

const BacklogItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  pitch: z.string().min(1),
  owner: z.string().optional(),
  status: z.enum(["backlog", "scaffolded", "mvp", "hardened", "shipped"]).default("backlog"),
  tasks: z.array(z.string().min(1)).default([])
});

const BacklogSchema = z.object({
  project: z.string().min(1),
  generated_by: z.string().optional(),
  items: z.array(BacklogItemSchema).min(1)
});

type Backlog = z.infer<typeof BacklogSchema>;

type IssueDraft = {
  id: string;
  title: string;
  body: string;
  labels: string[];
};

type Templates = {
  issue: string;
  plan: string;
};

const program = new Command();

program
  .name("gh-project-pilot")
  .description("Local-first backlog to plans and issue drafts.")
  .version("0.1.0");

program
  .command("simulate")
  .description("Generate a local plan and issue drafts from a backlog YAML file.")
  .requiredOption("-i, --input <file>", "backlog YAML file")
  .option("-o, --out <dir>", "output directory", "./out")
  .option("--issue-template <file>", "issue template file path")
  .option("--plan-template <file>", "plan template file path")
  .option("--report <dir>", "summary report directory (relative to output)", "report")
  .option("--dry-run", "print summary only", false)
  .action((options) => {
    const backlog = loadBacklog(options.input);
    const templates = loadTemplates(options.issueTemplate, options.planTemplate);
    const issues = buildIssueDrafts(backlog, templates);
    const plan = buildPlan(backlog, templates);

    if (options.dryRun) {
      printSummary(backlog, issues);
      return;
    }

    writeOutputs(options.out, plan, issues, options.report);
    printSummary(backlog, issues, options.out);
  });

program.parse(process.argv);

function loadBacklog(filePath: string): Backlog {
  const raw = readFileSync(filePath, "utf8");
  const parsed = parseYaml(raw);
  return BacklogSchema.parse(parsed);
}

function buildIssueDrafts(backlog: Backlog, templates: Templates): IssueDraft[] {
  return backlog.items.map((item) => {
    const label = `status:${item.status}`;
    const tasks = item.tasks.length ? item.tasks.map((t) => `- ${t}`).join("\n") : "- Define tasks";
    const body = applyTemplate(templates.issue, {
      project: backlog.project,
      id: item.id,
      title: item.title,
      pitch: item.pitch,
      owner: item.owner ?? "unassigned",
      status: item.status,
      tasks,
      labels: label,
      acceptance: [
        "- Plan exists in /plans",
        "- Docs updated (PLAN/PROJECT/CHANGELOG)",
        "- check passes"
      ].join("\n")
    });

    return {
      id: item.id,
      title: item.title,
      body,
      labels: [label]
    };
  });
}

function buildPlan(backlog: Backlog, templates: Templates): string {
  const items = backlog.items
    .map((item, index) => {
      const tasks = item.tasks.length ? item.tasks.map((t) => `- ${t}`).join("\n") : "- Define tasks";
      return [
        `## ${index + 1}. ${item.title}`,
        `ID: ${item.id}`,
        item.pitch,
        `Status: ${item.status}`,
        "Tasks:",
        tasks,
        "",
        "Risks:",
        "- Scope creep",
        "- Missing tests",
        "- Unsafe defaults"
      ].join("\n");
    })
    .join("\n\n");

  return applyTemplate(templates.plan, {
    project: backlog.project,
    generated_at: new Date().toISOString(),
    items
  });
}

function writeOutputs(outDir: string, plan: string, issues: IssueDraft[], reportDir: string): void {
  mkdirSync(outDir, { recursive: true });
  const planPath = join(outDir, "plan.md");
  writeFileSync(planPath, plan);

  const issuesDir = join(outDir, "issues");
  mkdirSync(issuesDir, { recursive: true });

  issues.forEach((issue, index) => {
    const safeTitle = issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const filePath = join(
      issuesDir,
      `${String(index + 1).padStart(2, "0")}-${issue.id}-${safeTitle}.md`
    );
    const content = [
      `# ${issue.title}`,
      "",
      issue.body,
      "",
      `Labels: ${issue.labels.join(", ")}`
    ].join("\n");
    writeFileSync(filePath, content);
  });

  writeSummary(outDir, reportDir, issues);
}

function printSummary(backlog: Backlog, issues: IssueDraft[], outDir?: string): void {
  console.log(`Backlog project: ${backlog.project}`);
  console.log(`Items: ${backlog.items.length}`);
  console.log(`Issues drafted: ${issues.length}`);
  if (outDir) {
    console.log(`Outputs: ${outDir}`);
  }
}

function loadTemplates(issueTemplatePath?: string, planTemplatePath?: string): Templates {
  const defaultIssue = [
    "Project: {{project}}",
    "ID: {{id}}",
    "Owner: {{owner}}",
    "",
    "{{pitch}}",
    "",
    "Tasks:",
    "{{tasks}}",
    "",
    "Acceptance criteria:",
    "{{acceptance}}"
  ].join("\n");
  const defaultPlan = [
    "# {{project}} - Execution Plan",
    "",
    "Generated: {{generated_at}}",
    "",
    "{{items}}",
    ""
  ].join("\n");

  return {
    issue: issueTemplatePath ? readFileSync(issueTemplatePath, "utf8") : defaultIssue,
    plan: planTemplatePath ? readFileSync(planTemplatePath, "utf8") : defaultPlan
  };
}

function applyTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => data[key] ?? "");
}

function writeSummary(outDir: string, reportDir: string, issues: IssueDraft[]): void {
  const reportPath = join(outDir, reportDir);
  mkdirSync(reportPath, { recursive: true });

  const jsonPath = join(reportPath, "summary.json");
  const csvPath = join(reportPath, "summary.csv");

  const json = issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    labels: issue.labels.join(";")
  }));

  const csvHeader = "id,title,labels";
  const csvRows = issues.map((issue) =>
    [issue.id, escapeCsv(issue.title), escapeCsv(issue.labels.join(";"))].join(",")
  );

  writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  writeFileSync(csvPath, [csvHeader, ...csvRows].join("\n"));
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}
