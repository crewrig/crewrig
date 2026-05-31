# syntax=docker/dockerfile:1.6
#
# CrewRig e2e image — MemPalace sidecar.
#
# One-shot admin container. The CLI containers do NOT embed MemPalace; they
# talk to the sidecar's storage indirectly via a shared bind-mount at
# /home/agent/.mempalace. The sidecar is invoked on demand for assertions
# (`mempalace status`, search queries) and teardown reporting.
#
# Pin matches the `install-mempalace` task in Taskfile.yml.
FROM crewrig/e2e-base:latest

ARG MEMPALACE_VERSION=">=3.3.3,<3.4"

USER agent
WORKDIR /home/agent/workspace

RUN set -eux; \
    pipx install "mempalace${MEMPALACE_VERSION}"; \
    mempalace --version

# Pre-bake the chroma `all-MiniLM-L6-v2` ONNX embedding model into the image
# cache (~79 MB). Without this layer, every fresh container downloads it on
# its first mempalace write, costing ~3-10 s per cold start and adding a
# network-flake risk to CI runs (see issue #160). The warm-up call below
# instantiates chroma's default embedding function and runs a single inference
# pass, which materialises the model under /home/agent/.cache/chroma/ for
# every subsequent container started from this image.
RUN /home/agent/.local/pipx/venvs/mempalace/bin/python -c "\
import chromadb.utils.embedding_functions as ef; \
fn = ef.ONNXMiniLM_L6_V2(); \
fn(['warmup'])" \
 && rm -f /home/agent/.cache/chroma/onnx_models/all-MiniLM-L6-v2/onnx.tar.gz

HEALTHCHECK --interval=30s --timeout=5s --retries=2 \
  CMD mempalace --version >/dev/null 2>&1 || exit 1

CMD ["mempalace", "--version"]
