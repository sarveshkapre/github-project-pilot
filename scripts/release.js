import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const now = new Date().toISOString().split("T")[0];
const changelogPath = new URL("../docs/CHANGELOG.md", import.meta.url);
let changelog = readFileSync(changelogPath, "utf8");

if (!changelog.includes("## [")) {
  throw new Error("CHANGELOG.md missing version headers.");
}

const versionHeader = `## [${pkg.version}] - ${now}`;
if (!changelog.includes(versionHeader)) {
  changelog = changelog.replace("## [Unreleased]", `## [Unreleased]\n\n${versionHeader}`);
  writeFileSync(changelogPath, changelog);
}

execSync("git status --porcelain", { stdio: "inherit" });
console.log("Release prep complete. Review CHANGELOG and tag manually.");
