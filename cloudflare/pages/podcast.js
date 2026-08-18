const state = {
  jobId: null,
  job: null,
  timer: null,
  historyCount: 0,
  actionLocked: false,
  renderSelectionLocked: false,
  youtubeAuthorized: false,
  youtubeConfigured: false,
};

const PODCAST_LAST_JOB_KEY = "flixo.podcast.lastJobId";
const STALE_INTERRUPTED_MESSAGE = "Processo interrompido antes de concluir. Inicie uma nova analise para este video.";

const els = {
  form: document.getElementById("podcast-form"),
  url: document.getElementById("podcast-url"),
  file: document.getElementById("podcast-file"),
  submit: document.getElementById("podcast-submit-button"),
  statusMeta: document.getElementById("podcast-status-meta"),
  statusPill: document.getElementById("podcast-status-pill"),
  cancelButton: document.getElementById("podcast-cancel-button"),
  progressBar: document.getElementById("podcast-progress-bar"),
  stageProgress: document.getElementById("podcast-stage-progress"),
  error: document.getElementById("podcast-error"),
  candidatesMeta: document.getElementById("podcast-candidates-meta"),
  candidates: document.getElementById("podcast-candidates"),
  selectAllCandidates: document.getElementById("podcast-select-all-candidates"),
  renderButton: document.getElementById("podcast-render-button"),
  outputsMeta: document.getElementById("podcast-outputs-meta"),
  outputs: document.getElementById("podcast-outputs"),
  youtubeStatusMeta: document.getElementById("podcast-youtube-status-meta"),
  youtubeConnectButton: document.getElementById("podcast-youtube-connect-button"),
  youtubeUploadAllButton: document.getElementById("podcast-youtube-upload-all-button"),
  downloadThumbnailsButton: document.getElementById("podcast-download-thumbnails-button"),
  youtubePrivacy: document.getElementById("podcast-youtube-privacy"),
  youtubeVideoLanguage: document.getElementById("podcast-youtube-video-language"),
  youtubeCaptionLanguage: document.getElementById("podcast-youtube-caption-language"),
  removeSilence: document.getElementById("podcast-remove-silence"),
  artificialCuts: document.getElementById("podcast-artificial-cuts"),
  burnSubtitles: document.getElementById("podcast-burn-subtitles"),
  candidatesPanel: document.querySelector(".clipper-candidates-panel"),
  outputsPanel: document.querySelector(".clipper-outputs-panel"),
  historyPanel: document.querySelector(".clipper-history-panel"),
  historyMeta: document.getElementById("podcast-history-meta"),
  history: document.getElementById("podcast-history"),
};

const STAGE_ORDER = ["ingesting", "transcribing", "analyzing", "ready", "rendering"];

const STAGE_MESSAGES = {
  queued: "Projeto recebido. Vamos preparar o vídeo para análise.",
  ingesting: "Preparando o vídeo e extraindo informações básicas.",
  transcribing: "Transcrevendo as falas. Esta etapa varia conforme o tamanho do vídeo.",
  analyzing: "A IA está entendendo o contexto e procurando os melhores momentos.",
  ready: "Cortes sugeridos prontos. Selecione os trechos que deseja transformar em shorts.",
  rendering: "Renderizando os shorts selecionados com cortes, câmera e legenda.",
  done: "Shorts editáveis prontos.",
};

const COVER_TEMPLATE_OPTIONS = [
  ["classic", "Clássico"],
  ["impact", "Impacto"],
  ["clean", "Clean"],
  ["alert", "Alerta"],
  ["minimal", "Minimalista"],
];

const COVER_TEXT_POSITION_OPTIONS = [
  ["top", "Topo"],
  ["middle", "Meio"],
  ["bottom", "Embaixo"],
];

function hasActiveProject(job) {
  if (!job) return false;
  if (isInterruptedJob(job)) return false;
  return ["queued", "running", "ready", "rendering", "done"].includes(String(job.status || ""));
}

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
    throw error;
  }
  return payload;
}

function normalizeJob(payload) {
  return payload?.data?.job || payload?.job || null;
}

function statusLabel(status) {
  return {
    queued: "Na fila",
    running: "Processando",
    ready: "Pronto para seleção",
    rendering: "Processando",
    done: "Concluído",
    failed: "Erro",
    cancelled: "Interrompido",
  }[status] || status;
}

function jobStatusLabel(job) {
  if (isInterruptedJob(job)) {
    return "Interrompido";
  }
  return statusLabel(job?.status || "queued");
}

function isInterruptedJob(job) {
  return job?.status === "cancelled" || (job?.status === "failed" && job?.error === STALE_INTERRUPTED_MESSAGE);
}

function statusMessage(job) {
  if (["queued", "running", "rendering"].includes(job?.status)) {
    return (
      STAGE_MESSAGES[normalizedStage(job)] ||
      "A IA está processando o vídeo. O tempo varia porque priorizamos a qualidade dos cortes."
    );
  }
  if (job?.status === "ready") {
    return STAGE_MESSAGES.ready;
  }
  if (job?.status === "done") {
    return STAGE_MESSAGES.done;
  }
  if (isInterruptedJob(job)) {
    return "Processo interrompido. Você pode iniciar um novo teste.";
  }
  if (job?.status === "failed") {
    return "Não foi possível concluir este projeto.";
  }
  return "Nenhuma análise iniciada.";
}

function normalizedStage(job) {
  if (!job) return "";
  if (job.status === "done") return "rendering";
  if (job.status === "ready") return "ready";
  if (job.status === "rendering") return "rendering";
  const step = String(job.current_step || "").toLowerCase();
  if (STAGE_ORDER.includes(step)) return step;
  if (job.status === "queued") return "queued";
  return "ingesting";
}

function stageProgressPercent(job) {
  const stage = normalizedStage(job);
  if (!stage || stage === "queued") return 0;
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0) return 0;
  return Math.round(((index + 1) / STAGE_ORDER.length) * 100);
}

function updateStageProgress(job) {
  if (!els.stageProgress) return;
  const stage = normalizedStage(job);
  const activeIndex = STAGE_ORDER.indexOf(stage);
  const isComplete = job?.status === "done";
  const fillPercent =
    activeIndex >= 0 && STAGE_ORDER.length > 1
      ? Math.round((activeIndex / (STAGE_ORDER.length - 1)) * 100)
      : 0;
  els.stageProgress.dataset.currentStage = stage || "idle";
  els.stageProgress.style.setProperty("--stage-fill", `${fillPercent}%`);
  els.stageProgress.querySelectorAll("[data-stage]").forEach((item) => {
    const index = STAGE_ORDER.indexOf(item.dataset.stage || "");
    const isDone = activeIndex >= 0 && (index < activeIndex || (isComplete && index === activeIndex));
    const isActive = activeIndex >= 0 && !isComplete && index === activeIndex;
    item.classList.toggle("is-done", isDone);
    item.classList.toggle("is-active", isActive);
  });
}

function syncProjectPanels(job = state.job) {
  const candidates = Array.isArray(job?.candidates) ? job.candidates : [];
  const outputs = Array.isArray(job?.outputs) ? job.outputs : [];
  const hasOutputs = outputs.length > 0;
  const hasCandidates = !hasOutputs && (candidates.length > 0 || job?.status === "ready");
  const isComplete = job?.status === "done";
  const hasHistory = state.historyCount > 0;

  if (els.form) els.form.hidden = hasActiveProject(job);
  if (els.candidatesPanel) els.candidatesPanel.hidden = !hasCandidates;
  if (els.outputsPanel) els.outputsPanel.hidden = !hasOutputs;
  if (els.historyPanel) els.historyPanel.hidden = !(hasHistory || hasOutputs || isComplete);
}

function setProgress(job) {
  syncProjectPanels(job);
  updateStageProgress(job);
  const progress = stageProgressPercent(job);
  if (els.progressBar) {
    els.progressBar.style.width = `${progress}%`;
  }
  els.statusPill.textContent = jobStatusLabel(job);
  els.statusMeta.textContent = statusMessage(job);
  if (els.cancelButton) {
    const canCancel = state.renderSelectionLocked || ["queued", "running", "rendering"].includes(job?.status);
    const canCreateNew = job?.status === "done";
    els.cancelButton.hidden = !canCancel && !canCreateNew;
    els.cancelButton.disabled = false;
    els.cancelButton.dataset.statusAction = canCreateNew ? "new-project" : "cancel";
    els.cancelButton.textContent = canCreateNew ? "Criar novo projeto" : "Interromper processo";
    els.cancelButton.classList.toggle("danger-button", !canCreateNew);
  }
  if (job?.error && !isInterruptedJob(job)) {
    els.error.hidden = false;
    els.error.textContent = job.error;
  } else {
    els.error.hidden = true;
    els.error.textContent = "";
  }
}

function resetClipperForNewProject(message = "Pronto para criar um novo projeto.") {
  clearTimeout(state.timer);
  state.timer = null;
  state.jobId = null;
  state.job = null;
  state.renderSelectionLocked = false;
  state.actionLocked = false;
  localStorage.removeItem(PODCAST_LAST_JOB_KEY);
  renderCandidates(null);
  renderOutputs(null);
  syncProjectPanels(null);
  updateStageProgress(null);
  if (els.progressBar) els.progressBar.style.width = "0%";
  if (els.statusPill) els.statusPill.textContent = "Pronto";
  if (els.statusMeta) els.statusMeta.textContent = message;
  if (els.cancelButton) {
    els.cancelButton.hidden = true;
    els.cancelButton.dataset.statusAction = "cancel";
    els.cancelButton.classList.add("danger-button");
    els.cancelButton.textContent = "Interromper processo";
  }
}

function actionLockControls() {
  const selectors = [
    ".clipper-outputs-panel button",
    ".clipper-outputs-panel input",
    ".clipper-outputs-panel textarea",
    ".clipper-outputs-panel select",
    ".clipper-history-panel button",
  ];
  return [...document.querySelectorAll(selectors.join(","))];
}

function actionLockLinks() {
  return [...document.querySelectorAll(".clipper-outputs-panel a.secondary-button")];
}

function setActionLocked(locked) {
  state.actionLocked = locked;
  for (const control of actionLockControls()) {
    if (locked) {
      if (!control.dataset.actionLockDisabled) {
        control.dataset.actionLockDisabled = control.disabled ? "true" : "false";
      }
      control.disabled = true;
      continue;
    }

    const wasDisabled = control.dataset.actionLockDisabled === "true";
    delete control.dataset.actionLockDisabled;
    control.disabled = wasDisabled;
  }
  for (const link of actionLockLinks()) {
    link.classList.toggle("is-disabled", locked);
    link.setAttribute("aria-disabled", locked ? "true" : "false");
    link.tabIndex = locked ? -1 : 0;
  }
  if (!locked) {
    syncYoutubeActionState();
  }
}

function syncActionLockControls() {
  if (state.actionLocked) setActionLocked(true);
}

