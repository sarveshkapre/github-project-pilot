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
  title: string;
  body: string;
  labels: string[];
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
  .option("--dry-run", "print summary only", false)
  .action((options) => {
    const backlog = loadBacklog(options.input);
    const issues = buildIssueDrafts(backlog);
    const plan = buildPlan(backlog);

    if (options.dryRun) {
      printSummary(backlog, issues);
      return;
    }

    writeOutputs(options.out, plan, issues);
    printSummary(backlog, issues, options.out);
  });

program.parse(process.argv);

function loadBacklog(filePath: string): Backlog {
  const raw = readFileSync(filePath, "utf8");
  const parsed = parseYaml(raw);
  return BacklogSchema.parse(parsed);
}

function buildIssueDrafts(backlog: Backlog): IssueDraft[] {
  return backlog.items.map((item) => {
    const label = `status:${item.status}`;
    const tasks = item.tasks.length ? item.tasks.map((t) => `- ${t}`).join("\n") : "- Define tasks";
    const body = [
      `Project: ${backlog.project}`,
      `Owner: ${item.owner ?? "unassigned"}`,
      "",
      item.pitch,
      "",
      "Tasks:",
      tasks,
      "",
      "Acceptance criteria:",
      "- Plan exists in /plans",
      "- Docs updated (PLAN/PROJECT/CHANGELOG)",
      "- check passes"
    ].join("\n");

    return {
      title: item.title,
      body,
      labels: [label]
    };
  });
}

function buildPlan(backlog: Backlog): string {
  const header = `# ${backlog.project} - Execution Plan\n\nGenerated: ${new Date().toISOString()}\n`;
  const sections = backlog.items
    .map((item, index) => {
      const tasks = item.tasks.length ? item.tasks.map((t) => `- ${t}`).join("\n") : "- Define tasks";
      return [
        `## ${index + 1}. ${item.title}`,
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

  return `${header}\n${sections}\n`;
}

function writeOutputs(outDir: string, plan: string, issues: IssueDraft[]): void {
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
    const filePath = join(issuesDir, `${String(index + 1).padStart(2, "0")}-${safeTitle}.md`);
    const content = [
      `# ${issue.title}`,
      "",
      issue.body,
      "",
      `Labels: ${issue.labels.join(", ")}`
    ].join("\n");
    writeFileSync(filePath, content);
  });
}

function printSummary(backlog: Backlog, issues: IssueDraft[], outDir?: string): void {
  console.log(`Backlog project: ${backlog.project}`);
  console.log(`Items: ${backlog.items.length}`);
  console.log(`Issues drafted: ${issues.length}`);
  if (outDir) {
    console.log(`Outputs: ${outDir}`);
  }
}
