const state = {
  jobId: null,
  timer: null,
  hasExistingClip: false,
  selectedAudio: null,
  audioPreviewUrl: "",
  selectedImages: [],
  imagePreviewUrls: [],
};

const els = {
  form: document.getElementById("image-clip-form"),
  audio: document.getElementById("image-clip-audio"),
  audioPicker: document.getElementById("image-clip-audio-picker"),
  audioPreview: document.getElementById("image-clip-audio-preview"),
  images: document.getElementById("image-clip-images"),
  imagePicker: document.getElementById("image-clip-image-picker"),
  imageCount: document.getElementById("image-clip-image-count"),
  imagePreview: document.getElementById("image-clip-image-preview"),
  clearImages: document.getElementById("image-clip-clear-images"),
  transitionOptions: document.querySelector(".image-clip-transition-options"),
  aspect: document.getElementById("image-clip-aspect"),
  transition: document.getElementById("image-clip-transition"),
  submit: document.getElementById("image-clip-submit"),
  statusMeta: document.getElementById("image-clip-status-meta"),
  statusPill: document.getElementById("image-clip-status-pill"),
  progressBar: document.getElementById("image-clip-progress-bar"),
  error: document.getElementById("image-clip-error"),
  outputPanel: document.getElementById("image-clip-output-panel"),
  resultMeta: document.getElementById("image-clip-result-meta"),
  result: document.getElementById("image-clip-result"),
  confirmModal: document.getElementById("image-clip-confirm-modal"),
  confirmTitle: document.getElementById("image-clip-confirm-title"),
  confirmMessage: document.getElementById("image-clip-confirm-message"),
  confirmAccept: document.querySelector("[data-image-clip-confirm-accept]"),
  confirmCancelButtons: document.querySelectorAll("[data-image-clip-confirm-cancel]"),
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
    const error = new Error(payload?.message || payload?.error || response.statusText);
    error.status = response.status;
    error.data = payload?.data || null;
    throw error;
  }
  return payload;
}

function normalizeJob(payload) {
  return payload?.data?.job || payload?.job || null;
}

function statusLabel(job) {
  const status = String(job?.status || "");
  if (status === "done") return "Concluído";
  if (status === "failed") return "Erro";
  if (status === "running") return "Renderizando";
  if (status === "queued") return "Na fila";
  return "Parado";
}