function renderCandidates(job) {
  const candidates = Array.isArray(job?.candidates) ? job.candidates : [];
  if (!candidates.length) {
    if (job?.status === "ready") {
      els.candidatesMeta.textContent = "Nenhum corte narrativo foi encontrado.";
      els.candidates.innerHTML =
        '<div class="empty-state">Tente outro trecho ou um vídeo com conversas mais marcadas.</div>';
    } else {
      els.candidatesMeta.textContent = "Aguardando transcrição e análise.";
      els.candidates.innerHTML = '<div class="empty-state">Os candidatos aparecerão aqui.</div>';
    }
    els.renderButton.disabled = true;
    syncSelectAllCandidates(job);
    return;
  }

  els.candidatesMeta.textContent = `${candidates.length} cortes sugeridos. Selecione os melhores.`;
  const selectionLocked = isCandidateSelectionLocked(job);
  els.candidates.innerHTML = candidates
    .map((candidate, index) => {
      const score = candidate?.scores?.overall ?? 0;
      return `
        <label class="clipper-candidate-card${selectionLocked ? " is-disabled" : ""}">
          <input type="checkbox" value="${escapeHtml(candidate.id)}"${selectionLocked ? " disabled" : ""} />
          <div class="clipper-candidate-body">
            <div class="clipper-candidate-head">
              <strong>${escapeHtml(candidate.title || `Corte ${index + 1}`)}</strong>
              <span class="score-pill">${escapeHtml(score)}%</span>
            </div>
            <div class="clipper-time">${formatTime(candidate.start)} → ${formatTime(candidate.end)} · ${Math.round(candidate.duration || 0)}s</div>
            <p><b>Hook:</b> ${escapeHtml(candidate.hook || "Sem hook identificado.")}</p>
            <p>${escapeHtml(candidate.summary || candidate.reason || "")}</p>
          </div>
        </label>
      `;
    })
    .join("");
  syncCandidateSelectionState(job);
}

function selectedCandidateIds() {
  return [...els.candidates.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function setCandidateSelectionDisabled(disabled) {
  els.candidates.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.disabled = disabled;
  });
  if (els.selectAllCandidates) {
    els.selectAllCandidates.disabled = disabled;
  }
  els.candidates.querySelectorAll(".clipper-candidate-card").forEach((card) => {
    card.classList.toggle("is-disabled", disabled);
  });
}

function isCandidateSelectionLocked(job = state.job) {
  if (state.renderSelectionLocked) return true;
  return ["rendering", "done"].includes(String(job?.status || ""));
}

function updateRenderSelectionLock(job = state.job) {
  const status = String(job?.status || "");
  if (["rendering", "done"].includes(status)) {
    state.renderSelectionLocked = true;
    return;
  }
  if (["failed", "cancelled"].includes(status)) {
    state.renderSelectionLocked = false;
  }
}

function syncCandidateSelectionState(job = state.job) {
  const canRender = job?.status === "ready" && !isCandidateSelectionLocked(job);
  const selectedCount = selectedCandidateIds().length;
  if (!els.renderButton) return;
  els.renderButton.disabled = !canRender || selectedCount === 0;
  syncSelectAllCandidates(job);
  if (isCandidateSelectionLocked(job)) {
    els.renderButton.textContent = "Renderizando...";
    return;
  }
  els.renderButton.textContent =
    selectedCount > 0 ? `Renderizar ${selectedCount} selecionado(s)` : "Selecione ao menos um corte";
}

function syncSelectAllCandidates(job = state.job) {
  if (!els.selectAllCandidates) return;
  const checkboxes = [...els.candidates.querySelectorAll("input[type='checkbox']")];
  const enabled = job?.status === "ready" && !isCandidateSelectionLocked(job) && checkboxes.length > 0;
  const selectedCount = checkboxes.filter((input) => input.checked).length;
  els.selectAllCandidates.disabled = !enabled;
  els.selectAllCandidates.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
  els.selectAllCandidates.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
}

