#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

const BacklogItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "id must be filename-safe (letters/numbers/._-)"),
  title: z.string().min(1),
  pitch: z.string().min(1),
  owner: z.string().optional(),
  labels: z.array(z.string().min(1)).default([]),
  status: z.enum(["backlog", "scaffolded", "mvp", "hardened", "shipped"]).default("backlog"),
  tasks: z.array(z.string().min(1)).default([]),
  acceptance: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([])
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

type SummaryRow = {
  id: string;
  title: string;
  labels: string[];
};

type PublishState = {
  version: 1;
  created: Record<string, { title: string; url?: string; number?: number; labels: string[] }>;
};

type PublishPayload = IssueDraft & { assignees?: string[] };

type ProjectDraftState = {
  version: 1;
  created: Record<string, { title: string }>;
};

type OutputFormat = "pretty" | "json";
type SortMode = "input" | "id";

const program = new Command();

program
  .name("gh-project-pilot")
  .description("Local-first backlog to plans and issue drafts.")
  .version(readPackageVersion());

program
  .command("simulate")
  .description("Generate a local plan and issue drafts from a backlog YAML file.")
  .requiredOption("-i, --input <file>", "backlog YAML file")
  .option("-o, --out <dir>", "output directory", "./out")
  .option("--clean", "delete the output directory before writing", false)
  .option("--format <name>", "stdout summary format (pretty|json)", "pretty")
  .option("--generated-at <value>", "override plan generated_at (ISO 8601)")
  .option("--sort <mode>", "ordering for plan/issues (input|id)", "input")
  .option("--issue-template <file>", "issue template file path")
  .option("--plan-template <file>", "plan template file path")
  .option("--report <dir>", "summary report directory (relative to output)", "report")
  .option("--no-html-report", "disable HTML report output")
  .option("--html-theme <name>", "HTML report theme (paper|mono)", "paper")
  .option("--allow-missing-placeholders", "allow templates to omit required placeholders", false)
  .option("--dry-run", "print summary only", false)
  .action((options) => {
    const format = normalizeOutputFormat(options.format);
    const sortMode = normalizeSortMode(options.sort);
    const backlog = loadBacklog(options.input);
    const ordered = sortBacklog(backlog, sortMode);
    const templates = loadTemplates(options.issueTemplate, options.planTemplate);
    if (!options.allowMissingPlaceholders) {
      validateTemplates(templates);
    }
    const issues = buildIssueDrafts(ordered, templates);
    const generatedAt = normalizeGeneratedAt(options.generatedAt);
    const plan = buildPlan(ordered, templates, generatedAt);

    if (options.dryRun) {
      printSummary(ordered, issues, format);
      return;
    }

    const theme = normalizeTheme(options.htmlTheme);
    if (options.clean) {
      cleanOutputDir(options.out);
    }
    writeOutputs(options.out, plan, issues, options.report, options.htmlReport, theme);
    printSummary(ordered, issues, format, options.out);
  });

program
  .command("validate")
  .description("Validate backlog YAML and (optionally) templates, without writing outputs.")
  .requiredOption("-i, --input <file>", "backlog YAML file")
  .option("--issue-template <file>", "issue template file path")
  .option("--plan-template <file>", "plan template file path")
  .option("--allow-missing-placeholders", "allow templates to omit required placeholders", false)
  .option("--format <name>", "stdout format (pretty|json)", "pretty")
  .action((options) => {
    const format = normalizeOutputFormat(options.format);
    const backlog = loadBacklog(options.input);
    const templates = loadTemplates(options.issueTemplate, options.planTemplate);
    if (!options.allowMissingPlaceholders) {
      validateTemplates(templates);
    }

    if (format === "json") {
      console.log(
        JSON.stringify({
          ok: true,
          project: backlog.project,
          items: backlog.items.length
        })
      );
      return;
    }

    console.log(`Valid backlog: ${backlog.project} (${backlog.items.length} items)`);
  });

