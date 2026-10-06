---
title: 'Install Codex in the development container image'
type: 'chore'
created: '2026-10-06'
status: 'done'
route: 'one-shot'
---

# Install Codex in the development container image

## Intent

**Problem:** Installing Codex in postCreateCommand leaves the CLI unavailable when container creation setup has not completed.

**Approach:** Resolve the native Codex executable in a Node 22 build stage, copy it into the final image, and verify it as vscode alongside Claude. Keep the existing Node feature for project tooling and the named Codex configuration volume for settings and authentication. Container creation verifies Codex without reinstalling it.

## Suggested Review Order

1. [Image installation](../../.devcontainer/Dockerfile) — build-stage installation and final-user verification.
2. [Container lifecycle](../../.devcontainer/devcontainer.json) — verify the image-provided CLI and preserve the configuration volume.