function optionsHtml(options, selectedValue) {
  return options
    .map(([value, label]) => {
      const selected = String(value) === String(selectedValue) ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function coverPreviewText(value) {
  return String(value || "CAPA DO SHORT").trim().toUpperCase();
}

function coverOptionsHtml(output) {
  const options = Array.isArray(output?.cover_options) ? output.cover_options : [];
  if (!options.length) {
    return "";
  }
  const coverTitle = coverPreviewText(output?.cover_title || output?.title);
  const coverTemplate = output?.cover_template || "impact";
  const coverTextPosition = output?.cover_text_position || "bottom";
  const hasFramePreviews = options.some((option) => option?.frame_url || option?.frameUrl || option?.frame);

  const cards = options
    .map((option, index) => {
      const label = option.label || String.fromCharCode(65 + index);
      const url = cacheBustedUrl(option.url || option.cover_url || "", output?.cover_updated_at || output?.metadata_edited_at);
      const rawFrameUrl = option.frame_url || option.frameUrl || option.frame || "";
      const frameUrl = cacheBustedUrl(rawFrameUrl, output?.cover_updated_at || output?.metadata_edited_at);
      const canPreviewOverlay = Boolean(rawFrameUrl);
      const selected = index === 0 ? "true" : "false";
      if (!frameUrl && !url) {
        return "";
      }
      return `
        <div
          class="cover-option-card"
          data-cover-option="${escapeHtml(output.id)}"
          data-cover-url="${escapeHtml(url)}"
          data-cover-frame-url="${escapeHtml(frameUrl)}"
          data-cover-has-frame="${canPreviewOverlay ? "true" : "false"}"
          data-cover-key="${escapeHtml(option.key || option.cover_key || "")}"
          data-cover-label="Opção ${escapeHtml(label)}"
          data-selected="${selected}"
          role="button"
          tabindex="0"
          aria-pressed="${selected}"
        >
          <div class="cover-frame-preview">
            <img src="${escapeHtml(frameUrl || url)}" alt="Frame sugerido ${escapeHtml(label)}" loading="lazy" />
            ${
              canPreviewOverlay
                ? `<div class="cover-frame-text" aria-hidden="true"><strong>${escapeHtml(coverTitle)}</strong></div>`
                : ""
            }
          </div>
          <div class="cover-option-footer">
            <span>${index === 0 ? "Selecionada" : `Opção ${escapeHtml(label)}`}</span>
            <button
              type="button"
              class="cover-option-download"
              data-cover-download-option="${escapeHtml(output.id)}"
              data-cover-download-url="${escapeHtml(url)}"
              data-cover-download-label="${escapeHtml(label)}"
              aria-label="Baixar miniatura ${escapeHtml(label)}"
            >
              Baixar
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  if (!cards) {
    return "";
  }

  return `
    <section
      class="cover-options"
      data-cover-preview-group="${escapeHtml(output.id)}"
      data-cover-template="${escapeHtml(coverTemplate)}"
      data-cover-text-position="${escapeHtml(coverTextPosition)}"
    >
      <div class="cover-options-head">
        <strong>Capas sugeridas</strong>
        <span>${hasFramePreviews ? "Preview instantâneo nos frames do vídeo" : "Capa renderizada do histórico"}</span>
      </div>
      <div class="cover-options-grid">
        ${cards}
      </div>
    </section>
  `;
}

function coverCustomizationHtml(output, coverTemplate, coverTextPosition, hasFramePreviews) {
  return `
    <section class="cover-customization-panel">
      <div class="cover-options-head">
        <strong>Modelo da capa</strong>
        <span>${hasFramePreviews ? "Atualização instantânea" : "Salve para gerar frames limpos"}</span>
      </div>
      <div class="cover-customization-grid">
        <div class="field">
          <label for="podcast-cover-template-${escapeHtml(output.id)}">Estilo</label>
          <select
            id="podcast-cover-template-${escapeHtml(output.id)}"
            class="output-edit-input"
            data-cover-template="${escapeHtml(output.id)}"
          >
            ${optionsHtml(COVER_TEMPLATE_OPTIONS, coverTemplate)}
          </select>
        </div>
        <div class="field">
          <label for="podcast-cover-position-${escapeHtml(output.id)}">Posição do texto</label>
          <select
            id="podcast-cover-position-${escapeHtml(output.id)}"
            class="output-edit-input"
            data-cover-text-position="${escapeHtml(output.id)}"
          >
            ${optionsHtml(COVER_TEXT_POSITION_OPTIONS, coverTextPosition)}
          </select>
        </div>
      </div>
      <div class="helper">
        ${
          hasFramePreviews
            ? "Alterar modelo ou posição atualiza as miniaturas automaticamente."
            : "Ao alterar o modelo, vamos preparar previews dinâmicos para este projeto."
        }
      </div>
    </section>
  `;
}

function outputCoverUrl(output) {
  const options = Array.isArray(output?.cover_options) ? output.cover_options : [];
  const url =
    output?.cover_url ||
    options.find((option) => option?.url || option?.cover_url)?.url ||
    options.find((option) => option?.url || option?.cover_url)?.cover_url ||
    "";
  return cacheBustedUrl(url, output?.cover_updated_at || output?.metadata_edited_at);
}

function outputPreviewFrameUrl(output) {
  const options = Array.isArray(output?.cover_options) ? output.cover_options : [];
  const frames = options
    .map((option) => option?.frame_url || option?.frameUrl || option?.frame || "")
    .filter(Boolean);
  if (!frames.length) return outputCoverUrl(output);
  const seed = String(output?.id || output?.title || "0");
  const index = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % frames.length;
  return cacheBustedUrl(frames[index], output?.cover_updated_at || output?.metadata_edited_at);
}

function renderOutputs(job) {
  const outputs = Array.isArray(job?.outputs) ? job.outputs : [];
  if (!outputs.length) {
    els.outputsMeta.textContent = "Renderize cortes para ver seus shorts prontos.";
    els.outputs.innerHTML = '<div class="empty-state">Nenhum short renderizado ainda.</div>';
    els.youtubeUploadAllButton.disabled = true;
    if (els.downloadThumbnailsButton) els.downloadThumbnailsButton.disabled = true;
    return;
  }
  els.outputsMeta.textContent = `${outputs.length} short(s) pronto(s) para revisar.`;
  els.youtubeUploadAllButton.disabled = !state.youtubeAuthorized;
  if (els.downloadThumbnailsButton) els.downloadThumbnailsButton.disabled = false;
  const candidatesById = new Map((job?.candidates || []).map((candidate) => [candidate.id, candidate]));
  els.outputs.innerHTML = outputs
    .map(
      (output, index) => {
        const candidate = candidatesById.get(output.id) || {};
        const title = output.title || candidate.title || `Short ${index + 1}`;
        const description = outputDescription(output, candidate, title);
        const tags = outputTagsForDisplay(output, title, description);
        const coverTitle = output.cover_title || title;
        const coverTemplate = output.cover_template || "impact";
        const coverTextPosition = output.cover_text_position || "bottom";
        const hasFramePreviews = Array.isArray(output.cover_options)
          ? output.cover_options.some((option) => option?.frame_url || option?.frameUrl || option?.frame)
          : false;
        const camera = output?.visual_focus || {};
        const hasDynamicCamera = Array.isArray(camera.segments) && camera.segments.length > 1;
        const cameraLabel =
          hasDynamicCamera
            ? "Câmera dinâmica: zoom + 1:1"
            : camera.mode === "speaker_zoom"
            ? "Zoom/reframe no rosto falante"
            : "Quadro 1:1 centralizado";
        const videoUrl = cacheBustedUrl(output.video_url, output.subtitle_edited_at);
        const coverUrl = outputCoverUrl(output);
        const previewFrameUrl = outputPreviewFrameUrl(output);
        const burnSubtitles = output.burn_subtitles !== false;
        return `
        <article class="clipper-output-card">
          <div class="clipper-output-media">
            <div
              class="clipper-output-preview"
              data-output-preview="${escapeHtml(output.id)}"
              data-video-url="${escapeHtml(videoUrl)}"
              data-poster-url="${escapeHtml(previewFrameUrl)}"
            >
              ${
                previewFrameUrl
                  ? `<img src="${escapeHtml(previewFrameUrl)}" alt="Frame de ${escapeHtml(title)}" loading="lazy" />`
                  : `<div class="clipper-output-placeholder">Prévia do short</div>`
              }
              <button
                type="button"
                class="clipper-output-play"
                data-output-play="${escapeHtml(output.id)}"
                aria-label="Reproduzir ${escapeHtml(title)}"
              ></button>
            </div>
            <div class="clipper-output-downloads">
              <button
                type="button"
                class="secondary-button"
                data-video-download="${escapeHtml(output.id)}"
                data-video-download-url="${escapeHtml(output.video_url)}"
              >
                Baixar vídeo
              </button>
              <a class="secondary-button" href="${escapeHtml(output.subtitle_url)}" target="_blank" rel="noreferrer">
                Baixar legenda
              </a>
            </div>
          </div>
          <div class="clipper-output-copy">
            <div class="output-heading">
              <span>Short ${index + 1}</span>
              <strong>${escapeHtml(title)}</strong>
            </div>
            ${coverOptionsHtml(output)}
            ${coverCustomizationHtml(output, coverTemplate, coverTextPosition, hasFramePreviews)}
            <dl class="output-metadata">
              <div>
                <dt><label for="podcast-youtube-title-${escapeHtml(output.id)}">Título do vídeo</label></dt>
                <dd>
                  <input
                    id="podcast-youtube-title-${escapeHtml(output.id)}"
                    class="output-edit-input"
                    data-youtube-title="${escapeHtml(output.id)}"
                    data-previous-title="${escapeHtml(title)}"
                    maxlength="100"
                    value="${escapeHtml(title)}"
                  />
                </dd>
              </div>
              <div>
                <dt><label for="podcast-youtube-description-${escapeHtml(output.id)}">Descrição</label></dt>
                <dd>
                  <textarea
                    id="podcast-youtube-description-${escapeHtml(output.id)}"
                    class="output-edit-textarea"
                    data-youtube-description="${escapeHtml(output.id)}"
                    rows="4"
                  >${escapeHtml(description)}</textarea>
                </dd>
              </div>
              <div>
                <dt><label for="podcast-cover-title-${escapeHtml(output.id)}">Texto da capa</label></dt>
                <dd>
                  <input
                    id="podcast-cover-title-${escapeHtml(output.id)}"
                    class="output-edit-input"
                    data-cover-title="${escapeHtml(output.id)}"
                    data-manually-edited="${output.cover_title && output.cover_title !== title ? "true" : "false"}"
                    maxlength="80"
                    value="${escapeHtml(coverTitle)}"
                  />
                  <div class="helper">Texto curto usado nas miniaturas. Salve para gerar novas opções de capa.</div>
                </dd>
              </div>
              <div>
                <dt><label for="podcast-youtube-tags-${escapeHtml(output.id)}">Hashtags</label></dt>
                <dd>
                  <input
                    id="podcast-youtube-tags-${escapeHtml(output.id)}"
                    class="output-edit-input"
                    data-youtube-tags="${escapeHtml(output.id)}"
                    value="${escapeHtml(tags.join(" "))}"
                  />
                </dd>
              </div>
              <div>
                <dt>Resultado</dt>
                <dd>${Math.round(output.duration || 0)}s finais · ${Math.round(output.source_duration || 0)}s originais · ${escapeHtml(output.removed_silence_seconds || 0)}s de silêncio removido</dd>
              </div>
              <div>
                <dt>Câmera</dt>
                <dd>${escapeHtml(cameraLabel)} · ${escapeHtml(camera.reason || "")}</dd>
              </div>
              <div>
                <dt>Legenda</dt>
                <dd>${burnSubtitles ? "Aplicada ao vídeo + arquivo de legenda disponível" : "Vídeo sem legenda aplicada + arquivo de legenda disponível"}</dd>
              </div>
              <div>
                <dt>Resumo</dt>
                <dd>${escapeHtml(output.summary || output.reason || "")}</dd>
              </div>
              <div class="output-metadata-save">
                <dt>Alterações</dt>
                <dd>
                  <button type="button" class="secondary-button" data-metadata-save="${escapeHtml(output.id)}">
                    Salvar textos e atualizar capas
                  </button>
                </dd>
              </div>
            </dl>
            <div class="subtitle-editor" data-subtitle-panel="${escapeHtml(output.id)}" hidden>
              <label for="podcast-subtitle-${escapeHtml(output.id)}">Editar legenda</label>
              <div
                id="podcast-subtitle-${escapeHtml(output.id)}"
                class="subtitle-template"
                data-subtitle-editor="${escapeHtml(output.id)}"
              ></div>
              <div class="helper">
                Edite apenas o texto. Os tempos ficam bloqueados para evitar que a sincronização seja alterada.
              </div>
            </div>
            <div class="clip-editor" data-edit-panel="${escapeHtml(output.id)}" hidden>
              <div class="clip-editor-preview">
                <video
                  controls
                  playsinline
                  preload="none"
                  poster="${escapeHtml(coverUrl)}"
                  data-src="${escapeHtml(videoUrl)}"
                  data-edit-preview="${escapeHtml(output.id)}"
                ></video>
                <div class="clip-editor-time-panel">
                  <div>
                    <span>Tempo atual</span>
                    <strong data-preview-current="${escapeHtml(output.id)}">0.000s</strong>
                  </div>
                  <div>
                    <span>Início</span>
                    <strong data-preview-start="${escapeHtml(output.id)}">0.000s</strong>
                  </div>
                  <div>
                    <span>Fim</span>
                    <strong data-preview-end="${escapeHtml(output.id)}">${escapeHtml(formatSeconds(output.duration || 0))}</strong>
                  </div>
                  <div>
                    <span>Selecionado</span>
                    <strong data-preview-selected="${escapeHtml(output.id)}">${escapeHtml(formatSeconds(output.duration || 0))}</strong>
                  </div>
                </div>
              </div>
              <div class="clip-editor-grid">
                <div class="field">
                  <label for="podcast-edit-start-${escapeHtml(output.id)}">Início do corte</label>
                  <input
                    id="podcast-edit-start-${escapeHtml(output.id)}"
                    class="output-edit-input"
                    data-edit-start="${escapeHtml(output.id)}"
                    type="number"
                    min="0"
                    step="0.001"
                    value="0.000"
                  />
                </div>
                <div class="field">
                  <label for="podcast-edit-end-${escapeHtml(output.id)}">Fim do corte</label>
                  <input
                    id="podcast-edit-end-${escapeHtml(output.id)}"
                    class="output-edit-input"
                    data-edit-end="${escapeHtml(output.id)}"
                    type="number"
                    min="0.1"
                    step="0.001"
                    value="${escapeHtml(Number(output.duration || 0).toFixed(3))}"
                  />
                </div>
                <div class="field">
                  <label for="podcast-edit-append-${escapeHtml(output.id)}">Complementar com outro clipe</label>
                  <select id="podcast-edit-append-${escapeHtml(output.id)}" data-edit-append="${escapeHtml(output.id)}">
                    <option value="">Não complementar</option>
                    ${appendClipOptions(outputs, output.id)}
                  </select>
                </div>
                <div class="field">
                  <label for="podcast-edit-position-${escapeHtml(output.id)}">Posição do complemento</label>
                  <select id="podcast-edit-position-${escapeHtml(output.id)}" data-edit-position="${escapeHtml(output.id)}">
                    <option value="after" selected>Depois do corte</option>
                    <option value="before">Antes do corte</option>
                  </select>
                </div>
              </div>
              <div class="clip-range-timeline" data-range-timeline="${escapeHtml(output.id)}" data-duration="${escapeHtml(output.duration || 0)}">
                <div class="clip-range-scale">
                  <span>0 ms</span>
                  <span>${escapeHtml(formatMilliseconds(output.duration || 0))}</span>
                </div>
                <div class="clip-range-track" data-range-track="${escapeHtml(output.id)}">
                  <div class="clip-range-selection" data-range-selection="${escapeHtml(output.id)}" style="left: 0%; right: 0%"></div>
                  <div class="clip-range-playhead" data-range-playhead="${escapeHtml(output.id)}" style="left: 0%"></div>
                  <button
                    type="button"
                    class="clip-range-handle clip-range-handle-start"
                    data-range-handle="${escapeHtml(output.id)}"
                    data-handle-kind="start"
                    style="left: 0%"
                    aria-label="Arrastar início do corte"
                  ></button>
                  <button
                    type="button"
                    class="clip-range-handle clip-range-handle-end"
                    data-range-handle="${escapeHtml(output.id)}"
                    data-handle-kind="end"
                    style="left: 100%"
                    aria-label="Arrastar fim do corte"
                  ></button>
                </div>
                <div class="clip-range-readout">
                  <span data-range-start-label="${escapeHtml(output.id)}">Início: 0 ms</span>
                  <span data-range-duration-label="${escapeHtml(output.id)}">Selecionado: ${escapeHtml(formatMilliseconds(output.duration || 0))}</span>
                  <span data-range-end-label="${escapeHtml(output.id)}">Fim: ${escapeHtml(formatMilliseconds(output.duration || 0))}</span>
                </div>
              </div>
              <div class="helper">
                A exportação cria uma nova versão e mantém este clipe original intacto.
              </div>
            </div>
            <div class="output-actions">
              <button
                type="button"
                class="secondary-button youtube-upload-button"
                data-output-id="${escapeHtml(output.id)}"
                ${state.youtubeAuthorized ? "" : "disabled"}
              >
                Enviar ao YouTube
              </button>
              <button type="button" class="secondary-button" data-edit-toggle="${escapeHtml(output.id)}">Editar corte</button>
              <button type="button" class="secondary-button" data-edit-save="${escapeHtml(output.id)}" hidden>
                Salvar como novo clipe
              </button>
            </div>
          </div>
        </article>
      `;
      }
    )
    .join("");
  syncActionLockControls();
}

function outputDescription(output, candidate, title) {
  const description = output.public_description || output.summary || candidate.public_description || candidate.summary || "";
  if (description && !looksEditorial(description)) return description;
  const hook = output.hook || candidate.hook || "";
  if (hook && !looksEditorial(hook) && hook.length >= 24) {
    return `Neste corte, ${hook.slice(0, 1).toLowerCase()}${hook.slice(1)}`;
  }
  return `Um momento curto sobre ${String(title || "este trecho").toLowerCase()}.`;
}

function appendClipOptions(outputs, currentId) {
  return outputs
    .filter((output) => output?.id && output.id !== currentId)
    .map((output, index) => {
      const title = output.title || `Short ${index + 1}`;
      const duration = Math.round(output.duration || 0);
      return `<option value="${escapeHtml(output.id)}">${escapeHtml(title)} · ${duration}s</option>`;
    })
    .join("");
}

function looksEditorial(value) {
  const text = String(value || "").toLowerCase();
  return [
    "retém",
    "retencao",
    "retenção",
    "espectador",
    "hook",
    "identificação imediata",
    "dor emocional",
    "criador",
    "criadores",
    "criando uma identificação",
    "gera confiança",
    "gera autoridade",
    "valor percebido",
    "alto valor",
    "chamada motivacional",
    "primeiros segundos",
    "ranking",
    "algoritmo",
    "payoff",
  ].some((term) => text.includes(term));
}

function outputTags(title, description) {
  const text = normalizeTagText(`${title} ${description}`);
  const tags = [];
  const add = (...items) => {
    for (const item of items) {
      if (item && !tags.includes(item)) tags.push(item);
    }
  };

  if (/\bferrari\s*458\b/.test(text)) add("#Ferrari458", "#Ferrari", "#Supercarros", "#CarroEsportivo");
  else if (text.includes("ferrari")) add("#Ferrari", "#Supercarros");
  if (text.includes("rosso maranello")) add("#RossoMaranello");
  if (text.includes("aspirad")) add("#MotorAspirado");
  if (/\bv8\b/.test(text)) add("#V8");
  if (text.includes("rolls royce") || text.includes("rolls-royce")) add("#RollsRoyce", "#CarrosDeLuxo");
  if (text.includes("honda nsx") || /\bnsx\b/.test(text)) add("#HondaNSX", "#JDM", "#CarrosJaponeses");
  if (text.includes("nissan") || text.includes("gtr") || text.includes("skyline")) add("#NissanGTR", "#JDM");
  if (text.includes("drift")) add("#Drift", "#CarrosPreparados");
  if (text.includes("turbo")) add("#Turbo", "#CarrosPreparados");
  if (text.includes("oficina") || text.includes("mecanica")) add("#Oficina", "#MecanicaAutomotiva");
  if (text.includes("roda")) add("#Rodas");
  if (text.includes("motiv") || text.includes("crescer") || text.includes("sonho")) add("#Motivacao");
  if (text.includes("empreend")) add("#Empreendedorismo");
  if (text.includes("dinheiro") || text.includes("negocio")) add("#Negocios");
  if (text.includes("humor") || text.includes("engrac")) add("#Humor");

  if (hasAutomotiveContext(text)) add("#Carros", "#Automotivo");
  add(...keywordTags(text));
  return tags.filter((tag) => !isGenericHashtag(tag)).slice(0, 12);
}

function outputTagsForDisplay(output, title, description) {
  const saved = Array.isArray(output?.youtube_tags) ? output.youtube_tags : [];
  if (saved.length) {
    return saved
      .map((tag) => `#${String(tag || "").trim().replace(/^#/, "")}`)
      .filter((tag) => tag.length > 1 && !isGenericHashtag(tag))
      .slice(0, 12);
  }
  return outputTags(title, description);
}

function normalizeTagText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasAutomotiveContext(text) {
  return [
    "carro",
    "ferrari",
    "motor",
    "oficina",
    "roda",
    "turbo",
    "honda",
    "nissan",
    "rolls",
    "drift",
    "rally",
    "radiador",
    "cambio",
    "esportivo",
  ].some((term) => text.includes(term));
}

function keywordTags(text) {
  const known = [
    ["carro", "#Carros"],
    ["historia", "#Historia"],
    ["curiosidade", "#Curiosidades"],
    ["negocio", "#Negocios"],
    ["motivacao", "#Motivacao"],
    ["ferrari", "#Ferrari"],
    ["oficina", "#Oficina"],
    ["mecanica", "#MecanicaAutomotiva"],
    ["empreend", "#Empreendedorismo"],
    ["criador", "#CriadoresDeConteudo"],
    ["conteudo", "#CriacaoDeConteudo"],
    ["vendas", "#Vendas"],
    ["marketing", "#MarketingDigital"],
    ["dinheiro", "#Dinheiro"],
    ["invest", "#Investimentos"],
    ["familia", "#Familia"],
    ["relacionamento", "#Relacionamento"],
    ["humor", "#Humor"],
    ["comedia", "#Comedia"],
    ["cinema", "#Cinema"],
    ["filme", "#Filmes"],
    ["musica", "#Musica"],
    ["futebol", "#Futebol"],
    ["tecnologia", "#Tecnologia"],
    ["inteligencia artificial", "#InteligenciaArtificial"],
  ];
  const mapped = known.filter(([term]) => text.includes(term)).map(([, tag]) => tag);
  return [...mapped, ...keywordTagsFromText(text)];
}

function keywordTagsFromText(text) {
  const stopwords = new Set([
    "sobre",
    "para",
    "porque",
    "como",
    "esse",
    "essa",
    "isso",
    "aquele",
    "aquela",
    "muito",
    "mais",
    "menos",
    "quando",
    "onde",
    "voce",
    "eles",
    "elas",
    "dele",
    "dela",
    "nesse",
    "nessa",
    "video",
    "clip",
    "clipe",
    "corte",
    "momento",
    "trecho",
    "fala",
    "falando",
    "pessoa",
    "pessoas",
  ]);
  const words = text.match(/[a-z0-9]{4,}/g) || [];
  const counts = new Map();
  for (const word of words) {
    if (stopwords.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 6)
    .map(([word]) => `#${hashtagTitleCase(word)}`);
}

function hashtagTitleCase(value) {
  return String(value || "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("");
}

function isGenericHashtag(tag) {
  return ["#shorts", "#podcast", "#youtubeshorts", "#youtube"].includes(
    String(tag || "").toLowerCase()
  );
}

function outputYoutubeOverride(outputId) {
  const title = els.outputs.querySelector(`[data-youtube-title="${CSS.escape(outputId)}"]`)?.value?.trim() || "";
  const description =
    els.outputs.querySelector(`[data-youtube-description="${CSS.escape(outputId)}"]`)?.value?.trim() || "";
  const tagsValue = els.outputs.querySelector(`[data-youtube-tags="${CSS.escape(outputId)}"]`)?.value || "";
  return {
    title,
    description,
    tags: parseTags(tagsValue),
  };
}

function outputMetadataPayload(outputId) {
  const title = els.outputs.querySelector(`[data-youtube-title="${CSS.escape(outputId)}"]`)?.value?.trim() || "";
  const description =
    els.outputs.querySelector(`[data-youtube-description="${CSS.escape(outputId)}"]`)?.value?.trim() || "";
  const tagsValue = els.outputs.querySelector(`[data-youtube-tags="${CSS.escape(outputId)}"]`)?.value || "";
  const coverTitle = els.outputs.querySelector(`[data-cover-title="${CSS.escape(outputId)}"]`)?.value?.trim() || title;
  const coverTemplate = els.outputs.querySelector(`[data-cover-template="${CSS.escape(outputId)}"]`)?.value || "impact";
  const coverTextPosition =
    els.outputs.querySelector(`[data-cover-text-position="${CSS.escape(outputId)}"]`)?.value || "bottom";
  return {
    title,
    description,
    tags: parseTags(tagsValue),
    cover_title: coverTitle,
    cover_template: coverTemplate,
    cover_text_position: coverTextPosition,
  };
}

function outputYoutubeOverrides() {
  const overrides = {};
  for (const output of state.job?.outputs || []) {
    if (output?.id) overrides[output.id] = outputYoutubeOverride(output.id);
  }
  return overrides;
}

function parseTags(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 15);
}

function youtubeSettingsPayload() {
  const videoLanguage = els.youtubeVideoLanguage?.value || "pt-BR";
  return {
    privacy_status: els.youtubePrivacy?.value || "private",
    video_language: videoLanguage,
    audio_language: videoLanguage,
    caption_language: els.youtubeCaptionLanguage?.value || "pt-BR",
  };
}

function syncYoutubeActionState() {
  if (els.youtubeUploadAllButton) {
    els.youtubeUploadAllButton.disabled = !state.youtubeAuthorized || !(state.job?.outputs || []).length;
  }
  els.outputs?.querySelectorAll(".youtube-upload-button").forEach((button) => {
    const alreadyUploaded = button.dataset.uploaded === "true";
    button.disabled = alreadyUploaded || !state.youtubeAuthorized;
  });
}

function languageOptionHtml(language, selectedCode) {
  const code = String(language?.code || "").trim();
  const name = String(language?.name || code).trim();
  if (!code || !name) return "";
  const selected = code.toLowerCase() === selectedCode.toLowerCase() ? " selected" : "";
  return `<option value="${escapeHtml(code)}"${selected}>${escapeHtml(name)} (${escapeHtml(code)})</option>`;
}

function preferredLanguageCode(languages, selectedCode) {
  const codes = languages.map((language) => String(language?.code || "")).filter(Boolean);
  const exact = codes.find((code) => code.toLowerCase() === selectedCode.toLowerCase());
  if (exact) return exact;

  const baseCode = selectedCode.split("-")[0].toLowerCase();
  const base = codes.find((code) => code.toLowerCase() === baseCode);
  if (base) return base;

  return codes.find((code) => code.toLowerCase() === "pt") || codes[0] || selectedCode;
}

function populateLanguageSelect(select, languages, selectedCode = "pt-BR") {
  if (!select || !Array.isArray(languages) || !languages.length) return;
  const effectiveSelectedCode = preferredLanguageCode(languages, selectedCode);
  select.innerHTML = languages
    .map((language) => languageOptionHtml(language, effectiveSelectedCode))
    .filter(Boolean)
    .join("");
}

async function loadYoutubeI18nOptions() {
  if (!els.youtubeVideoLanguage && !els.youtubeCaptionLanguage) return;
  const payload = await fetch("/api/youtube/i18n-options").then(readJson);
  const languages = payload?.data?.languages || [];
  populateLanguageSelect(els.youtubeVideoLanguage, languages, els.youtubeVideoLanguage?.value || "pt-BR");
  populateLanguageSelect(els.youtubeCaptionLanguage, languages, els.youtubeCaptionLanguage?.value || "pt-BR");
}

function setYoutubeStatus(configured, authorized, channels = [], channelError = "") {
  state.youtubeConfigured = Boolean(configured);
  state.youtubeAuthorized = Boolean(authorized);
  const youtubeConnectLabel = els.youtubeConnectButton?.querySelector("span:last-child");
  if (!configured) {
    els.youtubeStatusMeta.textContent = "A publicação no YouTube ainda não está disponível nesta conta.";
    els.youtubeConnectButton.disabled = true;
    els.youtubeUploadAllButton.disabled = true;
    if (youtubeConnectLabel) youtubeConnectLabel.textContent = "YouTube indisponível";
    return;
  }
  els.youtubeConnectButton.disabled = false;
  els.youtubeUploadAllButton.disabled = !authorized || !(state.job?.outputs || []).length;
  if (authorized && channels.length) {
    const channelNames = channels.map((channel) => channel.title).filter(Boolean).join(", ");
    els.youtubeStatusMeta.textContent = `YouTube conectado: ${channelNames}. Revise título, descrição e hashtags antes de enviar.`;
  } else if (authorized && channelError) {
    els.youtubeStatusMeta.textContent =
      "YouTube conectado, mas é preciso reconectar para permitir leitura do canal autorizado.";
  } else {
    els.youtubeStatusMeta.textContent = authorized
      ? "YouTube conectado. Revise título, descrição e hashtags antes de enviar."
      : "Conecte o canal para habilitar upload dos shorts.";
  }
  if (youtubeConnectLabel) {
    youtubeConnectLabel.textContent = authorized ? "Conectar outra conta" : "Conectar YouTube";
  }
  syncActionLockControls();
}

async function refreshYoutubeStatus() {
  const payload = await fetch("/api/youtube/oauth/status").then(readJson);
  const data = payload?.data || {};
  setYoutubeStatus(data.configured, data.authorized, data.channels || [], data.channel_error || "");
  if (data.authorized) {
    loadYoutubeI18nOptions().catch(() => null);
  }
  renderOutputs(state.job);
}

async function connectYoutube() {
  const frontendUrl = `${window.location.origin}${window.location.pathname}`;
  const payload = await fetch(`/api/youtube/oauth/start?frontend_url=${encodeURIComponent(frontendUrl)}`).then(readJson);
  const authorizationUrl = payload?.data?.authorization_url;
  if (!authorizationUrl) throw new Error("Não foi possível iniciar a conexão com o YouTube.");
  window.location.href = authorizationUrl;
}

async function cancelCurrentJob() {
  if (!state.jobId || !els.cancelButton) return;
  els.cancelButton.disabled = true;
  els.cancelButton.textContent = "Interrompendo...";
  const payload = await fetch(`/api/podcast/jobs/${encodeURIComponent(state.jobId)}/cancel`, {
    method: "POST",
  }).then(readJson);
  const job = normalizeJob(payload);
  state.renderSelectionLocked = false;
  state.job = job;
  localStorage.removeItem(PODCAST_LAST_JOB_KEY);
  clearTimeout(state.timer);
  state.timer = null;
  setProgress(job);
  renderCandidates(job);
  renderOutputs(job);
}

async function uploadOutputToYoutube(outputId, button) {
  if (!state.jobId || !outputId) return;
  if (state.actionLocked) return;
  const originalText = button.textContent;
  let uploaded = false;
  setActionLocked(true);
  button.disabled = true;
  button.textContent = "Enviando...";
  try {
    const payload = await fetch("/api/youtube/upload-podcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: state.jobId,
        output_id: outputId,
        ...outputYoutubeOverride(outputId),
        ...youtubeSettingsPayload(),
      }),
    }).then(readJson);
    const upload = payload?.data?.upload;
    uploaded = true;
    button.textContent = "Enviado";
    button.dataset.uploaded = "true";
    els.outputsMeta.textContent = "Vídeo enviado. Legenda e capas continuam disponíveis para download.";
    if (upload?.url) {
      button.insertAdjacentHTML(
        "afterend",
        ` <a class="secondary-button" href="${escapeHtml(upload.url)}" target="_blank" rel="noreferrer">Abrir YouTube</a>`,
      );
    }
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setActionLocked(false);
    if (uploaded) {
      button.disabled = true;
      button.textContent = "Enviado";
      button.dataset.uploaded = "true";
    } else {
      button.disabled = !state.youtubeAuthorized;
      button.textContent = originalText;
    }
  }
}

async function uploadAllOutputsToYoutube() {
  if (!state.jobId || !state.job?.outputs?.length) return;
  if (state.actionLocked) return;
  const originalText = els.youtubeUploadAllButton.textContent;
  setActionLocked(true);
  els.youtubeUploadAllButton.disabled = true;
  els.youtubeUploadAllButton.textContent = "Enviando...";
  try {
    const payload = await fetch("/api/youtube/upload-podcast-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: state.jobId,
        cleanup_after_upload: false,
        archive_after_upload: true,
        overrides: outputYoutubeOverrides(),
        ...youtubeSettingsPayload(),
      }),
    }).then(readJson);
    const uploads = payload?.data?.uploads || [];
    els.outputsMeta.textContent = `${uploads.length} short(s) enviados ao YouTube. Legendas e capas seguem disponíveis para download.`;
    resetClipperForNewProject("Projeto enviado ao YouTube e movido para o histórico. Você já pode criar um novo projeto.");
    await loadHistory().catch(() => {});
    setYoutubeStatus(state.youtubeConfigured, state.youtubeAuthorized);
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setActionLocked(false);
    els.youtubeUploadAllButton.textContent = originalText;
  }
}