program
  .command("publish")
  .description("Create GitHub Issues from a summary CSV and issue drafts via gh CLI.")
  .requiredOption("--repo <owner/repo>", "target GitHub repository")
  .requiredOption("--issues-dir <dir>", "directory containing issue draft markdown files")
  .requiredOption("--report-csv <file>", "summary CSV generated by simulate")
  .option("--limit <n>", "publish at most N issues", parseInteger)
  .option("--delay-ms <n>", "delay between publishes in ms", parseInteger, 0)
  .option("--assignee-from-owner", "set issue assignee(s) from `Owner:` in issue drafts", false)
  .option("--state-file <file>", "publish state file path (default: alongside report CSV)")
  .option("--no-resume", "do not skip issues already recorded in the state file")
  .option("--dry-run", "print intended gh commands without publishing", false)
  .action(async (options) => {
    const rows = loadSummaryCsv(options.reportCsv);
    const issueFiles = listIssueFiles(options.issuesDir);
    const payloads = buildPublishPayloads(rows, issueFiles, options.assigneeFromOwner);
    const selected = applyLimit(payloads, options.limit);

    const stateFile = options.stateFile ? String(options.stateFile) : defaultPublishStateFile(options.reportCsv);
    const { state, loaded, error } = tryLoadPublishState(stateFile);
    const resume = options.resume !== false;
    const toPublish = resume ? selected.filter((payload) => !state.created[payload.id]) : selected;
    if (resume && existsSync(stateFile)) {
      const createdCount = Object.keys(state.created).length;
      console.log(
        loaded
          ? `Resuming from ${stateFile} (${createdCount} recorded)`
          : `Warning: could not parse ${stateFile}; proceeding without resume${error ? ` (${error})` : ""}`
      );
    }

    if (options.dryRun) {
      toPublish.forEach((payload) => {
        const assigneeFlags = payload.assignees?.length ? ` --assignee ${payload.assignees.join(",")}` : "";
        console.log(
          `[dry-run] gh issue create --repo ${options.repo} --title ${payload.title} --label ${payload.labels.join(
            ","
          )}${assigneeFlags}`
        );
      });
      return;
    }

    for (const payload of toPublish) {
      const created = createGitHubIssue(options.repo, payload);
      state.created[payload.id] = {
        title: payload.title,
        labels: payload.labels,
        ...(created.url ? { url: created.url } : {}),
        ...(created.number ? { number: created.number } : {})
      };
      savePublishState(stateFile, state);
      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }
  });

program
  .command("project-drafts")
  .description("Create GitHub Project draft items from a summary CSV via gh CLI.")
  .requiredOption("--owner <owner>", "project owner (user or org)")
  .requiredOption("--project-number <n>", "project number", parseInteger)
  .requiredOption("--issues-dir <dir>", "directory containing issue draft markdown files")
  .requiredOption("--report-csv <file>", "summary CSV generated by simulate")
  .option("--limit <n>", "create at most N draft items", parseInteger)
  .option("--delay-ms <n>", "delay between creates in ms", parseInteger, 0)
  .option("--state-file <file>", "draft state file path (default: alongside report CSV)")
  .option("--no-resume", "do not skip drafts already recorded in the state file")
  .option("--dry-run", "print intended gh commands without publishing", false)
  .action(async (options) => {
    const rows = loadSummaryCsv(options.reportCsv);
    const issueFiles = listIssueFiles(options.issuesDir);
    const payloads = buildPublishPayloads(rows, issueFiles, false);
    const selected = applyLimit(payloads, options.limit);

    const stateFile = options.stateFile
      ? String(options.stateFile)
      : defaultProjectDraftStateFile(options.reportCsv);
    const { state, loaded, error } = tryLoadProjectDraftState(stateFile);
    const resume = options.resume !== false;
    const toCreate = resume ? selected.filter((payload) => !state.created[payload.id]) : selected;
    if (resume && existsSync(stateFile)) {
      const createdCount = Object.keys(state.created).length;
      console.log(
        loaded
          ? `Resuming from ${stateFile} (${createdCount} recorded)`
          : `Warning: could not parse ${stateFile}; proceeding without resume${error ? ` (${error})` : ""}`
      );
    }

    if (options.dryRun) {
      toCreate.forEach((payload) => {
        console.log(
          `[dry-run] gh project item-create ${options.projectNumber} --owner ${options.owner} --title ${payload.title}`
        );
      });
      return;
    }

    for (const payload of toCreate) {
      createProjectDraft(options.owner, options.projectNumber, payload);
      state.created[payload.id] = { title: payload.title };
      saveProjectDraftState(stateFile, state);
      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }
  });

