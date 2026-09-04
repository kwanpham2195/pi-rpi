import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import artifactsExtension, { gitAddBlockReason } from "../../extensions/artifacts.ts";
import { createArtifact, createTask, loadManifest, setArtifactStatus, suggestTaskActions } from "../../src/engine/index.ts";

const cwd = "/tmp/rpi-stage-guard";
const execFileAsync = promisify(execFile);

test("active task context is added to the current turn's system prompt", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "system-prompt-task", title: "System prompt task", flow: "rpi", baseBranch: "main" });
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
  const extension = fakeExtensionApi(branch);
  try {
    const result = await extension.eventHandlers.get("before_agent_start")!(
      { systemPrompt: "Base prompt" },
      extension.context(project),
    ) as { systemPrompt: string };

    assert.match(result.systemPrompt, /^Base prompt/);
    assert.match(result.systemPrompt, /Active task: system-prompt-task/);
    assert.deepEqual(extension.appendedEntries, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a missing persisted task is not added to the system prompt", async () => {
  const project = await tempProject();
  const branch = [{ type: "custom", customType: "rpi-active-task-selection", data: { slug: "gone-task" } }];
  const extension = fakeExtensionApi(branch);
  try {
    const result = await extension.eventHandlers.get("before_agent_start")!(
      { systemPrompt: "Base prompt" },
      extension.context(project),
    );

    assert.equal(result, undefined);
    assert.deepEqual(extension.notifications, ["Selected task \"gone-task\" is unavailable. Select another task with /rpi-task."]);
    await assert.rejects(invoke(extension.tools.get("rpi_list_artifacts")!, {}, extension.context(project)), /No task selected/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("explicit task context reports detailed suggestions and a concise footer without an editor widget", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "parent-child-tracking", title: "Parent-child tracking", flow: "rpi", baseBranch: "main" });
  const taskDir = join(root, task.slug);
  try {
    await createArtifact(taskDir, { type: "research-questions", description: "questions", content: "q", dependsOn: [] });
    await setArtifactStatus(await loadManifest(taskDir), "research-questions", "in-review", taskDir);
    await setArtifactStatus(await loadManifest(taskDir), "research-questions", "approved", taskDir);
    await createArtifact(taskDir, { type: "research", description: "codebase", content: "r", dependsOn: ["research-questions"], status: "in-review" });
    await createArtifact(taskDir, { type: "mockup", description: "screen", content: "m", dependsOn: [], status: "in-review" });
    const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
    const { context, statuses, tools, widgets } = fakeExtensionApi(branch);
    const result = await invoke(tools.get("rpi_get_task_context")!, { slug: task.slug }, context(project)) as { content: Array<{ text: string }> };

    assert.equal(statuses.at(-1), "parent-child-tracking · rpi · actions: review research for approval · 2 in review");
    assert.match(result.content[0]!.text, /"suggestedActions": \[/);
    assert.match(result.content[0]!.text, /review research for approval/);
    assert.deepEqual(widgets, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("artifact status changes refresh the active task footer", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "footer-refresh", title: "Footer refresh", flow: "rpi", baseBranch: "main" });
  const taskDir = join(root, task.slug);
  try {
    await createArtifact(taskDir, { type: "research-questions", description: "questions", content: "q", dependsOn: [] });
    await setArtifactStatus(await loadManifest(taskDir), "research-questions", "in-review", taskDir);
    const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
    const { context, statuses, tools, widgets } = fakeExtensionApi(branch);

    await invoke(tools.get("rpi_set_artifact_status")!, { artifactId: "research-questions", status: "approved" }, context(project));

    assert.equal(statuses.at(-1), "footer-refresh · rpi · actions: create research, create mockup (optional) · 0 in review");
    assert.deepEqual(widgets, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi-init creates the default workspace config, ignores local state, and preserves an existing config", async () => {
  const project = await tempProject();
  const { commands, context, notifications } = fakeExtensionApi();
  const workspacePath = join(project, ".pi", "workspace.json");
  const localWorkspacePath = join(project, ".pi", "workspace.local.json");
  try {
    await commands.get("rpi-init")!.handler("", context(project));

    assert.ok((await stat(join(project, ".pi", "artifacts"))).isDirectory());
    const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
    assert.deepEqual(workspace, {
      disabled: false,
      pathTemplate: "~/.pi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
      branchTemplate: "{{ TASKSLUG }}",
      repos: [{
        localPath: ".",
        primary: true,
        sourceRef: "origin/main",
        setupCommand: "",
        copyGlobs: [".env*", ".pi/settings.json", ".pi/workspace.local.json"],
      }],
    });
    const initialIgnore = await readFile(join(project, ".gitignore"), "utf8");
    assert.ok(initialIgnore.split("\n").includes(".pi/artifacts"));
    assert.ok(initialIgnore.split("\n").includes(".pi/workspace.local.json"));

    await assert.rejects(readFile(localWorkspacePath, "utf8"), { code: "ENOENT" });
    const customizedConfig = '{"repos":[]}\n';
    const localConfig = '{"disabled":true}\n';
    await writeFile(workspacePath, customizedConfig, "utf8");
    await writeFile(localWorkspacePath, localConfig, "utf8");
    await commands.get("rpi-init")!.handler("", context(project));

    assert.equal(await readFile(workspacePath, "utf8"), customizedConfig);
    assert.equal(await readFile(localWorkspacePath, "utf8"), localConfig);
    const repeatedIgnore = await readFile(join(project, ".gitignore"), "utf8");
    assert.equal(repeatedIgnore.split("\n").filter((entry) => entry === ".pi/artifacts").length, 1);
    assert.equal(repeatedIgnore.split("\n").filter((entry) => entry === ".pi/workspace.local.json").length, 1);
    assert.deepEqual(notifications, [
      "RPI ready: .pi/artifacts and .pi/workspace.json",
      "RPI ready: .pi/artifacts and .pi/workspace.json",
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("commands reject print mode before mutating files or dispatching messages", async () => {
  const project = await tempProject();
  const { commands, context, sentMessages, sentUserMessages } = fakeExtensionApi([], undefined, [], undefined, false);
  try {
    await assert.rejects(commands.get("rpi-init")!.handler("", context(project)), /interactive or RPC mode/);
    await assert.rejects(commands.get("rpi-new")!.handler("Create task", context(project)), /interactive or RPC mode/);
    await assert.rejects(stat(join(project, ".pi", "artifacts")), { code: "ENOENT" });
    assert.deepEqual(sentMessages, []);
    assert.deepEqual(sentUserMessages, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("persisted selection restores the active task footer without a visible context message", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  await createTask(root, { slug: "restored-task", title: "Restored", flow: "rpi", baseBranch: "main" });
  const initial = fakeExtensionApi();
  try {
    await initial.commands.get("rpi-task")!.handler("restored-task", initial.context(project));
    const restored = fakeExtensionApi(initial.appendedEntries);
    await restored.eventHandlers.get("session_start")!({}, restored.context(project));
    await invoke(restored.tools.get("rpi_list_artifacts")!, {}, restored.context(project));
    const systemPrompt = await restored.eventHandlers.get("before_agent_start")!(
      { systemPrompt: "Base prompt" },
      restored.context(project),
    ) as { systemPrompt: string };
    assert.ok(restored.statuses.some((status) => status?.startsWith("restored-task · rpi") === true));
    assert.match(systemPrompt.systemPrompt, /Active task: restored-task/);
    assert.deepEqual(restored.appendedEntries, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("tree navigation clears the footer when the destination has no selected task", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  await createTask(root, { slug: "tree-task", title: "Tree task", flow: "rpi", baseBranch: "main" });
  const extension = fakeExtensionApi();
  try {
    await extension.commands.get("rpi-task")!.handler("tree-task", extension.context(project));
    extension.sessionEntries.splice(0);

    await extension.eventHandlers.get("session_tree")!({}, extension.context(project));

    assert.equal(extension.statuses.at(-1), undefined);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("artifact reads report line and multibyte byte truncation", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "truncated-read", title: "Truncated", flow: "freeform", baseBranch: "main" });
  const directory = join(root, task.slug);
  try {
    await createArtifact(directory, { type: "research", description: "content", content: Array.from({ length: 2001 }, () => "x").join("\n"), dependsOn: [] });
    const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
    const extension = fakeExtensionApi(branch);
    const first = await invoke(extension.tools.get("rpi_read_artifact")!, { artifactId: "research" }, extension.context(project)) as { content: Array<{ text: string }> };
    assert.match(first.content[0]!.text, /lines 2000 of 2001; bytes/);
    assert.match(first.content[0]!.text, new RegExp(`Full output: ${join(directory, "01-research-content.md")}`));
    await writeFile(join(directory, "01-research-content.md"), "é".repeat(30_000), "utf8");
    const second = await invoke(extension.tools.get("rpi_read_artifact")!, { artifactId: "research" }, extension.context(project)) as { content: Array<{ text: string }> };
    assert.match(second.content[0]!.text, /lines 0 of 1; bytes 0B of/);
    assert.match(second.content[0]!.text, new RegExp(`Full output: ${join(directory, "01-research-content.md")}`));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi_git_diff preserves truncated output and returns its path", async () => {
  const project = await tempProject();
  let fullOutputPath: string | undefined;
  try {
    await runGit(project, ["init", "--initial-branch=main"]);
    await runGit(project, ["config", "user.email", "rpi@example.test"]);
    await runGit(project, ["config", "user.name", "RPI test"]);
    await writeFile(join(project, "tracked.txt"), "baseline\n", "utf8");
    await runGit(project, ["add", "tracked.txt"]);
    await runGit(project, ["commit", "-m", "base"]);
    const { stdout: baseRef } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: project });
    await writeFile(join(project, "tracked.txt"), Array.from({ length: 2_100 }, () => "changed line").join("\n"), "utf8");
    await runGit(project, ["add", "tracked.txt"]);
    await runGit(project, ["commit", "-m", "large diff"]);

    const extension = fakeExtensionApi();
    const result = await invoke(extension.tools.get("rpi_git_diff")!, { baseRef: baseRef.trim() }, extension.context(project)) as {
      content: Array<{ text: string }>;
      details: { fullOutputPath?: string };
    };
    fullOutputPath = result.details.fullOutputPath;

    assert.ok(fullOutputPath);
    assert.match(result.content[0]!.text, new RegExp(`Full output: ${fullOutputPath}`));
    assert.match(await readFile(fullOutputPath, "utf8"), /\+changed line/);
  } finally {
    if (fullOutputPath) await rm(dirname(fullOutputPath), { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi-annotate guides the user without launching Plannotator when no task is active", async () => {
  const { commands, context, notifications, processCalls } = fakeExtensionApi();

  await commands.get("rpi-annotate")!.handler("", context("/tmp/rpi-no-active-task"));

  assert.deepEqual(processCalls, []);
  assert.deepEqual(notifications, ["No active task. Use /rpi-task <slug>."]);
});

test("rpi-annotate sends annotated feedback to the active agent", async () => {
  const project = "/tmp/rpi-annotate-active";
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: "review-me" } } }];
  const { commands, context, notifications, processCalls, sentUserMessageOptions, sentUserMessages } = fakeExtensionApi(
    branch,
    { stdout: '{"decision":"annotated","feedback":"Clarify the task scope."}', stderr: "", code: 0, killed: false },
  );

  await commands.get("rpi-annotate")!.handler("", context(project));

  assert.deepEqual(processCalls, [{ command: "plannotator", args: ["annotate", join(project, ".pi", "artifacts", "review-me"), "--json"] }]);
  assert.deepEqual(notifications, ["Plannotator feedback queued."]);
  assert.equal(sentUserMessages.length, 1);
  assert.match(sentUserMessages[0]!, /RPI Artifact Annotations/);
  assert.match(sentUserMessages[0]!, /\.pi\/artifacts\/review-me/);
  assert.match(sentUserMessages[0]!, /Clarify the task scope\./);
  assert.match(sentUserMessages[0]!, /iterate-\* skill/);
  assert.deepEqual(sentUserMessageOptions, [{ deliverAs: "followUp" }]);
});

test("rpi-annotate sends approved annotation notes to the active agent", async () => {
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: "review-me" } } }];
  const { commands, context, sentUserMessageOptions, sentUserMessages } = fakeExtensionApi(
    branch,
    { stdout: '{"decision":"approved","feedback":"Add acceptance criteria."}', stderr: "", code: 0, killed: false },
  );

  await commands.get("rpi-annotate")!.handler("", context("/tmp/rpi-annotate-approved-notes"));

  assert.equal(sentUserMessages.length, 1);
  assert.match(sentUserMessages[0]!, /Add acceptance criteria\./);
  assert.deepEqual(sentUserMessageOptions, [{ deliverAs: "followUp" }]);
});

test("rpi-annotate does not send approved, dismissed, or malformed results to the active agent", async () => {
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: "review-me" } } }];
  const cases: Array<[string, string]> = [
    ['{"decision":"approved","feedback":""}', "Plannotator annotation approved."],
    ['{"decision":"dismissed","feedback":"Ignored note"}', "Plannotator annotation dismissed."],
    ['{"decision":"unknown","feedback":"Ignored note"}', "Plannotator returned invalid annotation data."],
    ["not json", "Plannotator returned invalid annotation data."],
  ];
  for (const [stdout, notification] of cases) {
    const { commands, context, notifications, sentUserMessages } = fakeExtensionApi(branch, { stdout, stderr: "", code: 0, killed: false });

    await commands.get("rpi-annotate")!.handler("", context("/tmp/rpi-annotate-no-feedback"));

    assert.deepEqual(sentUserMessages, []);
    assert.deepEqual(notifications, [notification]);
  }
});

test("rpi-annotate reports Plannotator process failures without throwing", async () => {
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: "review-me" } } }];
  const { commands, context, notifications } = fakeExtensionApi(
    branch,
    { stdout: "", stderr: "Plannotator did not start.", code: 1, killed: false },
  );

  await commands.get("rpi-annotate")!.handler("", context("/tmp/rpi-annotate-failure"));

  assert.deepEqual(notifications, ["Plannotator did not start."]);
});

test("rpi-new uses descriptive flows and sends a hidden task instruction", async () => {
  const label = "PRD — research, requirements, tests, then implementation";
  const { commands, context, selectionCalls, sentMessages, sentUserMessages } = fakeExtensionApi([], undefined, [label]);

  await commands.get("rpi-new")!.handler("Track parent-child projects", context("/tmp/rpi-new"));

  assert.deepEqual(selectionCalls, [{ title: "Select task flow:", options: [
    "RPI — research, design, outline, then implementation", label,
    "One-shot — ticket directly to implementation", "Freeform — no enforced artifact chain",
  ] }]);
  assert.deepEqual(sentUserMessages, []);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]!.message.display, false);
  assert.equal(sentMessages[0]!.options?.triggerTurn, true);
  assert.match(sentMessages[0]!.message.content, /rpi_create_task exactly once/);
  assert.match(sentMessages[0]!.message.content, /Use flow "prd"/);
});
test("rpi-new does not dispatch to the LLM when its intent is cancelled", async () => {
  const { commands, context, notifications, sentUserMessages } = fakeExtensionApi();

  await commands.get("rpi-new")!.handler("", context("/tmp/rpi-new-cancelled"));

  assert.deepEqual(sentUserMessages, []);
  assert.deepEqual(notifications, ["Task intent is required."]);
});