async function downloadFile(url, filename) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    return;
  } catch {
    // Cross-origin assets without CORS may block fetch; opening the asset is the safest fallback.
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function safeDownloadName(value, fallback) {
  const safe = String(value || fallback || "miniatura")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return safe || fallback || "miniatura";
}

function selectedCoverDownloadUrl(output) {
  return selectedCoverDownloadAsset(output).url;
}

function selectedCoverDownloadAsset(outputOrId) {
  const outputId = typeof outputOrId === "string" ? outputOrId : String(outputOrId?.id || "");
  const selected = outputId
    ? els.outputs.querySelector(`[data-cover-option="${CSS.escape(outputId)}"][data-selected="true"]`)
    : null;
  const output =
    typeof outputOrId === "string"
      ? (state.job?.outputs || []).find((item) => String(item?.id || "") === outputId)
      : outputOrId;
  return {
    url: selected?.dataset.coverUrl || outputCoverUrl(output) || "",
    key: selected?.dataset.coverKey || output?.cover_key || "",
  };
}

async function downloadSelectedThumbnail(outputId) {
  const output = (state.job?.outputs || []).find((item) => String(item?.id || "") === String(outputId));
  const asset = selectedCoverDownloadAsset(outputId);
  if (!asset.url) {
    els.error.hidden = false;
    els.error.textContent = "Nenhuma miniatura disponível para download.";
    return;
  }
  const filename = `${safeDownloadName(output?.cover_title || output?.title, outputId)}.jpg`;
  await downloadFile(asset.url, filename);
}

async function downloadOutputVideo(outputId, url) {
  const output = (state.job?.outputs || []).find((item) => String(item?.id || "") === String(outputId));
  const videoUrl = url || output?.video_url || "";
  if (!videoUrl) {
    els.error.hidden = false;
    els.error.textContent = "Vídeo indisponível para download.";
    return;
  }
  const filename = `${safeDownloadName(output?.title, outputId)}.mp4`;
  await downloadFile(videoUrl, filename);
}

async function downloadAllThumbnails() {
  const outputs = Array.isArray(state.job?.outputs) ? state.job.outputs : [];
  const downloads = outputs
    .map((output, index) => {
      const asset = selectedCoverDownloadAsset(output);
      return {
        output_id: output?.id,
        filename: `${String(index + 1).padStart(2, "0")}-${safeDownloadName(output?.cover_title || output?.title, output?.id)}.jpg`,
        ...asset,
      };
    })
    .filter((item) => item.url);

  if (!downloads.length) {
    els.error.hidden = false;
    els.error.textContent = "Nenhuma miniatura disponível para download.";
    return;
  }

  if (!state.jobId) return;
  const originalText = els.downloadThumbnailsButton?.textContent || "Baixar miniaturas";
  if (els.downloadThumbnailsButton) {
    els.downloadThumbnailsButton.disabled = true;
    els.downloadThumbnailsButton.textContent = "Preparando...";
  }
  try {
    const response = await fetch(`/api/podcast/jobs/${encodeURIComponent(state.jobId)}/covers/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        covers: downloads.map((item) => ({
          output_id: item.output_id,
          cover_key: item.key,
          cover_url: item.url,
          filename: item.filename,
        })),
      }),
    });
    if (!response.ok) {
      let message = "Falha ao baixar miniaturas.";
      try {
        const payload = await response.json();
        message = payload?.message || payload?.error || message;
      } catch {
        // Keep generic message when backend returns a non-JSON error.
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    await downloadFile(objectUrl, `miniaturas-${safeDownloadName(state.job?.title || state.jobId, state.jobId)}.zip`);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    els.outputsMeta.textContent = `${downloads.length} miniatura(s) baixadas em um arquivo ZIP.`;
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (els.downloadThumbnailsButton) {
      els.downloadThumbnailsButton.disabled = false;
      els.downloadThumbnailsButton.textContent = originalText;
    }
  }
}

function cacheBustedUrl(url, version) {
  if (!url || !version) return url || "";
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function refreshDelay(job) {
  if (job?.current_step === "transcribing") return 20000;
  if (job?.current_step === "analyzing") return 10000;
  if (job?.current_step === "rendering") return 9000;
  return 5000;
}

function formatTime(value) {
  const seconds = Math.max(0, Number(value || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatMilliseconds(value) {
  return `${Math.max(0, Math.round(Number(value || 0) * 1000))} ms`;
}

function formatSeconds(value) {
  return `${Math.max(0, Number(value || 0)).toFixed(3)}s`;
}

function formatHistoryDate(value) {
  const numeric = Number(value || 0);
  const date = numeric > 0 ? new Date(numeric * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function renderHistory(jobs) {
  if (!els.history || !els.historyMeta) return;
  const visibleJobs = Array.isArray(jobs) ? jobs.filter((job) => job?.id !== state.jobId) : [];
  state.historyCount = visibleJobs.length;
  syncProjectPanels(state.job);
  if (!visibleJobs.length) {
    els.historyMeta.textContent = "Nenhum projeto criado ainda.";
    els.history.innerHTML = '<div class="empty-state">Seus projetos aparecerão aqui.</div>';
    return;
  }
  els.historyMeta.textContent = `${visibleJobs.length} projeto(s) recentes.`;
  els.history.innerHTML = visibleJobs
    .map((job) => {
      const outputsCount = Number(job.outputs_count || 0);
      const status = jobStatusLabel(job);
      return `
        <article class="history-card">
          <div>
            <strong>${escapeHtml(job.title || "Projeto de clipes")}</strong>
            <span>${escapeHtml(formatHistoryDate(job.updated_at || job.created_at))}</span>
          </div>
          <div class="history-card-meta">
            <span class="meta-pill">${escapeHtml(status)}</span>
            <span class="meta-pill">${outputsCount} short(s)</span>
          </div>
          <button type="button" class="secondary-button history-open-button" data-history-job="${escapeHtml(job.id)}">Abrir projeto</button>
        </article>
      `;
    })
    .join("");
}

async function loadHistory() {
  if (!els.history || !els.historyMeta) return;
  const payload = await fetch("/api/podcast/jobs?limit=20").then(readJson);
  const jobs = payload?.data?.jobs || payload?.jobs || [];
  renderHistory(jobs);
}

async function openHistoryJob(jobId) {
  if (!jobId) return;
  clearTimeout(state.timer);
  state.timer = null;
  state.jobId = jobId;
  localStorage.setItem(PODCAST_LAST_JOB_KEY, jobId);
  const payload = await fetch(`/api/podcast/jobs/${encodeURIComponent(jobId)}`).then(readJson);
  const job = normalizeJob(payload);
  updateRenderSelectionLock(job);
  state.job = job;
  setProgress(job);
  renderCandidates(job);
  renderOutputs(job);
  await loadHistory().catch(() => {});
  if (!["ready", "done", "failed", "cancelled"].includes(job?.status)) {
    scheduleRefresh(job);
  }
}

async function refreshJob() {
  if (!state.jobId) return;
  let payload;
  try {
    payload = await fetch(`/api/podcast/jobs/${encodeURIComponent(state.jobId)}`).then(readJson);
  } catch (error) {
    if (error?.status === 404) {
      await recoverFromMissingJob();
      return;
    }
    throw error;
  }
  const job = normalizeJob(payload);
  updateRenderSelectionLock(job);
  state.job = job;
  setProgress(job);
  renderCandidates(job);
  renderOutputs(job);
  if (["ready", "done", "failed", "cancelled"].includes(job?.status)) {
    clearTimeout(state.timer);
    state.timer = null;
    loadHistory().catch(() => {});
  } else {
    scheduleRefresh(job);
  }
}

async function recoverFromMissingJob() {
  const missingJobId = state.jobId;
  if (localStorage.getItem(PODCAST_LAST_JOB_KEY) === missingJobId) {
    localStorage.removeItem(PODCAST_LAST_JOB_KEY);
  }
  const latestJobId = await latestPodcastJobId();
  if (latestJobId && latestJobId !== missingJobId) {
    state.jobId = latestJobId;
    localStorage.setItem(PODCAST_LAST_JOB_KEY, latestJobId);
    await refreshJob();
    return;
  }
  state.jobId = null;
  state.job = null;
  state.renderSelectionLocked = false;
  renderCandidates(null);
  renderOutputs(null);
  setProgress({ status: "queued", current_step: "queued", progress: 0 });
}

async function restoreLastJob() {
  const queryJobId = new URLSearchParams(window.location.search).get("job");
  const jobId = queryJobId || localStorage.getItem(PODCAST_LAST_JOB_KEY) || (await latestActivePodcastJobId());
  if (!jobId) return;
  state.jobId = jobId;
  try {
    const payload = await fetch(`/api/podcast/jobs/${encodeURIComponent(jobId)}`).then(readJson);
    const job = normalizeJob(payload);
    if (!queryJobId && isInterruptedJob(job)) {
      localStorage.removeItem(PODCAST_LAST_JOB_KEY);
      state.jobId = null;
      state.job = null;
      state.renderSelectionLocked = false;
      renderCandidates(null);
      renderOutputs(null);
      setProgress({ status: "queued", current_step: "queued", progress: 0 });
      return;
    }
    localStorage.setItem(PODCAST_LAST_JOB_KEY, job.id);
    updateRenderSelectionLock(job);
    state.job = job;
    setProgress(job);
    renderCandidates(job);
    renderOutputs(job);
    loadHistory().catch(() => {});
    if (!["ready", "done", "failed", "cancelled"].includes(job?.status)) {
      scheduleRefresh(job);
    }
  } catch (_error) {
    localStorage.removeItem(PODCAST_LAST_JOB_KEY);
    state.jobId = null;
    state.job = null;
    state.renderSelectionLocked = false;
    renderCandidates(null);
    renderOutputs(null);
  }
}

async function latestPodcastJobId() {
  const payload = await fetch("/api/podcast/jobs?limit=10").then(readJson).catch(() => null);
  const jobs = payload?.data?.jobs || payload?.jobs || [];
  return jobs.find((job) => !isInterruptedJob(job) && job?.status !== "failed")?.id || "";
}

async function latestActivePodcastJobId() {
  const payload = await fetch("/api/podcast/jobs?limit=10").then(readJson).catch(() => null);
  const jobs = payload?.data?.jobs || payload?.jobs || [];
  return (
    jobs.find((job) =>
      !isInterruptedJob(job) &&
      ["queued", "running", "ready", "rendering"].includes(String(job?.status || ""))
    )?.id || ""
  );
}

function scheduleRefresh(job = state.job) {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    refreshJob().catch((error) => {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
      scheduleRefresh(state.job);
    });
  }, refreshDelay(job));
}

function replaceOutput(updatedOutput) {
  if (!state.job || !Array.isArray(state.job.outputs)) return;
  state.job.outputs = state.job.outputs.map((output) =>
    output?.id === updatedOutput?.id ? { ...output, ...updatedOutput } : output,
  );
}

function ensureVideoSource(video) {
  if (!video) return null;
  const source = video.dataset.src || video.dataset.videoUrl || "";
  if (source && video.getAttribute("src") !== source) {
    video.src = source;
    video.load();
  }
  return video;
}

function playOutputVideo(outputId) {
  const preview = els.outputs.querySelector(`[data-output-preview="${CSS.escape(outputId)}"]`);
  if (!preview) return;
  const videoUrl = preview.dataset.videoUrl || "";
  if (!videoUrl) return;
  const posterUrl = preview.dataset.posterUrl || "";
  preview.classList.add("is-playing");
  preview.innerHTML = `
    <video
      src="${escapeHtml(videoUrl)}"
      ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ""}
      controls
      autoplay
      playsinline
      preload="metadata"
      data-output-video="${escapeHtml(outputId)}"
    ></video>
  `;
  preview.querySelector("video")?.play().catch(() => null);
}

function loadEditPreviewVideo(outputId) {
  const preview = els.outputs.querySelector(`[data-edit-preview="${CSS.escape(outputId)}"]`);
  return ensureVideoSource(preview);
}

function selectCoverOption(outputId, coverUrl, frameUrl = "") {
  if (!outputId || (!coverUrl && !frameUrl)) return;
  const buttons = els.outputs.querySelectorAll(`[data-cover-option="${CSS.escape(outputId)}"]`);
  for (const button of buttons) {
    const selected = button.dataset.coverUrl === coverUrl && button.dataset.coverFrameUrl === frameUrl;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    const label = button.querySelector("span");
    if (label) {
      label.textContent = selected ? "Selecionada" : button.dataset.coverLabel || "Opção";
    }
  }
  const preview = els.outputs.querySelector(`[data-output-preview="${CSS.escape(outputId)}"]`);
  if (preview && !preview.querySelector("[data-output-video]")) {
    preview.dataset.posterUrl = frameUrl || coverUrl;
    const image = preview.querySelector("img");
    if (image) {
      image.src = frameUrl || coverUrl;
    }
  }
}

function updateCoverPreview(outputId) {
  if (!outputId) return;
  const group = els.outputs.querySelector(`[data-cover-preview-group="${CSS.escape(outputId)}"]`);
  if (!group) return;
  const title =
    els.outputs.querySelector(`[data-cover-title="${CSS.escape(outputId)}"]`)?.value?.trim() ||
    els.outputs.querySelector(`[data-youtube-title="${CSS.escape(outputId)}"]`)?.value?.trim() ||
    "Capa do short";
  const template = els.outputs.querySelector(`[data-cover-template="${CSS.escape(outputId)}"]`)?.value || "impact";
  const position = els.outputs.querySelector(`[data-cover-text-position="${CSS.escape(outputId)}"]`)?.value || "bottom";
  group.dataset.coverTemplate = template;
  group.dataset.coverTextPosition = position;
  group.querySelectorAll(".cover-frame-text strong").forEach((label) => {
    label.textContent = coverPreviewText(title);
  });
}

async function updateCoverPreviewOrHydrate(outputId) {
  if (!outputId) return;
  const group = els.outputs.querySelector(`[data-cover-preview-group="${CSS.escape(outputId)}"]`);
  if (group?.querySelector(".cover-frame-text")) {
    updateCoverPreview(outputId);
    return;
  }
  if (state.actionLocked) return;
  const saveButton = els.outputs.querySelector(`[data-metadata-save="${CSS.escape(outputId)}"]`);
  const originalText = saveButton?.textContent || "Salvar textos e atualizar capas";
  setActionLocked(true);
  els.outputsMeta.textContent = "Preparando previews dinâmicos das capas...";
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Gerando previews...";
  }
  try {
    const updatedOutput = await saveOutputMetadata(outputId);
    if (updatedOutput) replaceOutput(updatedOutput);
    renderOutputs(state.job);
    loadHistory().catch(() => {});
    els.outputsMeta.textContent = "Previews de capa atualizados.";
  } catch (error) {
    els.outputsMeta.textContent = "Não foi possível atualizar os previews agora. Salve os textos para tentar novamente.";
  } finally {
    setActionLocked(false);
    if (saveButton && document.contains(saveButton)) {
      saveButton.disabled = false;
      saveButton.textContent = originalText;
    }
  }
}

async function loadSubtitle(outputId) {
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/subtitle`,
  ).then(readJson);
  return payload?.data?.subtitle || payload?.subtitle || "";
}

function parseSrtBlocks(subtitle) {
  return String(subtitle || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((block, fallbackIndex) => {
      const lines = block.split("\n");
      const timeIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeIndex < 0) return null;
      const index = timeIndex > 0 ? lines[0].trim() : String(fallbackIndex + 1);
      const time = lines[timeIndex].trim();
      const text = lines.slice(timeIndex + 1).join("\n").trim();
      return { index, time, text };
    })
    .filter(Boolean);
}

function renderSubtitleTemplate(outputId, subtitle) {
  const editor = els.outputs.querySelector(`[data-subtitle-editor="${CSS.escape(outputId)}"]`);
  if (!editor) return;
  const blocks = parseSrtBlocks(subtitle);
  if (!blocks.length) {
    editor.innerHTML = '<div class="empty-state">Não foi possível carregar a legenda em blocos editáveis.</div>';
    editor.dataset.loaded = "false";
    return;
  }
  editor.innerHTML = blocks
    .map(
      (block, index) => `
        <article
          class="subtitle-template-row"
          data-subtitle-block="${escapeHtml(outputId)}"
          data-subtitle-index="${escapeHtml(block.index)}"
          data-subtitle-time="${escapeHtml(block.time)}"
        >
          <div class="subtitle-template-meta">
            <span>${escapeHtml(block.index || index + 1)}</span>
            <code title="Timestamp bloqueado">${escapeHtml(block.time)}</code>
            <em>tempo bloqueado</em>
          </div>
          <textarea
            class="output-edit-textarea subtitle-template-text"
            data-subtitle-text="${escapeHtml(outputId)}"
            rows="2"
            spellcheck="true"
          >${escapeHtml(block.text)}</textarea>
        </article>
      `,
    )
    .join("");
  editor.dataset.loaded = "true";
}

function subtitleFromTemplate(outputId) {
  const rows = [...els.outputs.querySelectorAll(`[data-subtitle-block="${CSS.escape(outputId)}"]`)];
  if (!rows.length) {
    throw new Error("Legenda não carregada. Abra o editor novamente.");
  }
  return rows
    .map((row, index) => {
      const subtitleIndex = row.dataset.subtitleIndex || String(index + 1);
      const subtitleTime = row.dataset.subtitleTime || "";
      const text = row.querySelector("[data-subtitle-text]")?.value?.trim() || "";
      if (!subtitleTime.includes("-->")) {
        throw new Error("Bloco de legenda inválido. Os timestamps originais não foram encontrados.");
      }
      return `${subtitleIndex}\n${subtitleTime}\n${text || " "}`;
    })
    .join("\n\n");
}

async function saveSubtitle(outputId, subtitle) {
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/subtitle`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtitle }),
    },
  ).then(readJson);
  return payload?.data?.output || payload?.output || null;
}

async function setSubtitleMode(outputId, burnSubtitles) {
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/subtitle-mode`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ burn_subtitles: burnSubtitles }),
    },
  ).then(readJson);
  return payload?.data?.output || payload?.output || null;
}