function statusMessage(job) {
  const step = String(job?.current_step || "");
  if (job?.status === "done") return "Clipe renderizado.";
  if (job?.status === "failed") return "Não foi possível renderizar o clipe.";
  if (step === "rendering") return "Montando as imagens com o áudio.";
  if (step === "preparing") return "Preparando os arquivos enviados.";
  if (job?.status === "queued") return "Projeto recebido.";
  return "Nenhum clipe iniciado.";
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return "0s";
  if (value < 60) return `${value.toFixed(1)}s`;
  const minutes = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function revokeImagePreviewUrls() {
  state.imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.imagePreviewUrls = [];
}

function revokeAudioPreviewUrl() {
  if (state.audioPreviewUrl) URL.revokeObjectURL(state.audioPreviewUrl);
  state.audioPreviewUrl = "";
}

function renderSelectedAudio() {
  if (!els.audioPreview) return;
  revokeAudioPreviewUrl();
  const audio = state.selectedAudio;
  if (!audio) {
    els.audioPreview.innerHTML = '<div class="image-clip-empty-preview">Seu áudio aparecerá aqui.</div>';
    return;
  }
  const previewUrl = URL.createObjectURL(audio);
  state.audioPreviewUrl = previewUrl;
  els.audioPreview.innerHTML = `
    <article class="image-clip-audio-card">
      <div class="image-clip-audio-thumb" aria-hidden="true">♪</div>
      <div>
        <strong>${escapeHtml(audio.name)}</strong>
        <span>${escapeHtml(formatFileSize(audio.size))}</span>
        <audio src="${escapeHtml(previewUrl)}" controls preload="metadata"></audio>
      </div>
      <button type="button" data-remove-audio aria-label="Remover áudio">Remover</button>
    </article>
  `;
}

function setSelectedAudio(file) {
  state.selectedAudio = file || null;
  renderSelectedAudio();
}

function setSelectedAspect(aspect) {
  const value = ["vertical", "square", "landscape"].includes(aspect) ? aspect : "vertical";
  if (els.aspect) els.aspect.value = value;
  if (els.transitionOptions) els.transitionOptions.dataset.transitionAspect = value;
}

function syncImageInputFiles() {
  if (!els.images || typeof DataTransfer === "undefined") return;
  const transfer = new DataTransfer();
  state.selectedImages.forEach((file) => transfer.items.add(file));
  els.images.files = transfer.files;
}

function renderSelectedImages() {
  if (!els.imagePreview || !els.imageCount || !els.clearImages) return;
  revokeImagePreviewUrls();
  const total = state.selectedImages.length;
  els.imageCount.textContent = total
    ? `${total} imagem${total === 1 ? "" : "s"} selecionada${total === 1 ? "" : "s"}.`
    : "Nenhuma imagem selecionada.";
  els.clearImages.hidden = total === 0;
  if (!total) {
    els.imagePreview.innerHTML = '<div class="image-clip-empty-preview">Suas imagens aparecerão aqui.</div>';
    return;
  }
  els.imagePreview.innerHTML = state.selectedImages
    .map((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      state.imagePreviewUrls.push(previewUrl);
      return `
        <article class="image-clip-image-card">
          <img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(file.name)}" loading="lazy" />
          <div>
            <strong>${escapeHtml(file.name)}</strong>
            <span>${escapeHtml(formatFileSize(file.size))}</span>
          </div>
          <button type="button" data-remove-image="${index}" aria-label="Remover ${escapeHtml(file.name)}">Remover</button>
        </article>
      `;
    })
    .join("");
}

function setImageSelection(files) {
  state.selectedImages = files.slice(0, 20);
  syncImageInputFiles();
  renderSelectedImages();
}

function addSelectedImages(files) {
  const images = files.filter((file) => String(file?.type || "").startsWith("image/"));
  if (!images.length) return;
  const nextImages = [...state.selectedImages, ...images];
  setImageSelection(nextImages);
  if (nextImages.length > 20) {
    els.error.hidden = false;
    els.error.textContent = "Você pode selecionar no máximo 20 imagens por clipe.";
  } else {
    els.error.hidden = true;
    els.error.textContent = "";
  }
}

function isProcessingJob(job) {
  return ["queued", "running"].includes(String(job?.status || ""));
}

function syncCreationFormVisibility(job) {
  if (!els.form) return;
  els.form.hidden = isProcessingJob(job);
}

function renderJob(job) {
  if (!job) return;
  state.jobId = job.id || state.jobId;
  state.hasExistingClip = Boolean(job.id && ["done", "failed"].includes(String(job.status || "")));
  syncCreationFormVisibility(job);
  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));
  els.progressBar.style.width = `${progress}%`;
  els.statusPill.textContent = statusLabel(job);
  els.statusMeta.textContent = statusMessage(job);

  if (job?.error) {
    els.error.hidden = false;
    els.error.textContent = job.error;
  } else {
    els.error.hidden = true;
    els.error.textContent = "";
  }

  if (job?.video_url) {
    els.outputPanel.hidden = false;
    els.resultMeta.textContent = `${formatDuration(job.duration)} renderizados.`;
    els.result.innerHTML = `
      <article class="clipper-output-card image-clip-result-card">
        <div class="clipper-output-preview is-playing image-clip-output-preview">
          <video src="${escapeHtml(job.video_url)}" controls playsinline preload="metadata"></video>
        </div>
        <div class="clipper-output-copy">
          <div class="output-heading">
            <span>Último clipe</span>
            <strong>${escapeHtml(job.title || "Clipe com imagens")}</strong>
          </div>
          <dl class="output-metadata">
            <div>
              <dt>Formato</dt>
              <dd>${escapeHtml(aspectLabel(job.aspect))}</dd>
            </div>
            <div>
              <dt>Transição</dt>
              <dd>${escapeHtml(transitionLabel(job.transition))}</dd>
            </div>
            <div>
              <dt>Duração</dt>
              <dd>${escapeHtml(formatDuration(job.duration))}</dd>
            </div>
          </dl>
          <div class="output-actions">
            <a class="secondary-button" href="${escapeHtml(job.download_url || job.video_url)}" download>Baixar vídeo</a>
          </div>
        </div>
      </article>
    `;
  } else if (job?.status === "running" || job?.status === "queued") {
    els.outputPanel.hidden = false;
    els.resultMeta.textContent = "Aguardando renderização.";
    els.result.innerHTML = '<div class="empty-state">Processando o clipe...</div>';
  }
}

