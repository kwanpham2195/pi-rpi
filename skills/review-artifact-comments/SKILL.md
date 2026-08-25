---
name: review-artifact-comments
description: "Reviews and responds to feedback on task artifacts. Use when the user points to feedback on a document or asks to address review comments on an artifact."
---

# Review Artifact Comments

Process feedback on a task artifact. Feedback is local-first: it arrives in the conversation, in pasted inline `<comment>` blocks, or through the local artifact review flow. There is no remote threaded comment store, so a reply or resolution is a conversation outcome unless the user explicitly asks to update the artifact status.

## Setup and Input

1. Ensure the active task is selected with `rpi_get_task_context` or `/rpi-task`.
2. Identify the artifact under review from the user or the conversation. If it is not clear, use `rpi_list_artifacts` and ask the user to choose an artifact. Do not guess an artifact path.
3. Read the selected artifact fully with `rpi_read_artifact`.
4. Read the supplied feedback. For pasted comment blocks, use `references/comment_xml_format.md` only when its structure is unclear. Capture each comment's available identifier, quoted context, author, feedback, and replies. For conversation feedback without blocks, preserve the user's wording and do not invent a comment identifier.
5. If the user supplied neither feedback nor an artifact, ask which artifact to review, then ask for pasted feedback or feedback in the conversation.

## Review Workflow

1. If the user has not given a course of action, ask how to proceed after reading the artifact and feedback. Offer only these concise options:
   - Update the artifact for each comment.
   - Update the artifact and mark it in review.
   - Research the issue first, then reply in the conversation.
   - Take another specified action.
2. Work through one comment at a time. State the comment, the affected artifact section, and the intended disposition before changing anything.
3. For an artifact update, make the smallest change that addresses the feedback. Keep the change scoped to the affected section; do not rewrite the document or append a review log. Update the artifact in place with `rpi_update_artifact`.
4. For research, use `rpi_start_research` with installed Pi research agents when facts are needed. Return findings and any proposed artifact change in the conversation; do not claim to have posted a remote reply.
5. For an explicit request to mark the artifact in review, use `rpi_set_artifact_status` with status `in-review`. For an explicit request to approve the artifact after feedback is addressed, use `rpi_set_artifact_status` with status `approved` or `/rpi-approve` as appropriate.

## Rules and Gates

- Never resolve, delete, dismiss, or tombstone feedback without explicit instruction. A local comment block is input, not a mutable comment record.
- Never change artifact status without explicit instruction. Artifact approval is separate from agreement with one comment.
- If feedback requires a product, scope, or architecture decision, report the issue and wait for the user instead of guessing.
- Verify factual corrections against the artifact's cited sources or the code before applying them. If verification changes the proposed response, show that result before editing.
- Keep a clear disposition for every comment: updated, replied in conversation, deferred, no change, or needs a decision.

## Final Response

Report results in this format:

```markdown
## Artifact Feedback Review

**Artifact:** [local artifact path or identifier]
**Status:** [unchanged, in-review, approved, or other current status]

### Comment [identifier or number]
- **Feedback:** [concise restatement]
- **Disposition:** [updated, replied in conversation, deferred, no change, or needs a decision]
- **Change or response:** [what changed or what was reported]

### Remaining Items
- [Unresolved feedback or `None.`]
```

Do not claim that feedback was remotely replied to or resolved. State each disposition and the artifact status accurately.
