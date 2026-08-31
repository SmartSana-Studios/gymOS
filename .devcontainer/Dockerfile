FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

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
    && /home/vscode/.local/bin/claude --version

ENV PATH="/home/vscode/.local/bin:${PATH}"

USER root