function loadBacklog(filePath: string): Backlog {
  const raw = readFileSync(filePath, "utf8");
  const parsed = parseYaml(raw);
  const backlog = BacklogSchema.parse(parsed);
  assertUniqueItemIds(backlog);
  return backlog;
}

function buildIssueDrafts(backlog: Backlog, templates: Templates): IssueDraft[] {
  return backlog.items.map((item) => {
    const labels = buildLabels(item.status, item.labels);
    const labelString = labels.join(", ");
    const tasks = item.tasks.length ? item.tasks.map((t) => `- ${t}`).join("\n") : "- Define tasks";
    const acceptance = buildAcceptance(item.acceptance);
    const body = applyTemplate(templates.issue, {
      project: backlog.project,
      id: item.id,
      title: item.title,
      pitch: item.pitch,
      owner: item.owner ?? "unassigned",
      status: item.status,
      tasks,
      labels: labelString,
      acceptance
    });

    return {
      id: item.id,
      title: item.title,
      body,
      labels
    };
  });
}

function buildPlan(backlog: Backlog, templates: Templates, generatedAt: string): string {
  const items = backlog.items
    .map((item, index) => {
      const tasks = item.tasks.length ? item.tasks.map((t) => `- ${t}`).join("\n") : "- Define tasks";
      const risks = buildRisks(item.risks);
      const acceptance = buildAcceptance(item.acceptance);
      return [
        `## ${index + 1}. ${item.title}`,
        `ID: ${item.id}`,
        item.pitch,
        `Status: ${item.status}`,
        "Tasks:",
        tasks,
        "",
        "Acceptance:",
        acceptance,
        "",
        "Risks:",
        risks
      ].join("\n");
    })
    .join("\n\n");

  return applyTemplate(templates.plan, {
    project: backlog.project,
    generated_at: generatedAt,
    items
  });
}