async function saveOutputMetadata(outputId) {
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/metadata`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outputMetadataPayload(outputId)),
    },
  ).then(readJson);
  return payload?.data?.output || payload?.output || null;
}

async function exportEditedOutput(outputId) {
  const startInput = els.outputs.querySelector(`[data-edit-start="${CSS.escape(outputId)}"]`);
  const endInput = els.outputs.querySelector(`[data-edit-end="${CSS.escape(outputId)}"]`);
  const appendInput = els.outputs.querySelector(`[data-edit-append="${CSS.escape(outputId)}"]`);
  const positionInput = els.outputs.querySelector(`[data-edit-position="${CSS.escape(outputId)}"]`);
  const trimStart = Number(startInput?.value || 0);
  const trimEnd = Number(endInput?.value || 0);
  if (!Number.isFinite(trimStart) || !Number.isFinite(trimEnd) || trimEnd <= trimStart) {
    throw new Error("Informe um início e fim válidos para o corte.");
  }
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/edit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trim_start: trimStart,
        trim_end: trimEnd,
        append_output_id: appendInput?.value || null,
        append_position: positionInput?.value || "after",
      }),
    },
  ).then(readJson);
  return payload?.data?.output || payload?.output || null;
}

function appendOutput(output) {
  if (!state.job || !Array.isArray(state.job.outputs) || !output) return;
  state.job.outputs = [...state.job.outputs, output];
}

function setTrimEnd(outputId, secondsToRemove) {
  const output = (state.job?.outputs || []).find((item) => item?.id === outputId);
  const endInput = els.outputs.querySelector(`[data-edit-end="${CSS.escape(outputId)}"]`);
  if (!output || !endInput) return;
  const duration = Number(output.duration || 0);
  const nextEnd = Math.max(0.1, duration - Number(secondsToRemove || 0));
  endInput.value = nextEnd.toFixed(3);
  syncClipRangeTimeline(outputId);
}

function clipDuration(outputId) {
  const output = (state.job?.outputs || []).find((item) => item?.id === outputId);
  const timeline = els.outputs.querySelector(`[data-range-timeline="${CSS.escape(outputId)}"]`);
  return Math.max(0.001, Number(timeline?.dataset.duration || output?.duration || 0));
}

function trimInputs(outputId) {
  return {
    startInput: els.outputs.querySelector(`[data-edit-start="${CSS.escape(outputId)}"]`),
    endInput: els.outputs.querySelector(`[data-edit-end="${CSS.escape(outputId)}"]`),
  };
}

function trimValues(outputId) {
  const duration = clipDuration(outputId);
  const { startInput, endInput } = trimInputs(outputId);
  let start = Number(startInput?.value || 0);
  let end = Number(endInput?.value || duration);
  if (!Number.isFinite(start)) start = 0;
  if (!Number.isFinite(end)) end = duration;
  start = Math.max(0, Math.min(start, Math.max(0, duration - 0.001)));
  end = Math.max(start + 0.001, Math.min(end, duration));
  return { start, end, duration };
}

function setTrimValues(outputId, start, end) {
  const duration = clipDuration(outputId);
  const { startInput, endInput } = trimInputs(outputId);
  const nextStart = Math.max(0, Math.min(Number(start || 0), Math.max(0, duration - 0.001)));
  const nextEnd = Math.max(nextStart + 0.001, Math.min(Number(end || duration), duration));
  if (startInput) startInput.value = nextStart.toFixed(3);
  if (endInput) endInput.value = nextEnd.toFixed(3);
  syncClipRangeTimeline(outputId);
}

function syncClipRangeTimeline(outputId) {
  const { start, end, duration } = trimValues(outputId);
  const { startInput, endInput } = trimInputs(outputId);
  if (startInput && startInput.value !== start.toFixed(3)) startInput.value = start.toFixed(3);
  if (endInput && endInput.value !== end.toFixed(3)) endInput.value = end.toFixed(3);

  const startPercent = (start / duration) * 100;
  const endPercent = (end / duration) * 100;
  const selection = els.outputs.querySelector(`[data-range-selection="${CSS.escape(outputId)}"]`);
  const startHandle = els.outputs.querySelector(`[data-range-handle="${CSS.escape(outputId)}"][data-handle-kind="start"]`);
  const endHandle = els.outputs.querySelector(`[data-range-handle="${CSS.escape(outputId)}"][data-handle-kind="end"]`);
  const startLabel = els.outputs.querySelector(`[data-range-start-label="${CSS.escape(outputId)}"]`);
  const durationLabel = els.outputs.querySelector(`[data-range-duration-label="${CSS.escape(outputId)}"]`);
  const endLabel = els.outputs.querySelector(`[data-range-end-label="${CSS.escape(outputId)}"]`);
  const preview = els.outputs.querySelector(`[data-edit-preview="${CSS.escape(outputId)}"]`);
  const previewCurrent = els.outputs.querySelector(`[data-preview-current="${CSS.escape(outputId)}"]`);
  const previewStart = els.outputs.querySelector(`[data-preview-start="${CSS.escape(outputId)}"]`);
  const previewEnd = els.outputs.querySelector(`[data-preview-end="${CSS.escape(outputId)}"]`);
  const previewSelected = els.outputs.querySelector(`[data-preview-selected="${CSS.escape(outputId)}"]`);

  if (selection) {
    selection.style.left = `${startPercent}%`;
    selection.style.right = `${100 - endPercent}%`;
  }
  if (startHandle) startHandle.style.left = `${startPercent}%`;
  if (endHandle) endHandle.style.left = `${endPercent}%`;
  if (startLabel) startLabel.textContent = `Início: ${formatMilliseconds(start)}`;
  if (durationLabel) durationLabel.textContent = `Selecionado: ${formatMilliseconds(end - start)}`;
  if (endLabel) endLabel.textContent = `Fim: ${formatMilliseconds(end)}`;
  if (previewStart) previewStart.textContent = formatSeconds(start);
  if (previewEnd) previewEnd.textContent = formatSeconds(end);
  if (previewSelected) previewSelected.textContent = formatSeconds(end - start);
  if (previewCurrent && preview) previewCurrent.textContent = formatSeconds(preview.currentTime || 0);
  syncPreviewPlayhead(outputId);
}

function syncPreviewPlayhead(outputId) {
  const preview = els.outputs.querySelector(`[data-edit-preview="${CSS.escape(outputId)}"]`);
  const playhead = els.outputs.querySelector(`[data-range-playhead="${CSS.escape(outputId)}"]`);
  const previewCurrent = els.outputs.querySelector(`[data-preview-current="${CSS.escape(outputId)}"]`);
  const duration = clipDuration(outputId);
  if (!preview) return;
  const current = Math.max(0, Math.min(Number(preview.currentTime || 0), duration));
  if (playhead) playhead.style.left = `${(current / duration) * 100}%`;
  if (previewCurrent) previewCurrent.textContent = formatSeconds(current);
}

function seekPreview(outputId, time) {
  const preview = loadEditPreviewVideo(outputId);
  if (!preview) return;
  preview.currentTime = Math.max(0, Math.min(Number(time || 0), clipDuration(outputId)));
  syncPreviewPlayhead(outputId);
}

els.outputs.addEventListener("click", async (event) => {
  if (state.actionLocked && event.target.closest("button, a.secondary-button")) {
    event.preventDefault();
    return;
  }

  const playButton = event.target.closest("[data-output-play]");
  if (playButton) {
    playOutputVideo(playButton.dataset.outputPlay || "");
    return;
  }

  const coverOptionDownload = event.target.closest("[data-cover-download-option]");
  if (coverOptionDownload) {
    const outputId = String(coverOptionDownload.dataset.coverDownloadOption || "");
    const output = (state.job?.outputs || []).find((item) => String(item?.id || "") === outputId);
    const label = coverOptionDownload.dataset.coverDownloadLabel || "capa";
    const url = coverOptionDownload.dataset.coverDownloadUrl || "";
    if (!url) {
      els.error.hidden = false;
      els.error.textContent = "Miniatura indisponível para download.";
      return;
    }
    coverOptionDownload.disabled = true;
    const originalText = coverOptionDownload.textContent;
    coverOptionDownload.textContent = "Baixando...";
    try {
      const filename = `${safeDownloadName(output?.cover_title || output?.title, outputId)}-${safeDownloadName(label, "capa")}.jpg`;
      await downloadFile(url, filename);
    } finally {
      coverOptionDownload.disabled = false;
      coverOptionDownload.textContent = originalText;
    }
    return;
  }

  const coverOption = event.target.closest("[data-cover-option]");
  if (coverOption) {
    selectCoverOption(coverOption.dataset.coverOption, coverOption.dataset.coverUrl, coverOption.dataset.coverFrameUrl);
    return;
  }

  const videoDownload = event.target.closest("[data-video-download]");
  if (videoDownload) {
    const outputId = String(videoDownload.dataset.videoDownload || "");
    if (!outputId) return;
    videoDownload.disabled = true;
    const originalText = videoDownload.textContent;
    videoDownload.textContent = "Baixando...";
    try {
      await downloadOutputVideo(outputId, videoDownload.dataset.videoDownloadUrl || "");
    } finally {
      videoDownload.disabled = false;
      videoDownload.textContent = originalText;
    }
    return;
  }

  const metadataSave = event.target.closest("[data-metadata-save]");
  if (metadataSave) {
    const outputId = String(metadataSave.dataset.metadataSave || "");
    if (!outputId) return;
    setActionLocked(true);
    metadataSave.disabled = true;
    metadataSave.textContent = "Salvando...";
    try {
      const updatedOutput = await saveOutputMetadata(outputId);
      if (updatedOutput) replaceOutput(updatedOutput);
      renderOutputs(state.job);
      loadHistory().catch(() => {});
      els.outputsMeta.textContent = "Textos salvos e capas atualizadas.";
    } catch (error) {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setActionLocked(false);
      metadataSave.disabled = false;
      metadataSave.textContent = "Salvar textos e atualizar capas";
    }
    return;
  }

  const youtubeButton = event.target.closest(".youtube-upload-button");
  if (youtubeButton) {
    uploadOutputToYoutube(youtubeButton.dataset.outputId, youtubeButton);
    return;
  }

  const editToggle = event.target.closest("[data-edit-toggle]");
  const editSave = event.target.closest("[data-edit-save]");
  if (editToggle || editSave) {
    const outputId = String(
      editToggle?.dataset.editToggle || editSave?.dataset.editSave || "",
    );
    if (!outputId) return;
    const panel = els.outputs.querySelector(`[data-edit-panel="${CSS.escape(outputId)}"]`);
    const saveButton = els.outputs.querySelector(`[data-edit-save="${CSS.escape(outputId)}"]`);
    if (editToggle) {
      const opening = panel?.hidden;
      if (panel) panel.hidden = !opening;
      if (saveButton) saveButton.hidden = !opening;
      editToggle.hidden = Boolean(opening);
      if (opening) {
        loadEditPreviewVideo(outputId);
        syncClipRangeTimeline(outputId);
      }
      return;
    }
    setActionLocked(true);
    editSave.disabled = true;
    editSave.textContent = "Exportando...";
    try {
      const output = await exportEditedOutput(outputId);
      appendOutput(output);
      renderOutputs(state.job);
      loadHistory().catch(() => {});
      els.outputsMeta.textContent = "Versão editada criada. Revise a nova saída antes de enviar.";
    } catch (error) {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setActionLocked(false);
      editSave.disabled = false;
      editSave.textContent = "Salvar como novo clipe";
    }
    return;
  }

  const toggle = event.target.closest("[data-subtitle-toggle]");
  const save = event.target.closest("[data-subtitle-save]");
  const mode = event.target.closest("[data-subtitle-mode]");
  if (!toggle && !save && !mode) return;

  const outputId = String(
    (toggle || save || mode).dataset.subtitleToggle ||
      (toggle || save || mode).dataset.subtitleSave ||
      (toggle || save || mode).dataset.subtitleMode ||
      "",
  );
  const panel = els.outputs.querySelector(`[data-subtitle-panel="${CSS.escape(outputId)}"]`);
  const editor = els.outputs.querySelector(`[data-subtitle-editor="${CSS.escape(outputId)}"]`);
  const saveButton = els.outputs.querySelector(`[data-subtitle-save="${CSS.escape(outputId)}"]`);
  if (!outputId) return;

  if (mode) {
    const burnSubtitles = mode.dataset.burnSubtitles === "true";
    setActionLocked(true);
    mode.disabled = true;
    mode.textContent = burnSubtitles ? "Aplicando legenda..." : "Preparando vídeo...";
    try {
      const updatedOutput = await setSubtitleMode(outputId, burnSubtitles);
      if (updatedOutput) replaceOutput(updatedOutput);
      renderOutputs(state.job);
      loadHistory().catch(() => {});
    } catch (error) {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setActionLocked(false);
      mode.disabled = false;
    }
    return;
  }

  if (!panel || !editor || !saveButton) return;

  if (toggle) {
    const opening = panel.hidden;
    panel.hidden = !opening;
    saveButton.hidden = !opening;
    if (opening && editor.dataset.loaded !== "true") {
      setActionLocked(true);
      toggle.disabled = true;
      toggle.textContent = "Carregando...";
      try {
        renderSubtitleTemplate(outputId, await loadSubtitle(outputId));
      } catch (error) {
        els.error.hidden = false;
        els.error.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        setActionLocked(false);
        toggle.disabled = false;
        toggle.textContent = "Editar legenda";
      }
    }
    return;
  }

  setActionLocked(true);
  save.disabled = true;
  save.textContent = "Atualizando vídeo...";
  try {
    const updatedOutput = await saveSubtitle(outputId, subtitleFromTemplate(outputId));
    if (updatedOutput) replaceOutput(updatedOutput);
    renderOutputs(state.job);
    loadHistory().catch(() => {});
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setActionLocked(false);
    save.disabled = false;
    save.textContent = "Salvar e atualizar vídeo";
  }
});

els.outputs.addEventListener("input", (event) => {
  const titleInput = event.target.closest("[data-youtube-title]");
  if (titleInput) {
    const outputId = titleInput.dataset.youtubeTitle || "";
    const coverInput = els.outputs.querySelector(`[data-cover-title="${CSS.escape(outputId)}"]`);
    const previousTitle = titleInput.dataset.previousTitle || "";
    if (coverInput && coverInput.dataset.manuallyEdited !== "true") {
      coverInput.value = titleInput.value;
    } else if (coverInput && coverInput.value.trim() === previousTitle.trim()) {
      coverInput.value = titleInput.value;
      coverInput.dataset.manuallyEdited = "false";
    }
    titleInput.dataset.previousTitle = titleInput.value;
    updateCoverPreview(outputId);
  }

  const coverInput = event.target.closest("[data-cover-title]");
  if (coverInput) {
    coverInput.dataset.manuallyEdited = "true";
    updateCoverPreview(coverInput.dataset.coverTitle || "");
  }

  const startInput = event.target.closest("[data-edit-start]");
  const endInput = event.target.closest("[data-edit-end]");
  const outputId = startInput?.dataset.editStart || endInput?.dataset.editEnd || "";
  if (!outputId) return;
  syncClipRangeTimeline(outputId);
});

els.outputs.addEventListener("change", (event) => {
  const coverTemplate = event.target.closest("[data-cover-template]");
  const coverPosition = event.target.closest("[data-cover-text-position]");
  const outputId = coverTemplate?.dataset.coverTemplate || coverPosition?.dataset.coverTextPosition || "";
  if (!outputId) return;
  updateCoverPreviewOrHydrate(outputId);
});

els.outputs.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const coverOption = event.target.closest("[data-cover-option]");
  if (!coverOption || event.target.closest("[data-cover-download-option]")) return;
  event.preventDefault();
  selectCoverOption(coverOption.dataset.coverOption, coverOption.dataset.coverUrl, coverOption.dataset.coverFrameUrl);
});

els.candidates.addEventListener("change", (event) => {
  if (!event.target.closest("input[type='checkbox']")) return;
  syncCandidateSelectionState(state.job);
});

els.selectAllCandidates?.addEventListener("change", () => {
  const checked = Boolean(els.selectAllCandidates?.checked);
  els.candidates.querySelectorAll("input[type='checkbox']").forEach((input) => {
    if (!input.disabled) input.checked = checked;
  });
  syncCandidateSelectionState(state.job);
});

els.outputs.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-range-handle]");
  if (!handle) return;
  const outputId = String(handle.dataset.rangeHandle || "");
  const kind = String(handle.dataset.handleKind || "");
  const track = els.outputs.querySelector(`[data-range-track="${CSS.escape(outputId)}"]`);
  if (!outputId || !track || !["start", "end"].includes(kind)) return;

  event.preventDefault();
  handle.setPointerCapture?.(event.pointerId);

  const updateFromPointer = (pointerEvent) => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (pointerEvent.clientX - rect.left) / Math.max(1, rect.width)));
    const nextTime = ratio * clipDuration(outputId);
    const { start, end } = trimValues(outputId);
    if (kind === "start") {
      setTrimValues(outputId, Math.min(nextTime, end - 0.001), end);
      seekPreview(outputId, Math.min(nextTime, end - 0.001));
    } else {
      setTrimValues(outputId, start, Math.max(nextTime, start + 0.001));
      seekPreview(outputId, Math.max(nextTime, start + 0.001));
    }
  };

  const stopDragging = () => {
    window.removeEventListener("pointermove", updateFromPointer);
    window.removeEventListener("pointerup", stopDragging);
    window.removeEventListener("pointercancel", stopDragging);
  };

  updateFromPointer(event);
  window.addEventListener("pointermove", updateFromPointer);
  window.addEventListener("pointerup", stopDragging);
  window.addEventListener("pointercancel", stopDragging);
});

els.outputs.addEventListener("click", (event) => {
  const track = event.target.closest("[data-range-track]");
  if (!track || event.target.closest("[data-range-handle]")) return;
  const outputId = String(track.dataset.rangeTrack || "");
  if (!outputId) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
  seekPreview(outputId, ratio * clipDuration(outputId));
});

els.outputs.addEventListener("timeupdate", (event) => {
  const preview = event.target.closest("[data-edit-preview]");
  if (!preview) return;
  syncPreviewPlayhead(preview.dataset.editPreview || "");
});

els.outputs.addEventListener("loadedmetadata", (event) => {
  const preview = event.target.closest("[data-edit-preview]");
  if (!preview) return;
  const outputId = preview.dataset.editPreview || "";
  const timeline = els.outputs.querySelector(`[data-range-timeline="${CSS.escape(outputId)}"]`);
  if (timeline && Number.isFinite(preview.duration) && preview.duration > 0) {
    timeline.dataset.duration = String(preview.duration);
  }
  syncClipRangeTimeline(outputId);
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData();
  const url = els.url.value.trim();
  const file = els.file.files?.[0] || null;
  if (!url && !file) {
    els.error.hidden = false;
    els.error.textContent = "Envie um arquivo ou informe uma URL.";
    return;
  }
  if (url) formData.set("url", url);
  if (file) formData.set("file", file);

  els.submit.disabled = true;
  els.submit.textContent = "Enviando...";
  try {
    const payload = await fetch("/api/podcast/jobs", {
      method: "POST",
      body: formData,
    }).then(readJson);
    const job = normalizeJob(payload);
    state.jobId = job.id;
    state.job = job;
    state.renderSelectionLocked = false;
    localStorage.setItem(PODCAST_LAST_JOB_KEY, job.id);
    setProgress(job);
    renderCandidates(job);
    renderOutputs(job);
    loadHistory().catch(() => {});
    scheduleRefresh();
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = "Criar projeto";
  }
});

els.renderButton.addEventListener("click", async () => {
  if (!state.jobId) return;
  const selectedIds = selectedCandidateIds();
  if (!selectedIds.length) {
    els.error.hidden = false;
    els.error.textContent = "Selecione pelo menos um corte.";
    syncCandidateSelectionState(state.job);
    return;
  }

  els.renderButton.disabled = true;
  els.renderButton.textContent = "Renderizando...";
  state.renderSelectionLocked = true;
  setCandidateSelectionDisabled(true);
  setProgress(state.job);
  try {
    const payload = await fetch(`/api/podcast/jobs/${encodeURIComponent(state.jobId)}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selected_ids: selectedIds,
        burn_subtitles: els.burnSubtitles?.checked ?? true,
        remove_silence: els.removeSilence?.checked ?? true,
        artificial_cuts: els.artificialCuts?.checked ?? true,
      }),
    }).then(readJson);
    state.job = normalizeJob(payload);
    updateRenderSelectionLock(state.job);
    setProgress(state.job);
    renderCandidates(state.job);
    loadHistory().catch(() => {});
    scheduleRefresh();
  } catch (error) {
    state.renderSelectionLocked = false;
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    setCandidateSelectionDisabled(false);
    syncCandidateSelectionState(state.job);
  } finally {
    if (state.job?.status !== "rendering") {
      syncCandidateSelectionState(state.job);
    }
  }
});

