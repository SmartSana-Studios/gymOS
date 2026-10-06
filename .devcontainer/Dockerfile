# Resolve the native Codex executable with npm before dev container features run.
FROM node:22-bookworm-slim AS codex-installer

RUN npm install --prefix /opt/codex @openai/codex \
    && codex_binary="$(find /opt/codex/node_modules -type f -name codex -perm /111)" \
    && test -n "$codex_binary" \
    && install -m 0755 "$codex_binary" /usr/local/bin/codex \
    && codex --version

FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

COPY --from=codex-installer /usr/local/bin/codex /usr/local/bin/codex

USER root

# Prepare writable directories for Claude.
RUN install -d -o vscode -g vscode -m 0755 \
    /home/vscode/.local \
    /home/vscode/.local/bin \
    /home/vscode/.local/share \
    /home/vscode/.local/share/claude \
    /home/vscode/.local/state

# Install and verify Claude during the image build.
USER vscode

RUN bash -o pipefail -c 'curl -fsSL https://claude.ai/install.sh | bash' \
    && /home/vscode/.local/bin/claude --version \
    && codex --version

ENV PATH="/home/vscode/.local/bin:${PATH}"

USER root