function writeOutputs(
  outDir: string,
  plan: string,
  issues: IssueDraft[],
  reportDir: string,
  htmlReport: boolean,
  htmlTheme: string
): void {
  mkdirSync(outDir, { recursive: true });
  const planPath = join(outDir, "plan.md");
  writeFileSync(planPath, plan);

  const issuesDir = join(outDir, "issues");
  mkdirSync(issuesDir, { recursive: true });

  issues.forEach((issue, index) => {
    const fileName = issueDraftFilename(index, issue);
    const filePath = join(issuesDir, fileName);
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
  if (htmlReport) {
    writeHtmlReport(outDir, reportDir, plan, issues, htmlTheme);
  }
}

function printSummary(backlog: Backlog, issues: IssueDraft[], format: OutputFormat, outDir?: string): void {
  if (format === "json") {
    const payload = {
      project: backlog.project,
      items: backlog.items.length,
      issues_drafted: issues.length,
      ...(outDir ? { out_dir: outDir } : {})
    };
    console.log(JSON.stringify(payload));
    return;
  }

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
    "Title: {{title}}",
    "Owner: {{owner}}",
    "Status: {{status}}",
    "Labels: {{labels}}",
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

function writeSummary(outDir: string, reportDir: string, issues: IssueDraft[]): SummaryRow[] {
  const reportPath = join(outDir, reportDir);
  mkdirSync(reportPath, { recursive: true });

  const jsonPath = join(reportPath, "summary.json");
  const csvPath = join(reportPath, "summary.csv");

  const json = issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    labels: issue.labels.join(";")
  }));
  const summaryRows = issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    labels: issue.labels
  }));

  const csvHeader = "id,title,labels";
  const csvRows = issues.map((issue) =>
    [issue.id, escapeCsv(issue.title), escapeCsv(issue.labels.join(";"))].join(",")
  );

  writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  writeFileSync(csvPath, [csvHeader, ...csvRows].join("\n"));

  return summaryRows;
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function writeHtmlReport(
  outDir: string,
  reportDir: string,
  plan: string,
  issues: IssueDraft[],
  theme: string
): void {
  const reportPath = join(outDir, reportDir);
  const htmlPath = join(reportPath, "index.html");
  const issueList = issues
    .map((issue, index) => {
      const fileName = issueDraftFilename(index, issue);
      const href = `../issues/${encodeURIComponent(fileName)}`;
      return `<tr class="summary-row" data-id="${escapeHtml(issue.id)}" data-title="${escapeHtml(
        issue.title.toLowerCase()
      )}" data-labels="${escapeHtml(issue.labels.join(" ").toLowerCase())}">
        <td><a href="#issue-${escapeHtml(issue.id)}">${escapeHtml(issue.id)}</a></td>
        <td>${escapeHtml(issue.title)}</td>
        <td>${escapeHtml(issue.labels.join(", "))}</td>
        <td><a href="${href}">Open</a></td>
      </tr>`;
    })
    .join("");

  const issueSections = issues
    .map((issue, index) => {
      const fileName = issueDraftFilename(index, issue);
      const href = `../issues/${encodeURIComponent(fileName)}`;
      const labels = issue.labels.map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join("");
      return `
      <section class="issue" id="issue-${escapeHtml(issue.id)}" data-id="${escapeHtml(
        issue.id
      )}" data-title="${escapeHtml(issue.title.toLowerCase())}" data-labels="${escapeHtml(
        issue.labels.join(" ").toLowerCase()
      )}">
        <header class="issue-header">
          <h3 class="issue-title">${escapeHtml(issue.title)}</h3>
          <div class="issue-meta">
            <div class="chips">${labels}</div>
            <a class="issue-link" href="${href}">Open draft</a>
          </div>
        </header>
        <details class="issue-details" open>
          <summary>Body</summary>
          <pre>${escapeHtml(issue.body)}</pre>
        </details>
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub Project Pilot Report</title>
    <style>
      ${theme === "mono" ? monoThemeCss() : paperThemeCss()}
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="app-header">
      <div class="app-title">
        <h1>GitHub Project Pilot Report</h1>
        <p class="app-subtitle">${issues.length} draft${issues.length === 1 ? "" : "s"}</p>
      </div>
      <div class="controls" role="search">
        <label class="control">
          <span>Filter</span>
          <input id="filter" type="search" inputmode="search" placeholder="Search by id, title, label…" autocomplete="off" />
        </label>
      </div>
    </header>
    <main id="main">
      <section class="card">
        <h2>Plan</h2>
        <pre>${escapeHtml(plan)}</pre>
      </section>
      <section class="card">
        <h2>Issue Summary</h2>
        <table>
          <caption>Drafts generated from the backlog input.</caption>
          <thead><tr><th scope="col">ID</th><th scope="col">Title</th><th scope="col">Labels</th><th scope="col">Draft</th></tr></thead>
          <tbody id="summary-rows">${issueList}</tbody>
        </table>
      </section>
      <section class="card">
        <h2>Issue Drafts</h2>
        <div id="issue-sections">${issueSections}</div>
      </section>
    </main>
    <script>
      (() => {
        const input = document.getElementById("filter");
        const summaryRows = Array.from(document.querySelectorAll(".summary-row"));
        const sections = Array.from(document.querySelectorAll(".issue"));
        const all = [...summaryRows, ...sections];

        function applyFilter(value) {
          const q = (value || "").trim().toLowerCase();
          if (!q) {
            all.forEach((el) => (el.style.display = ""));
            return;
          }
          all.forEach((el) => {
            const haystack = [el.dataset.id, el.dataset.title, el.dataset.labels].filter(Boolean).join(" ");
            el.style.display = haystack.includes(q) ? "" : "none";
          });
        }

        input?.addEventListener("input", (e) => applyFilter(e.target.value));
      })();
    </script>
  </body>
</html>`;

  writeFileSync(htmlPath, html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeTheme(theme: string): string {
  const normalized = theme.toLowerCase();
  if (normalized !== "paper" && normalized !== "mono") {
    console.warn(`Unknown theme "${theme}", falling back to "paper".`);
    return "paper";
  }
  return normalized;
}

function normalizeOutputFormat(format: string): OutputFormat {
  const normalized = format.trim().toLowerCase();
  if (normalized !== "pretty" && normalized !== "json") {
    throw new Error(`Unknown format "${format}". Expected "pretty" or "json".`);
  }
  return normalized;
}

function normalizeSortMode(mode: string): SortMode {
  const normalized = mode.trim().toLowerCase();
  if (normalized !== "input" && normalized !== "id") {
    throw new Error(`Unknown sort mode "${mode}". Expected "input" or "id".`);
  }
  return normalized;
}

function normalizeGeneratedAt(value?: string): string {
  if (value === undefined) {
    return new Date().toISOString();
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error(`Invalid generated-at value: "${value}"`);
  }
  // Basic validation to catch obvious mistakes while staying permissive.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    throw new Error(`generated-at must be an ISO 8601 timestamp, got: "${value}"`);
  }
  return trimmed;
}

function sortBacklog(backlog: Backlog, mode: SortMode): Backlog {
  if (mode === "input") return backlog;
  return {
    ...backlog,
    items: [...backlog.items].sort((a, b) => a.id.localeCompare(b.id))
  };
}

function paperThemeCss(): string {
  return `
    :root { color-scheme: light dark; }
    :root {
      --bg: #f6f1e7;
      --card: #fffaf0;
      --text: #1e1b16;
      --muted: #4a4237;
      --border: #d1c6b3;
      --code-bg: #1d1a16;
      --code-text: #f0e6d8;
      --chip-bg: rgba(30, 27, 22, 0.08);
      --chip-text: #1e1b16;
      --link: #0a66c2;
      --focus: #0a66c2;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f1114;
        --card: #14181e;
        --text: #e6e6e6;
        --muted: #aeb6c2;
        --border: #2a313b;
        --code-bg: #0b0d10;
        --code-text: #d6f0ff;
        --chip-bg: rgba(230, 230, 230, 0.10);
        --chip-text: #e6e6e6;
        --link: #7ab7ff;
        --focus: #7ab7ff;
      }
    }
    * { box-sizing: border-box; }
    body { font-family: "SF Pro Text", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 2rem; background: var(--bg); color: var(--text); }
    a { color: var(--link); text-decoration-thickness: 0.08em; text-underline-offset: 0.12em; }
    a:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
    .skip-link { position: absolute; left: -999px; top: 0; padding: 0.5rem 0.75rem; background: var(--card); border: 1px solid var(--border); }
    .skip-link:focus { left: 1rem; top: 1rem; }
    .app-header { display: flex; gap: 1.5rem; align-items: end; justify-content: space-between; flex-wrap: wrap; max-width: 980px; margin: 0 auto 1.5rem; }
    .app-title h1 { margin: 0; font-size: 1.7rem; letter-spacing: -0.02em; }
    .app-subtitle { margin: 0.25rem 0 0; color: var(--muted); }
    .controls { display: flex; gap: 1rem; align-items: end; }
    .control { display: grid; gap: 0.35rem; font-size: 0.9rem; color: var(--muted); }
    input[type="search"] { width: min(420px, 80vw); padding: 0.55rem 0.7rem; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--text); }
    main { max-width: 980px; margin: 0 auto; display: grid; gap: 1.25rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 1rem 1.1rem; }
    h2 { margin: 0.25rem 0 0.75rem; font-size: 1.15rem; letter-spacing: -0.01em; }
    pre { background: var(--code-bg); color: var(--code-text); padding: 1rem; overflow-x: auto; border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; }
    caption { text-align: left; color: var(--muted); padding-bottom: 0.5rem; }
    th, td { border-top: 1px solid var(--border); padding: 0.6rem 0.5rem; text-align: left; vertical-align: top; }
    th { font-size: 0.9rem; color: var(--muted); font-weight: 600; }
    .issue { border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 1rem; }
    .issue:first-child { border-top: none; padding-top: 0; margin-top: 0; }
    .issue-header { display: flex; gap: 1rem; align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
    .issue-title { margin: 0; font-size: 1rem; }
    .issue-meta { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
    .chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .chip { display: inline-flex; align-items: center; padding: 0.15rem 0.45rem; border-radius: 999px; background: var(--chip-bg); color: var(--chip-text); font-size: 0.8rem; }
    .issue-details { margin-top: 0.6rem; }
    summary { cursor: pointer; color: var(--muted); }
  `;
}

function monoThemeCss(): string {
  return `
    :root { color-scheme: dark; }
    :root {
      --bg: #0d0f12;
      --card: #101318;
      --text: #e6e6e6;
      --muted: #aeb6c2;
      --border: #2a313b;
      --code-bg: #151a20;
      --code-text: #d6f0ff;
      --chip-bg: rgba(230, 230, 230, 0.10);
      --chip-text: #e6e6e6;
      --link: #7ab7ff;
      --focus: #7ab7ff;
    }
    * { box-sizing: border-box; }
    body { font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin: 2rem; background: var(--bg); color: var(--text); }
    a { color: var(--link); text-decoration-thickness: 0.08em; text-underline-offset: 0.12em; }
    a:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
    .skip-link { position: absolute; left: -999px; top: 0; padding: 0.5rem 0.75rem; background: var(--card); border: 1px solid var(--border); }
    .skip-link:focus { left: 1rem; top: 1rem; }
    .app-header { display: flex; gap: 1.5rem; align-items: end; justify-content: space-between; flex-wrap: wrap; max-width: 980px; margin: 0 auto 1.5rem; }
    .app-title h1 { margin: 0; font-size: 1.4rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .app-subtitle { margin: 0.25rem 0 0; color: var(--muted); }
    .controls { display: flex; gap: 1rem; align-items: end; }
    .control { display: grid; gap: 0.35rem; font-size: 0.85rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    input[type="search"] { width: min(420px, 80vw); padding: 0.55rem 0.7rem; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--text); }
    main { max-width: 980px; margin: 0 auto; display: grid; gap: 1.25rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 1rem 1.1rem; }
    h2 { margin: 0.25rem 0 0.75rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    pre { background: var(--code-bg); color: var(--code-text); padding: 1rem; overflow-x: auto; border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; }
    caption { text-align: left; color: var(--muted); padding-bottom: 0.5rem; }
    th, td { border-top: 1px solid var(--border); padding: 0.6rem 0.5rem; text-align: left; vertical-align: top; }
    th { font-size: 0.85rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
    .issue { border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 1rem; }
    .issue:first-child { border-top: none; padding-top: 0; margin-top: 0; }
    .issue-header { display: flex; gap: 1rem; align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
    .issue-title { margin: 0; font-size: 0.95rem; }
    .issue-meta { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
    .chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .chip { display: inline-flex; align-items: center; padding: 0.15rem 0.45rem; border-radius: 999px; background: var(--chip-bg); color: var(--chip-text); font-size: 0.75rem; }
    .issue-details { margin-top: 0.6rem; }
    summary { cursor: pointer; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  `;
}

function loadSummaryCsv(filePath: string): SummaryRow[] {
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }
  const lines = parseCsv(raw);
  const header = lines.shift();
  if (!header || header.join(",") !== "id,title,labels") {
    throw new Error("summary CSV must have header: id,title,labels");
  }
  return lines.map(([id, title, labels]) => ({
    id,
    title,
    labels: labels ? labels.split(";").filter(Boolean) : []
  }));
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      current.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      current.push(cell);
      rows.push(current);
      current = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  current.push(cell);
  rows.push(current);
  return rows;
}

function listIssueFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(dir, name));
}