function aspectLabel(aspect) {
  if (aspect === "square") return "Quadrado 1:1";
  if (aspect === "landscape") return "Paisagem 16:9";
  return "Retrato 9:16";
}

function transitionLabel(transition) {
  const labels = {
    none: "Sem transição",
    fade: "Fade",
    slideleft: "Deslizar para esquerda",
    slideright: "Deslizar para direita",
    wipeleft: "Cortina para esquerda",
    wiperight: "Cortina para direita",
  };
  return labels[transition] || labels.none;
}

async function refreshJob() {
  if (!state.jobId) return;
  const payload = await fetch(`/api/image-clip/jobs/${encodeURIComponent(state.jobId)}`).then(readJson);
  const job = normalizeJob(payload);
  renderJob(job);
  if (["done", "failed"].includes(String(job?.status || ""))) {
    clearTimeout(state.timer);
    state.timer = null;
    syncCreationFormVisibility(job);
    els.submit.disabled = false;
    els.submit.textContent = "Criar clipe";
    return;
  }
  state.timer = setTimeout(refreshJob, 2500);
}

async function loadLatestJob() {
  const payload = await fetch("/api/image-clip/jobs?limit=1").then(readJson).catch(() => null);
  const jobs = payload?.data?.jobs || payload?.jobs || [];
  const latest = Array.isArray(jobs) ? jobs[0] : null;
  if (!latest) return;
  renderJob(latest);
  if (!["done", "failed"].includes(String(latest.status || ""))) {
    state.timer = setTimeout(refreshJob, 1500);
  }
}

function confirmAction({ title, message, confirmLabel = "Confirmar", cancelLabel = "Cancelar" }) {
  if (!els.confirmModal || !els.confirmTitle || !els.confirmMessage || !els.confirmAccept) {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }

  const previouslyFocused = document.activeElement;
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmAccept.textContent = confirmLabel;
  els.confirmCancelButtons.forEach((button) => {
    button.textContent = cancelLabel;
  });
  els.confirmModal.hidden = false;
  document.body.classList.add("has-open-modal");
  els.confirmAccept.focus();

  return new Promise((resolve) => {
    let settled = false;
    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      els.confirmModal.hidden = true;
      document.body.classList.remove("has-open-modal");
      els.confirmAccept.removeEventListener("click", onAccept);
      els.confirmCancelButtons.forEach((button) => button.removeEventListener("click", onCancel));
      document.removeEventListener("keydown", onKeydown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(result);
    };
    const onAccept = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onKeydown = (event) => {
      if (event.key === "Escape") cleanup(false);
    };
    els.confirmAccept.addEventListener("click", onAccept);
    els.confirmCancelButtons.forEach((button) => button.addEventListener("click", onCancel));
    document.addEventListener("keydown", onKeydown);
  });
}

async function confirmReplacementIfNeeded() {
  if (!state.hasExistingClip) return false;
  return confirmAction({
    title: "Criar novo clipe?",
    message: "Você já tem um clipe existente. Se continuar, o novo clipe substituirá o anterior.",
    confirmLabel: "Criar novo clipe",
    cancelLabel: "Manter clipe existente",
  });
}

