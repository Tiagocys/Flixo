const state = {
  jobId: null,
  timer: null,
};

const els = {
  form: document.getElementById("youtube-download-form"),
  url: document.getElementById("youtube-download-url"),
  height: document.getElementById("youtube-download-height"),
  button: document.getElementById("youtube-download-button"),
  statusMeta: document.getElementById("youtube-download-status-meta"),
  statusPill: document.getElementById("youtube-download-status-pill"),
  progressBar: document.getElementById("youtube-download-progress-bar"),
  error: document.getElementById("youtube-download-error"),
  resultMeta: document.getElementById("youtube-download-result-meta"),
  result: document.getElementById("youtube-download-result"),
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || response.statusText);
  }
  return payload;
}

function normalizeJob(payload) {
  return payload?.data?.job || payload?.job || null;
}

function renderJob(job) {
  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));
  els.progressBar.style.width = `${progress}%`;
  els.statusPill.textContent = {
    running: "Baixando",
    done: "Concluído",
    failed: "Erro",
  }[job?.status] || "Parado";
  els.statusMeta.textContent =
    job?.status === "done"
      ? "Download concluído."
      : job?.status === "failed"
        ? "O download falhou."
        : "Baixando e preparando o vídeo.";

  if (job?.error) {
    els.error.hidden = false;
    els.error.textContent = job.error;
  } else {
    els.error.hidden = true;
    els.error.textContent = "";
  }

  if (job?.video_url) {
    els.resultMeta.textContent = "Vídeo pronto para abrir ou usar nos seus projetos.";
    els.result.innerHTML = `
      <article class="clipper-output-card downloader-result-card">
        <div class="clipper-output-copy">
          <div class="output-heading">
            <span>Vídeo pronto</span>
            <strong>${escapeHtml(job.title || "Vídeo baixado")}</strong>
          </div>
          <dl class="output-metadata">
            <div>
              <dt>Qualidade máxima</dt>
              <dd>${escapeHtml(job.max_height || 720)}p</dd>
            </div>
          </dl>
          <div class="output-actions">
            <a class="secondary-button" href="${escapeHtml(job.video_url)}" target="_blank" rel="noreferrer">Assistir vídeo</a>
            <a class="secondary-button" href="${escapeHtml(job.video_url)}" download>Baixar arquivo</a>
          </div>
        </div>
      </article>
    `;
  }
}

async function refreshJob() {
  if (!state.jobId) return;
  const payload = await fetch(`/api/downloads/youtube/${encodeURIComponent(state.jobId)}`).then(readJson);
  const job = normalizeJob(payload);
  renderJob(job);
  if (["done", "failed"].includes(job?.status)) {
    clearTimeout(state.timer);
    state.timer = null;
    els.button.disabled = false;
    els.button.textContent = "Baixar vídeo";
    return;
  }
  state.timer = setTimeout(refreshJob, 3000);
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearTimeout(state.timer);
  els.button.disabled = true;
  els.button.textContent = "Baixando...";
  els.resultMeta.textContent = "Aguardando conclusão do download.";
  els.result.innerHTML = '<div class="empty-state">Processando download...</div>';
  try {
    const payload = await fetch("/api/downloads/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: els.url.value.trim(),
        max_height: Number(els.height.value || 720),
      }),
    }).then(readJson);
    const job = normalizeJob(payload);
    state.jobId = job.id;
    renderJob(job);
    state.timer = setTimeout(refreshJob, 2500);
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    els.button.disabled = false;
    els.button.textContent = "Baixar vídeo";
  }
});
