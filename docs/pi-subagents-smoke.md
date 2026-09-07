# Installed `pi-subagents` smoke test

Use this procedure to verify the installed-runtime boundary with Pi 0.84.4+ and `pi-subagents` installed. Prepare three disposable approved sources: a one-file phase that succeeds, a short-timeout phase, and a long-running phase that can be cancelled. A plan or outline heading must be `## Phase N: title` and its caller `phaseId` must be `Phase N: title`; an approved oneshot ticket uses `implementation`.

## Session safety

Read the full Tuistory help and upstream README before the first terminal action. List existing sessions, choose an unused session name, and never reuse or close a session owned by another user.

```sh
tuistory --help
curl -s https://raw.githubusercontent.com/remorses/tuistory/refs/heads/main/README.md
tuistory sessions --json
```

The commands below use `pi-rpi-subagents-smoke`. Replace it consistently if that name already exists. Do not use blind sleeps. Take `snapshot --trim` after every `type`, `press`, or other terminal action, and use bounded reactive waits.

## Start Pi

```sh
tuistory -s pi-rpi-subagents-smoke --cols 160 --rows 48 --cwd "$PWD" -- pi
tuistory -s pi-rpi-subagents-smoke wait-idle --timeout 15000
tuistory -s pi-rpi-subagents-smoke snapshot --trim
```

## Successful run

```sh
tuistory -s pi-rpi-subagents-smoke type "Run the prepared disposable RPI implementation phase and report its run ID."
tuistory -s pi-rpi-subagents-smoke snapshot --trim
tuistory -s pi-rpi-subagents-smoke press enter
tuistory -s pi-rpi-subagents-smoke snapshot --trim
tuistory -s pi-rpi-subagents-smoke wait "/implementation phase .* running/i" --timeout 30000
tuistory -s pi-rpi-subagents-smoke snapshot --trim
tuistory -s pi-rpi-subagents-smoke wait "/implementation phase .* (complete|completed|failed|partial|timed out)/i" --timeout 960000
tuistory -s pi-rpi-subagents-smoke snapshot --trim
```

Verify that the child received the exact authoritative artifact path and canonical phase ID, appears as a direct single run rather than a workflow or mission, and reports `currentTool`, `turnCount`, and `toolCount` when available. Record the run ID and terminal state. Confirm successful output includes implementation evidence and that the authoritative plan, outline, or ticket remains byte-for-byte unchanged.

## Timeout cleanup

```sh
tuistory -s pi-rpi-subagents-smoke type "Run the prepared short-timeout implementation fixture and report its run ID."
tuistory -s pi-rpi-subagents-smoke snapshot --trim
tuistory -s pi-rpi-subagents-smoke press enter
tuistory -s pi-rpi-subagents-smoke snapshot --trim
tuistory -s pi-rpi-subagents-smoke wait "/implementation phase .* (timed out|stopped)/i" --timeout 30000
tuistory -s pi-rpi-subagents-smoke snapshot --trim
```

Record the run ID and terminal timeout/stopped state. Inspect installed `pi-subagents` status and verify the owned child is terminal and no live or orphan run remains. Confirm the source artifact is still unchanged.

## Cancellation recovery

Launch the long-running fixture, wait until it is running, then send Pi's displayed interrupt key (Escape in Pi 0.84.4).

```sh
tuistory -s pi-rpi-subagents-smoke type "Run the prepared cancellation implementation fixture and report its run ID."
tuistory -s pi-rpi-subagents-smoke snapshot --trim
tuistory -s pi-rpi-subagents-smoke press enter
tuistory -s pi-rpi-subagents-smoke snapshot --trim
tuistory -s pi-rpi-subagents-smoke wait "/implementation phase .* running/i" --timeout 30000
tuistory -s pi-rpi-subagents-smoke snapshot --trim
tuistory -s pi-rpi-subagents-smoke press esc
tuistory -s pi-rpi-subagents-smoke snapshot --trim
tuistory -s pi-rpi-subagents-smoke wait "/paused|resumable|cancellation/i" --timeout 30000
tuistory -s pi-rpi-subagents-smoke snapshot --trim
```

Record the run ID and state. Verify cancellation leaves the run paused/resumable rather than falsely complete, creates no orphan child, and does not mutate the authoritative artifact.

## Preserve evidence and teardown

```sh
tuistory read -s pi-rpi-subagents-smoke --all
tuistory -s pi-rpi-subagents-smoke snapshot --trim
```

Preserve the session name, exact run IDs and states, direct-run status, observed activity fields, artifact-integrity result, timeout cleanup/orphan check, and cancellation result. Close only the dedicated session you created, and only after capturing evidence:

```sh
tuistory -s pi-rpi-subagents-smoke close
```

If you did not create that session, leave it running.