function buildPublishPayloads(
  rows: SummaryRow[],
  issueFiles: string[],
  assigneeFromOwner: boolean
): PublishPayload[] {
  return rows.map((row) => {
    const match = issueFiles.find((file) => file.includes(`-${row.id}-`));
    if (!match) {
      throw new Error(`Missing issue draft file for id ${row.id}`);
    }
    const content = readFileSync(match, "utf8");
    const [titleLine, ...rest] = content.split("\n");
    const body = titleLine.startsWith("# ") ? rest.join("\n").trim() : content.trim();
    const assignees = assigneeFromOwner ? parseAssigneesFromIssueBody(body) : undefined;
    return {
      id: row.id,
      title: row.title,
      body,
      labels: row.labels,
      ...(assignees?.length ? { assignees } : {})
    };
  });
}

function createGitHubIssue(
  repo: string,
  issue: PublishPayload
): { url?: string; number?: number } {
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    issue.title,
    "--body",
    issue.body
  ];

  issue.labels.forEach((label) => {
    args.push("--label", label);
  });

  if (issue.assignees?.length) {
    args.push("--assignee", issue.assignees.join(","));
  }

  const stdout = execFileSync("gh", args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  if (stdout) {
    process.stdout.write(stdout);
  }
  const url = parseIssueUrl(stdout);
  const number = url ? parseIssueNumber(url) : undefined;
  return { ...(url ? { url } : {}), ...(number ? { number } : {}) };
}

