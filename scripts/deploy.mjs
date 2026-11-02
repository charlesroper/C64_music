#!/usr/bin/env node
import { execSync } from "node:child_process";

function run(cmd) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: "inherit" });
}

console.log("1. Running lint and format check...");
run("npm run lint");

console.log("2. Running automated test suite...");
run("npm test");

console.log("3. Pushing to GitHub Pages (fork/main)...");
run("git push fork main");

console.log("4. Deployment status:");
try {
  const commit = execSync("git rev-parse --short HEAD").toString().trim();
  console.log(`Successfully pushed commit ${commit} to fork/main.`);
  console.log("GitHub Pages URL: https://charlesroper.github.io/C64_music/");
} catch (err) {
  console.error("Warning reading commit:", err.message);
}