els.youtubeConnectButton.addEventListener("click", () => {
  connectYoutube().catch((error) => {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  });
});

els.youtubeUploadAllButton.addEventListener("click", () => {
  uploadAllOutputsToYoutube().catch((error) => {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  });
});

els.downloadThumbnailsButton?.addEventListener("click", () => {
  downloadAllThumbnails();
});

els.cancelButton?.addEventListener("click", () => {
  if (els.cancelButton?.dataset.statusAction === "new-project") {
    resetClipperForNewProject();
    return;
  }

  cancelCurrentJob().catch((error) => {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    if (els.cancelButton) {
      els.cancelButton.disabled = false;
      els.cancelButton.textContent = "Interromper processo";
    }
  });
});

els.history?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-history-job]");
  if (!button) return;
  openHistoryJob(button.dataset.historyJob).catch((error) => {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  });
});

if (new URLSearchParams(window.location.search).get("youtube") === "connected") {
  history.replaceState(null, "", window.location.pathname);
}

refreshYoutubeStatus().catch((error) => {
  setYoutubeStatus(false, false);
  els.error.hidden = false;
  els.error.textContent = error instanceof Error ? error.message : String(error);
});

restoreLastJob().catch((error) => {
  els.error.hidden = false;
  els.error.textContent = error instanceof Error ? error.message : String(error);
});

loadHistory().catch((error) => {
  if (!els.historyMeta) return;
  els.historyMeta.textContent = error instanceof Error ? error.message : "Não foi possível carregar o histórico.";
});