function createProjectDraft(owner: string, projectNumber: number, issue: IssueDraft): void {
  const args = [
    "project",
    "item-create",
    String(projectNumber),
    "--owner",
    owner,
    "--title",
    issue.title,
    "--body",
    issue.body
  ];
  execFileSync("gh", args, { stdio: "inherit" });
}

function validateTemplates(templates: Templates): void {
  assertTemplateHasPlaceholders(templates.issue, "issue", [
    "project",
    "id",
    "title",
    "pitch",
    "owner",
    "status",
    "tasks",
    "labels",
    "acceptance"
  ]);
  assertTemplateHasPlaceholders(templates.plan, "plan", ["project", "generated_at", "items"]);
}

function assertTemplateHasPlaceholders(template: string, name: string, required: string[]): void {
  const missing = required.filter((key) => !template.includes(`{{${key}}}`));
  if (missing.length > 0) {
    throw new Error(`Template ${name} missing placeholders: ${missing.join(", ")}`);
  }
}

function applyLimit<T>(items: T[], limit?: number): T[] {
  if (!limit || limit <= 0) {
    return items;
  }
  return items.slice(0, limit);
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildLabels(status: string, rawLabels: string[]): string[] {
  const normalized: string[] = [];
  const add = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (normalized.includes(trimmed)) return;
    normalized.push(trimmed);
  };

  add(`status:${status}`);
  rawLabels.forEach(add);
  return normalized;
}

