import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import artifactsExtension, { gitAddBlockReason } from "../../extensions/artifacts.ts";
import { createArtifact, createTask, loadManifest, setArtifactStatus } from "../../src/engine/index.ts";

const cwd = "/tmp/rpi-stage-guard";

test("active task context is not injected when no task is selected", async () => {
  const { context, eventHandlers } = fakeExtensionApi();
  const handler = eventHandlers.get("before_agent_start");
  assert.ok(handler);

  const result = await handler({}, context("/tmp/rpi-no-active-task"));

  assert.equal(result, undefined);
});

test("active task footer reports the next stage and review count without an editor widget", async () => {
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
    const { context, eventHandlers, statuses, widgets } = fakeExtensionApi(branch);
    const handler = eventHandlers.get("before_agent_start");
    assert.ok(handler);

    await handler({}, context(project));

    assert.equal(statuses.at(-1), "parent-child-tracking · rpi · next: research · 2 in review");
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

    assert.equal(statuses.at(-1), "footer-refresh · rpi · next: research · 0 in review");
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

test("rpi-new lets the user select a task flow before delegating task creation", async () => {
  const { commands, context, selectionCalls, sentUserMessages } = fakeExtensionApi([], undefined, ["prd"]);

  await commands.get("rpi-new")!.handler("Track parent-child projects", context("/tmp/rpi-new"));

  assert.deepEqual(selectionCalls, [{ title: "Select task flow:", options: ["rpi", "prd", "oneshot", "freeform"] }]);
  assert.equal(sentUserMessages.length, 1);
  assert.match(sentUserMessages[0]!, /rpi_create_task exactly once/);
  assert.match(sentUserMessages[0]!, /unique kebab-case slug/);
  assert.match(sentUserMessages[0]!, /Track parent-child projects/);
  assert.match(sentUserMessages[0]!, /Use flow "prd"/);
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
  await createTask(root, { slug: "pick-me", title: "Pick me", flow: "rpi", baseBranch: "main" });
  const { commands, context, statuses } = fakeExtensionApi([], undefined, ["pick-me · Pick me · rpi"]);
  try {
    await commands.get("rpi-task")!.handler("", context(project));
    assert.ok(statuses.includes("pick-me · rpi · next: research · 0 in review"));
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

type Tool = {
  name: string;
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
) {
  const tools = new Map<string, Tool>();
  const commands = new Map<string, Command>();
  const notifications: string[] = [];
  const processCalls: Array<{ command: string; args: string[]; options?: { cwd?: string } }> = [];
  const statuses: string[] = [];
  const widgets: unknown[][] = [];
  const selectionCalls: Array<{ title: string; options: string[] }> = [];
  const sentUserMessages: string[] = [];
  const sentUserMessageOptions: Array<{ deliverAs?: string } | undefined> = [];
  const eventHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const pi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      eventHandlers.set(event, handler);
    },
    registerTool: (tool: unknown) => {
      const candidate = tool as Tool;
      tools.set(candidate.name, candidate);
    },
    exec: async (command: string, args: string[], options?: { cwd?: string }) => {
      processCalls.push({ command, args, ...(options ? { options } : {}) });
      return execResult;
    },
    sendUserMessage: (message: string, options?: { deliverAs?: string }) => {
      sentUserMessages.push(message);
      sentUserMessageOptions.push(options);
    },
    registerCommand: (name: string, command: unknown) => {
      commands.set(name, command as Command);
    },
  };
  artifactsExtension(pi as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI);
  const context = (cwd: string) => ({
    cwd,
    sessionManager: { getBranch: () => branch },
    ui: {
      notify: async (message: string) => { notifications.push(message); },
      editor: async (_title: string, _value: string) => undefined,
      select: async (title: string, options: string[]) => {
        selectionCalls.push({ title, options });
        return selections.shift();
      },
      setStatus: (_key: string, value: string) => { statuses.push(value); },
      setWidget: (...args: unknown[]) => { widgets.push(args); },
    },
  });
  return { tools, commands, context, eventHandlers, notifications, processCalls, sentUserMessageOptions, sentUserMessages, statuses, widgets, selectionCalls };
}

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rpi-extension-"));
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
  const { commands, context, notifications, statuses } = fakeExtensionApi();
  try {
    const ctx = context(project);
    await commands.get("rpi-task")!.handler("existing-prd", ctx);
    await commands.get("rpi-status")!.handler("", ctx);
    assert.ok(statuses.includes("existing-prd · prd · next: research · 0 in review"));
    assert.ok(notifications.some((message) => message.includes("Task existing-prd (prd)")));
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
    assert.ok(statuses.includes("persisted-prd · prd · next: research · 0 in review"));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