els.form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearTimeout(state.timer);

  const audio = state.selectedAudio;
  const images = state.selectedImages;
  if (!audio) {
    els.error.hidden = false;
    els.error.textContent = "Envie um áudio para criar o clipe.";
    return;
  }
  if (!images.length) {
    els.error.hidden = false;
    els.error.textContent = "Envie pelo menos uma imagem.";
    return;
  }
  if (images.length > 20) {
    els.error.hidden = false;
    els.error.textContent = "Envie no máximo 20 imagens por clipe.";
    return;
  }
  const replaceExisting = await confirmReplacementIfNeeded();
  if (state.hasExistingClip && !replaceExisting) {
    return;
  }

  const formData = new FormData();
  formData.set("audio", audio);
  images.forEach((image) => formData.append("images", image));
  formData.set("aspect", els.aspect.value);
  formData.set("transition", els.transition.value);
  formData.set("replace_existing", replaceExisting ? "true" : "false");

  els.submit.disabled = true;
  els.submit.textContent = "Enviando...";
  syncCreationFormVisibility({ status: "queued" });
  els.error.hidden = true;
  els.error.textContent = "";
  els.outputPanel.hidden = false;
  els.resultMeta.textContent = "Preparando arquivos.";
  els.result.innerHTML = '<div class="empty-state">Enviando e renderizando...</div>';

  try {
    let payload;
    try {
      payload = await fetch("/api/image-clip/jobs", {
        method: "POST",
        body: formData,
      }).then(readJson);
    } catch (error) {
      if (error?.status !== 409 || !error?.data?.requires_replacement_confirmation) {
        throw error;
      }
      const confirmed = await confirmAction({
        title: "Substituir clipe existente?",
        message: "Para criar este novo clipe, você precisa confirmar a substituição do clipe existente.",
        confirmLabel: "Substituir e continuar",
        cancelLabel: "Cancelar",
      });
      if (!confirmed) {
        els.submit.disabled = false;
        els.submit.textContent = "Criar clipe";
        els.resultMeta.textContent = state.hasExistingClip ? "O último clipe permanece disponível." : "O vídeo aparecerá aqui.";
        return;
      }
      formData.set("replace_existing", "true");
      payload = await fetch("/api/image-clip/jobs", {
        method: "POST",
        body: formData,
      }).then(readJson);
    }
    const job = normalizeJob(payload);
    state.jobId = job.id;
    state.hasExistingClip = false;
    renderJob(job);
    state.timer = setTimeout(refreshJob, 1500);
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    syncCreationFormVisibility({ status: "failed" });
    els.submit.disabled = false;
    els.submit.textContent = "Criar clipe";
  }
});

els.imagePicker?.addEventListener("click", () => {
  if (els.images) els.images.value = "";
  els.images?.click();
});

els.audioPicker?.addEventListener("click", () => {
  if (els.audio) els.audio.value = "";
  els.audio?.click();
});

els.audio?.addEventListener("change", () => {
  const audio = els.audio.files?.[0] || null;
  if (!audio) return;
  if (!String(audio.type || "").startsWith("audio/")) {
    els.error.hidden = false;
    els.error.textContent = "Selecione um arquivo de áudio válido.";
    return;
  }
  setSelectedAudio(audio);
  els.error.hidden = true;
  els.error.textContent = "";
});

els.audioPreview?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-audio]");
  if (!button) return;
  setSelectedAudio(null);
  if (els.audio) els.audio.value = "";
});

els.images?.addEventListener("change", () => {
  addSelectedImages([...(els.images.files || [])]);
});

els.clearImages?.addEventListener("click", () => {
  setImageSelection([]);
  els.error.hidden = true;
  els.error.textContent = "";
});

els.imagePreview?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-image]");
  if (!button) return;
  const index = Number(button.dataset.removeImage);
  if (!Number.isInteger(index)) return;
  const nextImages = state.selectedImages.filter((_, itemIndex) => itemIndex !== index);
  setImageSelection(nextImages);
});

document.querySelectorAll("input[name='image-clip-aspect-option']").forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) setSelectedAspect(input.value);
  });
});

document.querySelectorAll("input[name='image-clip-transition-option']").forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked && els.transition) els.transition.value = input.value;
  });
});

renderSelectedAudio();
renderSelectedImages();
setSelectedAspect(els.aspect?.value || "vertical");
loadLatestJob();