test("rpi-new does not dispatch when its flow picker is cancelled", async () => {
  const { commands, context, notifications, sentUserMessages } = fakeExtensionApi();

  await commands.get("rpi-new")!.handler("Track parent-child projects", context("/tmp/rpi-new-flow-cancelled"));

  assert.deepEqual(sentUserMessages, []);
  assert.deepEqual(notifications, []);
});

test("rpi-task selects an existing task from the picker and does not create missing tasks", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "pick-me", title: "Pick me", flow: "rpi", baseBranch: "main" });
  const { commands, context, statuses } = fakeExtensionApi([], undefined, ["pick-me · Pick me · rpi"]);
  try {
    const suggestions = suggestTaskActions(await loadManifest(join(root, task.slug)));
    assert.equal(suggestions.length, 3);
    await commands.get("rpi-task")!.handler("", context(project));
    assert.ok(statuses.includes("pick-me · rpi · actions: create research-questions, create mockup (optional) · 0 in review"));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi-task reports missing tasks instead of creating them", async () => {
  const project = await tempProject();
  const { commands, context, notifications } = fakeExtensionApi();
  try {
    await commands.get("rpi-task")!.handler("missing", context(project));
    assert.deepEqual(notifications, ["Task \"missing\" was not found. Use /rpi-new."]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi-change-base does not run Git when no task is active", async () => {
  const { commands, context, notifications, processCalls } = fakeExtensionApi();

  await commands.get("rpi-change-base")!.handler("", context("/tmp/rpi-change-base"));

  assert.deepEqual(processCalls, []);
  assert.deepEqual(notifications, ["No active task. Use /rpi-task."]);
});

test("rpi-change-base handles Git failures and empty branch lists without changing the task", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  await createTask(root, { slug: "base-task", title: "Base task", flow: "rpi", baseBranch: "main" });
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: "base-task" } } }];
  try {
    const failed = fakeExtensionApi(branch, { stdout: "", stderr: "not a repo", code: 1, killed: false });
    await failed.commands.get("rpi-change-base")!.handler("", failed.context(project));
    assert.deepEqual(failed.notifications, ["Could not list Git branches."]);

    const empty = fakeExtensionApi(branch, { stdout: "origin/HEAD\n\n", stderr: "", code: 0, killed: false });
    await empty.commands.get("rpi-change-base")!.handler("", empty.context(project));
    assert.deepEqual(empty.notifications, ["No Git branches are available."]);
    assert.equal((await loadManifest(join(root, "base-task"))).baseBranch, "main");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi-change-base leaves the active task unchanged when its picker is cancelled", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  await createTask(root, { slug: "base-task", title: "Base task", flow: "rpi", baseBranch: "main" });
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: "base-task" } } }];
  const { commands, context } = fakeExtensionApi(branch, { stdout: "origin/main\nmain\n", stderr: "", code: 0, killed: false });
  try {
    await commands.get("rpi-change-base")!.handler("", context(project));
    assert.equal((await loadManifest(join(root, "base-task"))).baseBranch, "main");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi-change-base persists the selected Git branch", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  await createTask(root, { slug: "base-task", title: "Base task", flow: "rpi", baseBranch: "main" });
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: "base-task" } } }];
  const { commands, context, notifications, processCalls } = fakeExtensionApi(
    branch,
    { stdout: "origin/HEAD\norigin/main\nmain\norigin/main\n", stderr: "", code: 0, killed: false },
    ["origin/main"],
  );
  try {
    await commands.get("rpi-change-base")!.handler("", context(project));
    assert.deepEqual(processCalls, [{
      command: "git",
      args: ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin"],
      options: { cwd: project },
    }]);
    assert.deepEqual(notifications, ["Base branch: origin/main"]);
    assert.equal((await loadManifest(join(root, "base-task"))).baseBranch, "origin/main");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi-approve selects and approves an in-review artifact", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "approve-task", title: "Approve task", flow: "rpi", baseBranch: "main" });
  const taskDir = join(root, task.slug);
  await createArtifact(taskDir, { type: "research-questions", description: "questions", content: "q", dependsOn: [] });
  await setArtifactStatus(await loadManifest(taskDir), "research-questions", "in-review", taskDir);
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
  const { commands, context, notifications } = fakeExtensionApi(branch, undefined, ["research-questions"]);
  try {
    await commands.get("rpi-approve")!.handler("", context(project));
    assert.equal((await loadManifest(taskDir)).artifacts.find((artifact) => artifact.id === "research-questions")?.status, "approved");
    assert.deepEqual(notifications, ["research-questions -> approved"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi-approve leaves an in-review artifact unchanged when its picker is cancelled", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "approve-task", title: "Approve task", flow: "rpi", baseBranch: "main" });
  const taskDir = join(root, task.slug);
  await createArtifact(taskDir, { type: "research-questions", description: "questions", content: "q", dependsOn: [] });
  await setArtifactStatus(await loadManifest(taskDir), "research-questions", "in-review", taskDir);
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
  const { commands, context } = fakeExtensionApi(branch);
  try {
    await commands.get("rpi-approve")!.handler("", context(project));
    assert.equal((await loadManifest(taskDir)).artifacts.find((artifact) => artifact.id === "research-questions")?.status, "in-review");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi-approve reports when no active task is selected", async () => {
  const { commands, context, notifications } = fakeExtensionApi();

  await commands.get("rpi-approve")!.handler("", context("/tmp/rpi-approve"));

  assert.deepEqual(notifications, ["No active task. Use /rpi-task."]);
});

test("git add guard blocks broad, artifact, chained, and indirect staging without blocking prose or explicit source paths", () => {
  for (const command of ["git add .", "git add -- .", "git -C . add .", "git add -A", "git add --all", "git add -u", "git add --update", "git add :/", "git add '*.ts'", "git add .pi/artifacts/task/file.md", "git -C . add .pi/artifacts/task/file.md", "git add --pathspec-from-file=paths", "git add $PATHS", "git add src/a.ts && git add .", "command git add src/a.ts", "env GIT_OPTIONAL_LOCKS=0 git add src/a.ts", "sh -c 'git add src/a.ts'", "$GIT add src/a.ts", '"$GIT" add src/a.ts', "'${GIT}' add src/a.ts", "/usr/bin/git add .", 'echo "example"; git add .', "git -C sub add ../.pi/artifacts/x"]) {
    assert.ok(gitAddBlockReason(command, cwd), command);
  }
  assert.equal(gitAddBlockReason("git add src/a.ts test/a.test.ts", cwd), null);
  assert.equal(gitAddBlockReason('echo "git add .pi/artifacts/task/file.md"', cwd), null);
  assert.equal(gitAddBlockReason('"quoted prose only"', cwd), null);
});

test("manifest suggestions respect reviews, dependencies, optional planning, and completion", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "suggestions", title: "Suggestions", flow: "rpi", baseBranch: "main" });
  const taskDir = join(root, task.slug);
  try {
    await createArtifact(taskDir, { type: "research-questions", description: "questions", content: "q", dependsOn: [] });
    assert.deepEqual(suggestTaskActions(await loadManifest(taskDir)).map((action) => action.label), ["iterate research-questions"]);

    await approveArtifact(taskDir, "research-questions");
    assert.ok(suggestTaskActions(await loadManifest(taskDir)).some((action) => action.label === "create research"));
    await createArtifact(taskDir, { type: "research", description: "codebase", content: "r", dependsOn: ["research-questions"], status: "in-review" });
    const reviewSuggestions = suggestTaskActions(await loadManifest(taskDir)).map((action) => action.label);
    assert.equal(reviewSuggestions[0], "review research for approval");
    assert.equal(reviewSuggestions.includes("create design-discussion"), false);

    await approveArtifact(taskDir, "research");
    await createArtifact(taskDir, { type: "design-discussion", description: "design", content: "d", dependsOn: ["research"] });
    await approveArtifact(taskDir, "design-discussion");
    await createArtifact(taskDir, { type: "structure-outline", description: "outline", content: "o", dependsOn: ["design-discussion"] });
    await approveArtifact(taskDir, "structure-outline");
    const readyToImplement = suggestTaskActions(await loadManifest(taskDir)).map((action) => action.label);
    assert.deepEqual(readyToImplement.slice(0, 2), ["implement outline", "create plan (optional)"]);
    await createArtifact(taskDir, { type: "mockup", description: "screen", content: "m", dependsOn: [] });
    assert.deepEqual(
      suggestTaskActions(await loadManifest(taskDir)).map((action) => action.label).slice(0, 2),
      ["implement outline", "iterate mockup"],
    );
    await createArtifact(taskDir, { type: "plan", description: "plan", content: "p", dependsOn: ["structure-outline"] });
    await approveArtifact(taskDir, "plan");
    assert.equal(suggestTaskActions(await loadManifest(taskDir))[0]?.label, "implement plan");


    await createArtifact(taskDir, { type: "implementation", description: "implemented", content: "i", dependsOn: ["plan"] });
    await approveArtifact(taskDir, "implementation");
    await createArtifact(taskDir, { type: "pr-description", description: "pull-request", content: "p", dependsOn: ["implementation"] });
    await approveArtifact(taskDir, "pr-description");
    assert.equal(suggestTaskActions(await loadManifest(taskDir))[0]?.label, "workflow complete");

    const freeform = await createTask(root, { slug: "freeform-suggestions", title: "Freeform", flow: "freeform", baseBranch: "main" });
    assert.deepEqual(suggestTaskActions(await loadManifest(join(root, freeform.slug))).map((action) => action.label), ["choose an artifact that fits the work"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function approveArtifact(taskDir: string, artifactId: string): Promise<void> {
  await setArtifactStatus(await loadManifest(taskDir), artifactId, "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), artifactId, "approved", taskDir);
}

type Tool = {
  name: string;
  renderResult?: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: (update: unknown) => void,
    ctx: unknown,
  ) => Promise<unknown>;
};
type Command = { handler: (args: string, ctx: unknown) => Promise<void> };

function fakeExtensionApi(
  branch: unknown[] = [],
  execResult = { stdout: "", stderr: "", code: 0, killed: false },
  selections: Array<string | undefined> = [],
  agentRpc?: (request: { method: string; requestId: string }, reply: (response: unknown) => void) => void,
  hasUI = true,
  mode: "tui" | "rpc" | "print" = hasUI ? "tui" : "print",
) {
  const tools = new Map<string, Tool>();
  const commands = new Map<string, Command>();
  const notifications: string[] = [];
  const processCalls: Array<{ command: string; args: string[]; options?: { cwd?: string } }> = [];
  const statuses: Array<string | undefined> = [];
  const widgets: unknown[][] = [];
  const selectionCalls: Array<{ title: string; options: string[] }> = [];
  const sentUserMessages: string[] = [];
  const sentUserMessageOptions: Array<{ deliverAs?: string } | undefined> = [];
  const sentMessages: Array<{ message: { customType: string; content: string; display: boolean }; options: { triggerTurn?: boolean } | undefined }> = [];
  const appendedEntries: Array<{ type: string; customType: string; data: unknown }> = [];
  const entryRenderers = new Map<string, unknown>();
  const sessionEntries = [...branch];
  const rpcHandlers = new Map<string, (data: unknown) => void>();
  const eventHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const pi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      eventHandlers.set(event, handler);
    },
    registerTool: (tool: unknown) => {
      const candidate = tool as Tool;
      tools.set(candidate.name, candidate);
    },
    registerEntryRenderer: (customType: string, renderer: unknown) => { entryRenderers.set(customType, renderer); },
    appendEntry: (customType: string, data: unknown) => {
      const entry = { type: "custom", customType, data };
      appendedEntries.push(entry);
      sessionEntries.push(entry);
    },
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        rpcHandlers.set(channel, handler);
        return () => rpcHandlers.delete(channel);
      },
      emit: (_channel: string, request: { requestId: string; method: string }) => {
        agentRpc?.(request, (response) => rpcHandlers.get(`subagents:rpc:v1:reply:${request.requestId}`)?.(response));
      },
    },
    exec: async (command: string, args: string[], options?: { cwd?: string }) => {
      processCalls.push({ command, args, ...(options ? { options } : {}) });
      return execResult;
    },
    sendUserMessage: (message: string, options?: { deliverAs?: string }) => {
      sentUserMessages.push(message);
      sentUserMessageOptions.push(options);
    },
    sendMessage: (message: { customType: string; content: string; display: boolean }, options?: { triggerTurn?: boolean }) => {
      sentMessages.push({ message, options });
    },
    registerCommand: (name: string, command: unknown) => {
      commands.set(name, command as Command);
    },
  };
  artifactsExtension(pi as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);
  const context = (cwd: string) => ({
    cwd,
    hasUI,
    mode,
    sessionManager: { getBranch: () => sessionEntries },
    ui: {
      notify: async (message: string) => { notifications.push(message); },
      editor: async (_title: string, _value: string) => undefined,
      select: async (title: string, options: string[]) => {
        selectionCalls.push({ title, options });
        return selections.shift();
      },
      setStatus: (_key: string, value: string | undefined) => { statuses.push(value); },
      setWidget: (...args: unknown[]) => { widgets.push(args); },
    },
  });
  return { tools, commands, context, eventHandlers, notifications, processCalls, sentUserMessageOptions, sentUserMessages, sentMessages, appendedEntries, entryRenderers, sessionEntries, statuses, widgets, selectionCalls };
}

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rpi-extension-"));
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function invoke(tool: Tool, params: Record<string, unknown>, ctx: unknown): Promise<unknown> {
  return tool.execute("call", params, new AbortController().signal, () => undefined, ctx);
}

function flowFromCreateTaskResult(value: unknown): string {
  if (value === null || typeof value !== "object") throw new Error("Expected a tool result object.");
  const details = (value as { details?: unknown }).details;
  if (details === null || typeof details !== "object" || typeof (details as { flow?: unknown }).flow !== "string") {
    throw new Error("Expected a task flow in tool result details.");
  }
  return (details as { flow: string }).flow;
}

test("rpi_implement_phase formats stopped runs as failures and preserves terminal details", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "phase-result", title: "Phase result", flow: "rpi", baseBranch: "main" });
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
  const { tools, context } = fakeExtensionApi(branch, undefined, [], (request, reply) => {
    if (request.method === "spawn") {
      reply({ version: 1, requestId: request.requestId, success: true, data: { text: "spawn", details: { runId: "stopped-run" } } });
      return;
    }
    if (request.method === "status") {
      reply({ version: 1, requestId: request.requestId, success: true, data: {
        text: "stopped", output: "The child stopped after partial work.", results: [{ summary: "partial change" }],
        asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "stopped-run", state: "stopped" }] },
      } });
      return;
    }
    reply({ version: 1, requestId: request.requestId, success: true, data: { text: "interrupted" } });
  });
  try {
    const result = await invoke(tools.get("rpi_implement_phase")!, {
      phaseId: "phase-2", agent: "artifact-implementer", phaseTask: "Implement safely", timeoutMs: 10,
    }, context(project)) as { content: Array<{ text: string }>; details: { runId: string; state: string; phaseId: string } };

    assert.match(result.content[0]!.text, /Implementation phase phase-2 failed with state "stopped" \(run stopped-run\)/);
    assert.match(result.content[0]!.text, /The child stopped after partial work/);
    assert.match(result.content[0]!.text, /partial change/);
    assert.deepEqual(result.details, { runId: "stopped-run", state: "stopped", phaseId: "phase-2" });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi_implement_phase forwards configured timeouts to its phase diagnostic", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "phase-timeout", title: "Phase timeout", flow: "rpi", baseBranch: "main" });
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
  const { tools, context } = fakeExtensionApi(branch, undefined, [], (request, reply) => {
    const data = request.method === "spawn"
      ? { text: "spawn", details: { runId: "tool-timeout-run" } }
      : request.method === "status"
        ? { text: "running", asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "tool-timeout-run", state: "running" }] } }
        : { text: "interrupted" };
    reply({ version: 1, requestId: request.requestId, success: true, data });
  });
  try {
    await assert.rejects(
      invoke(tools.get("rpi_implement_phase")!, {
        phaseId: "phase-4", agent: "artifact-implementer", phaseTask: "Implement safely", timeoutMs: 10,
      }, context(project)),
      (error: Error) => {
        assert.match(error.message, /The implementation phase timed out after 10ms/);
        assert.match(error.message, /phase phase-4/);
        assert.match(error.message, /run tool-timeout-run/);
        assert.doesNotMatch(error.message, /pi install npm:pi-subagents/);
        return true;
      },
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("artifact public tools reject traversal slugs before filesystem access", async () => {
  const project = await tempProject();
  const { tools, context } = fakeExtensionApi();
  const ctx = context(project);
  try {
    await assert.rejects(invoke(tools.get("rpi_get_task_context")!, { slug: "../outside" }, ctx), /Invalid task slug/);
    await assert.rejects(invoke(tools.get("rpi_list_artifacts")!, { slug: "../outside" }, ctx), /Invalid task slug/);
    await assert.rejects(invoke(tools.get("rpi_read_artifact")!, { slug: "../outside", artifactId: "research" }, ctx), /Invalid task slug/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("restored task selection only trusts RPI selection tool results", async () => {
  const project = await tempProject();
  const maliciousBranch = [{ type: "message", message: { role: "toolResult", toolName: "bash", details: { taskSlug: "victim" } } }];
  const { tools, context } = fakeExtensionApi(maliciousBranch);
  try {
    await assert.rejects(
      invoke(tools.get("rpi_list_artifacts")!, {}, context(project)),
      /No task selected/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
test("rpi-task selects an existing task and rpi-status reports its persisted flow", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  await createTask(root, { slug: "existing-prd", title: "Existing", flow: "prd", baseBranch: "main" });
  const { commands, context, appendedEntries, statuses } = fakeExtensionApi();
  try {
    const ctx = context(project);
    await commands.get("rpi-task")!.handler("existing-prd", ctx);
    await commands.get("rpi-status")!.handler("", ctx);
    assert.ok(statuses.includes("existing-prd · prd · actions: create research-questions, create mockup (optional) · 0 in review"));
    const entry = appendedEntries.find((candidate) => candidate.customType === "rpi-task-status");
    assert.ok(entry);
    assert.match(String((entry.data as { report: string }).report), /Suggested actions:\n- create research-questions/);
    initTheme();
    const renderer = (fakeExtensionApi().entryRenderers.get("rpi-task-status"));
    if (typeof renderer !== "function") throw new Error("Expected task status renderer");
    const compact = renderer(entry, { expanded: false }, { fg: (_color: string, text: string) => text }).render(160).join("\n");
    assert.match(compact, /Next: create research-questions/);
    assert.match(compact, /to expand/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi status commands return reports through RPC notifications", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "rpc-status", title: "RPC status", flow: "rpi", baseBranch: "main" });
  const directory = join(root, task.slug);
  try {
    await createArtifact(directory, { type: "research-questions", description: "questions", content: "q", dependsOn: [] });
    await setArtifactStatus(await loadManifest(directory), "research-questions", "in-review", directory);
    await setArtifactStatus(await loadManifest(directory), "research-questions", "approved", directory);
    await createArtifact(directory, { type: "research", description: "research", content: "r", dependsOn: ["research-questions"] });
    const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
    const extension = fakeExtensionApi(branch, undefined, [], undefined, true, "rpc");
    const ctx = extension.context(project);

    await extension.commands.get("rpi-status")!.handler("", ctx);
    await extension.commands.get("rpi-artifacts")!.handler("", ctx);

    assert.equal(extension.appendedEntries.length, 0);
    assert.equal(extension.notifications.length, 2);
    assert.match(extension.notifications[0]!, /# rpc-status \(rpi\)/);
    assert.match(extension.notifications[1]!, /research-questions → research/);
    assert.match(extension.notifications[1]!, /Suggested actions:/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi_create_task reopens and selects the persisted task flow", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  await createTask(root, { slug: "persisted-prd", title: "Persisted", flow: "prd", baseBranch: "main" });
  const { tools, context, statuses } = fakeExtensionApi();
  try {
    const result = await invoke(tools.get("rpi_create_task")!, {
      slug: "persisted-prd", title: "Wrong requested flow", flow: "rpi",
    }, context(project));
    assert.equal(flowFromCreateTaskResult(result), "prd");
    assert.ok(statuses.includes("persisted-prd · prd · actions: create research-questions, create mockup (optional) · 0 in review"));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("rpi_implement_phase forwards queued and running updates with compact render hooks", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "phase-progress", title: "Phase progress", flow: "rpi", baseBranch: "main" });
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
  let statusCalls = 0;
  const extension = fakeExtensionApi(branch, undefined, [], (request, reply) => {
    if (request.method === "spawn") {
      reply({ version: 1, requestId: request.requestId, success: true, data: { text: "spawn", details: { runId: "progress-phase-run" } } });
      return;
    }
    if (request.method === "status") {
      const state = ++statusCalls === 1 ? "running" : "complete";
      reply({ version: 1, requestId: request.requestId, success: true, data: { text: state, asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "progress-phase-run", state }] } } });
      return;
    }
    reply({ version: 1, requestId: request.requestId, success: true, data: { text: "interrupted" } });
  });
  const updates: Array<{ details: { operation: string; runId: string; state: string; pollCount: number; phaseId?: string } }> = [];
  try {
    await extension.tools.get("rpi_implement_phase")!.execute(
      "call",
      { phaseId: "phase-progress", agent: "artifact-implementer", phaseTask: "Implement safely", timeoutMs: 2_500 },
      new AbortController().signal,
      (update) => { updates.push(update as typeof updates[number]); },
      extension.context(project),
    );

    assert.deepEqual(updates.map((update) => update.details), [
      { operation: "implementation", runId: "progress-phase-run", state: "queued", pollCount: 0, phaseId: "phase-progress" },
      { operation: "implementation", runId: "progress-phase-run", state: "running", pollCount: 1, phaseId: "phase-progress" },
    ]);
    for (const name of ["rpi_start_research", "rpi_implement_phase", "rpi_review_implementation"]) {
      assert.equal(typeof extension.tools.get(name)?.renderResult, "function");
    }
    const renderResult = extension.tools.get("rpi_implement_phase")!.renderResult;
    if (typeof renderResult !== "function") throw new Error("Expected implementation renderer");
    const theme = { fg: (_color: string, text: string) => text };
    const partial = renderResult(
      { content: [{ type: "text", text: "payload" }], details: { runId: "progress-phase-run", state: "running", phaseId: "phase-progress" } },
      { expanded: false, isPartial: true }, theme, { isError: false },
    ).render(160).join("\n");
    const compact = renderResult(
      { content: [{ type: "text", text: "payload" }], details: { runId: "progress-phase-run", state: "complete", phaseId: "phase-progress" } },
      { expanded: false, isPartial: false }, theme, { isError: false },
    ).render(160).join("\n");
    const expanded = renderResult(
      { content: [{ type: "text", text: "payload" }], details: { runId: "progress-phase-run", state: "complete", phaseId: "phase-progress" } },
      { expanded: true, isPartial: false }, theme, { isError: false },
    ).render(160).join("\n");
    const error = renderResult(
      { content: [{ type: "text", text: "The implementation phase timed out after 10ms." }], details: undefined },
      { expanded: false, isPartial: false }, theme, { isError: true },
    ).render(160).join("\n");
    assert.match(partial, /running/);
    assert.doesNotMatch(compact, /payload/);
    assert.match(expanded, /payload/);
    assert.match(error, /The implementation phase timed out after 10ms/);
    assert.doesNotMatch(error, /running/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("research and review tools forward queued and running updates", async () => {
  const project = await tempProject();
  const root = join(project, ".pi", "artifacts");
  const task = await createTask(root, { slug: "nonphase-progress", title: "Non-phase progress", flow: "rpi", baseBranch: "main" });
  const branch = [{ type: "message", message: { role: "toolResult", toolName: "rpi_get_task_context", details: { taskSlug: task.slug } } }];
  const scenarios: Array<{ toolName: "rpi_start_research" | "rpi_review_implementation"; params: Record<string, unknown>; operation: "research" | "review"; runId: string }> = [
    {
      toolName: "rpi_start_research",
      params: { nodes: ["artifact-locator", "artifact-analyzer"], tasks: ["Locate artifacts", "Analyze artifacts"] },
      operation: "research",
      runId: "research-progress-run",
    },
    {
      toolName: "rpi_review_implementation",
      params: { reviewTask: "Review the implementation." },
      operation: "review",
      runId: "review-progress-run",
    },
  ];
  try {
    for (const scenario of scenarios) {
      let statusCalls = 0;
      const extension = fakeExtensionApi(branch, undefined, [], (request, reply) => {
        if (request.method === "spawn") {
          reply({ version: 1, requestId: request.requestId, success: true, data: { text: "spawn", details: { runId: scenario.runId } } });
          return;
        }
        if (request.method === "status") {
          const state = ++statusCalls === 1 ? "running" : "complete";
          reply({ version: 1, requestId: request.requestId, success: true, data: { text: state, asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: scenario.runId, state }] } } });
          return;
        }
        reply({ version: 1, requestId: request.requestId, success: true, data: { text: "interrupted" } });
      });
      const updates: Array<{ details: { operation: string; runId: string; state: string; pollCount: number; phaseId?: string } }> = [];

      await extension.tools.get(scenario.toolName)!.execute(
        "call",
        scenario.params,
        new AbortController().signal,
        (update) => { updates.push(update as typeof updates[number]); },
        extension.context(project),
      );

      assert.deepEqual(updates.map((update) => update.details), [
        { operation: scenario.operation, runId: scenario.runId, state: "queued", pollCount: 0 },
        { operation: scenario.operation, runId: scenario.runId, state: "running", pollCount: 1 },
      ]);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