function buildAcceptance(acceptance: string[]): string {
  const defaults = ["Plan exists in /plans", "Docs updated (PLAN/PROJECT/CHANGELOG)", "check passes"];
  const list = (acceptance.length ? acceptance : defaults).map((line) => `- ${line}`);
  return list.join("\n");
}

function buildRisks(risks: string[]): string {
  const defaults = ["Scope creep", "Missing tests", "Unsafe defaults"];
  const list = (risks.length ? risks : defaults).map((line) => `- ${line}`);
  return list.join("\n");
}

function assertUniqueItemIds(backlog: Backlog): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  backlog.items.forEach((item) => {
    if (seen.has(item.id)) {
      duplicates.add(item.id);
    }
    seen.add(item.id);
  });
  if (duplicates.size > 0) {
    const list = [...duplicates].sort((a, b) => a.localeCompare(b)).join(", ");
    throw new Error(`Duplicate backlog item id(s): ${list}`);
  }
}

function issueDraftFilename(index: number, issue: Pick<IssueDraft, "id" | "title">): string {
  const safeTitle = slugify(issue.title) || "issue";
  return `${String(index + 1).padStart(2, "0")}-${issue.id}-${safeTitle}.md`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function readPackageVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const raw = readFileSync(pkgUrl, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim().length > 0 ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function cleanOutputDir(outDir: string): void {
  const normalized = outDir.trim();
  if (!normalized || normalized === "." || normalized === "/" || normalized === "./") {
    throw new Error(`Refusing to clean unsafe output directory: "${outDir}"`);
  }
  if (!existsSync(normalized)) {
    return;
  }
  rmSync(normalized, { recursive: true, force: true });
}

const PublishStateSchema = z.object({
  version: z.literal(1),
  created: z.record(
    z.string(),
    z.object({
      title: z.string(),
      url: z.string().optional(),
      number: z.number().int().positive().optional(),
      labels: z.array(z.string())
    })
  )
});

function defaultPublishStateFile(reportCsvPath: string): string {
  return join(dirname(reportCsvPath), "publish-state.json");
}

function tryLoadPublishState(filePath: string): { state: PublishState; loaded: boolean; error?: string } {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return { state: PublishStateSchema.parse(parsed), loaded: true };
  } catch (error) {
    return { state: { version: 1, created: {} }, loaded: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function savePublishState(filePath: string, state: PublishState): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

const ProjectDraftStateSchema = z.object({
  version: z.literal(1),
  created: z.record(
    z.string(),
    z.object({
      title: z.string()
    })
  )
});

function defaultProjectDraftStateFile(reportCsvPath: string): string {
  return join(dirname(reportCsvPath), "project-drafts-state.json");
}

function tryLoadProjectDraftState(
  filePath: string
): { state: ProjectDraftState; loaded: boolean; error?: string } {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return { state: ProjectDraftStateSchema.parse(parsed), loaded: true };
  } catch (error) {
    return {
      state: { version: 1, created: {} },
      loaded: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function saveProjectDraftState(filePath: string, state: ProjectDraftState): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function parseIssueUrl(output: string): string | undefined {
  const match = output.match(/https:\/\/github\.com\/[^\s]+\/issues\/\d+/);
  return match?.[0];
}

function parseIssueNumber(url: string): number | undefined {
  const match = url.match(/\/issues\/(\d+)$/);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseAssigneesFromIssueBody(body: string): string[] {
  const match = body.match(/^Owner:\s*(.+)\s*$/m);
  if (!match) return [];
  const raw = match[1].trim();
  if (!raw || raw.toLowerCase() === "unassigned") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.startsWith("@") ? value.slice(1) : value));
}

program.exitOverride();
try {
  program.parse(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
      process.exitCode = error.exitCode;
    } else if (error.message) {
      console.error(error.message);
      process.exitCode = error.exitCode ?? 1;
    } else {
      process.exitCode = error.exitCode ?? 1;
    }
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
