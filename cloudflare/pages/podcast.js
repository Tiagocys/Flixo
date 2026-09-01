const state = {
  jobId: null,
  job: null,
  timer: null,
  historyCount: 0,
  deletingHistoryJobs: new Set(),
  expandedOutputs: new Set(),
  outputTabs: new Map(),
  timelineProjects: new Map(),
  timelineSelections: new Map(),
  timelineUndoStacks: new Map(),
  activeTimelineOutputId: null,
  suppressTimelineClickUntil: 0,
  lastTimelineSplit: null,
  candidateRenderToken: 0,
  outputRenderToken: 0,
  uiBusyCount: 0,
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
  candidateSubtitleSettings: document.getElementById("podcast-candidate-subtitle-settings"),
  selectAllCandidates: document.getElementById("podcast-select-all-candidates"),
  renderButton: document.getElementById("podcast-render-button"),
  outputsMeta: document.getElementById("podcast-outputs-meta"),
  outputs: document.getElementById("podcast-outputs"),
  youtubeStatusMeta: document.getElementById("podcast-youtube-status-meta"),
  youtubeConnectButton: document.getElementById("podcast-youtube-connect-button"),
  youtubeUploadAllButton: document.getElementById("podcast-youtube-upload-all-button"),
  downloadThumbnailsButton: document.getElementById("podcast-download-thumbnails-button"),
  downloadSubtitlesButton: document.getElementById("podcast-download-subtitles-button"),
  youtubePrivacy: document.getElementById("podcast-youtube-privacy"),
  youtubeVideoLanguage: document.getElementById("podcast-youtube-video-language"),
  youtubeCategory: document.getElementById("podcast-youtube-category"),
  removeSilence: document.getElementById("podcast-remove-silence"),
  artificialCuts: document.getElementById("podcast-artificial-cuts"),
  burnSubtitles: document.getElementById("podcast-burn-subtitles"),
  candidatesPanel: document.querySelector(".clipper-candidates-panel"),
  outputsPanel: document.querySelector(".clipper-outputs-panel"),
  historyPanel: document.querySelector(".clipper-history-panel"),
  historyMeta: document.getElementById("podcast-history-meta"),
  history: document.getElementById("podcast-history"),
  confirmModal: document.getElementById("clipper-confirm-modal"),
  confirmTitle: document.getElementById("clipper-confirm-title"),
  confirmMessage: document.getElementById("clipper-confirm-message"),
  confirmAccept: document.querySelector("[data-confirm-accept]"),
  confirmCancelButtons: document.querySelectorAll("[data-confirm-cancel]"),
};

const STAGE_ORDER = ["ingesting", "transcribing", "analyzing", "ready", "rendering"];

const OUTPUT_TABS = [
  ["metadata", "Metadados"],
  ["cover", "Miniatura"],
  ["subtitle", "Legenda"],
  ["edit", "Edição de vídeo"],
  ["upload", "Envio"],
];

const STAGE_MESSAGES = {
  queued: "Projeto recebido. Vamos preparar o vídeo para análise.",
  ingesting: "Preparando o vídeo e extraindo informações básicas.",
  transcribing: "Transcrevendo as falas. Esta etapa varia conforme o tamanho do vídeo.",
  analyzing: "A IA está entendendo o contexto e procurando os melhores momentos.",
  ready: "Cortes sugeridos prontos. Selecione os trechos que deseja transformar em cortes.",
  rendering: "Renderizando os cortes selecionados com câmera e legenda.",
  done: "Cortes editáveis prontos.",
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

const SUBTITLE_COLOR_PRESETS = [
  { text: "white", border: "black", label: "Branca com borda preta" },
  { text: "yellow", border: "black", label: "Amarela com borda preta" },
  { text: "blue", border: "black", label: "Azul com borda preta" },
  { text: "red", border: "black", label: "Vermelha com borda preta" },
];

const SUBTITLE_STYLE_OPTIONS = [
  ["standard", "Blocos no rodapé"],
  ["word", "Uma palavra por vez"],
];

const SUBTITLE_SIZE_OPTIONS = [
  ["small", "Menor"],
  ["medium", "Média"],
  ["large", "Maior"],
];

const SUBTITLE_POSITION_OPTIONS = [
  ["top", "Topo"],
  ["middle", "Centro"],
  ["bottom", "Baixo"],
];

const CLIP_FORMAT_OPTIONS = [
  {
    value: "auto",
    label: "Automático",
    ratio: "Auto",
    hint: "IA decide",
    icon: "",
  },
  {
    value: "vertical",
    label: "Retrato",
    ratio: "9:16",
    hint: "Celular em pé",
    icon: "/assets/retrato.svg",
  },
  {
    value: "square",
    label: "Quadrado",
    ratio: "1:1",
    hint: "Feed quadrado",
    icon: "/assets/square.svg",
  },
  {
    value: "landscape",
    label: "Paisagem",
    ratio: "16:9",
    hint: "Celular deitado",
    icon: "/assets/paisagem.svg",
  },
];

const GLOBAL_SUBTITLE_PREVIEW_ID = "__global_subtitle__";

const YOUTUBE_CATEGORY_OPTIONS = [
  ["", "Nenhum"],
  ["15", "Animais"],
  ["2", "Automóveis"],
  ["28", "Ciência e tecnologia"],
  ["23", "Comédia"],
  ["27", "Educação"],
  ["24", "Entretenimento"],
  ["17", "Esportes"],
  ["1", "Filme e animação"],
  ["26", "Instruções e estilo"],
  ["20", "Jogos"],
  ["10", "Música"],
  ["25", "Notícias e política"],
  ["22", "Pessoas e blogs"],
  ["29", "Sem fins lucrativos e ativismo"],
  ["19", "Viagens e eventos"],
];

function hasActiveProject(job) {
  if (!job) return false;
  if (isInterruptedJob(job)) return false;
  return ["queued", "running", "ready", "rendering", "done"].includes(String(job.status || ""));
}

function isProcessingProject(job) {
  if (!job || isInterruptedJob(job)) return false;
  const status = String(job.status || "");
  const step = String(job.current_step || "");
  return (
    ["queued", "running", "rendering"].includes(status) ||
    ["queued", "ingesting", "transcribing", "analyzing", "rendering"].includes(step)
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setUiBusy(busy) {
  state.uiBusyCount = Math.max(0, state.uiBusyCount + (busy ? 1 : -1));
  document.body.classList.toggle("clipper-ui-busy", state.uiBusyCount > 0);
}

function afterNextPaint(callback) {
  const frame = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (handler) => window.setTimeout(handler, 0);
  frame(() => frame(callback));
}

function runAfterLoaderPaint(callback) {
  setUiBusy(true);
  afterNextPaint(() => {
    try {
      callback();
    } finally {
      setUiBusy(false);
    }
  });
}

function cancelPendingUiRenders() {
  state.candidateRenderToken += 1;
  state.outputRenderToken += 1;
  state.uiBusyCount = 0;
  document.body.classList.remove("clipper-ui-busy");
  if (els.candidates) delete els.candidates.dataset.renderKey;
  if (els.outputs) delete els.outputs.dataset.renderKey;
}

function datetimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function minimumPublishAtLocalValue() {
  const date = new Date(Date.now() + 5 * 60 * 1000);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function publishAtIsoValue(outputId) {
  const input = els.outputs.querySelector(`[data-youtube-publish-at="${CSS.escape(outputId)}"]`);
  const value = input?.value?.trim() || "";
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Horario de publicacao invalido.");
  }
  if (date.getTime() <= Date.now() + 60 * 1000) {
    throw new Error("Escolha um horario de publicacao futuro.");
  }
  return date.toISOString();
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
    window.requestAnimationFrame(() => els.confirmAccept.focus());
  });
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || response.statusText);
    error.status = response.status;
    error.data = payload?.data || null;
    error.payload = payload;
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
  const hasHistory = state.historyCount > 0 || isProcessingProject(job);

  if (els.form) els.form.hidden = hasActiveProject(job);
  if (els.candidatesPanel) els.candidatesPanel.hidden = !hasCandidates;
  if (els.outputsPanel) els.outputsPanel.hidden = !hasOutputs;
  if (els.historyPanel) els.historyPanel.hidden = !hasHistory;
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
    const canCreateNew = ["ready", "done"].includes(String(job?.status || ""));
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
  state.expandedOutputs.clear();
  state.outputTabs.clear();
  state.timelineProjects.clear();
  state.timelineSelections.clear();
  state.timelineUndoStacks.clear();
  state.activeTimelineOutputId = null;
  cancelPendingUiRenders();
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
  loadHistory().catch(() => {});
}

function actionLockControls() {
  const selectors = [
    ".clipper-candidates-panel button",
    ".clipper-candidates-panel input",
    ".clipper-candidates-panel select",
    ".clipper-outputs-panel button",
    ".clipper-outputs-panel input",
    ".clipper-outputs-panel textarea",
    ".clipper-outputs-panel select",
    ".clipper-history-panel button",
  ];
  return [...document.querySelectorAll(selectors.join(","))].filter(
    (control) => !control.closest(".nle-editor-shell"),
  );
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
    updateVisibleEditSaveStates();
  }
}

function syncActionLockControls() {
  if (state.actionLocked) setActionLocked(true);
}

function candidateSubtitleSettingsElement() {
  if (!els.candidateSubtitleSettings && els.candidatesPanel && els.candidates) {
    const container = document.createElement("div");
    container.id = "podcast-candidate-subtitle-settings";
    els.candidatesPanel.insertBefore(container, els.candidates);
    els.candidateSubtitleSettings = container;
  }
  if (els.candidateSubtitleSettings && els.candidateSubtitleSettings.dataset.bound !== "true") {
    els.candidateSubtitleSettings.addEventListener("click", handleSubtitlePreviewClick);
    els.candidateSubtitleSettings.dataset.bound = "true";
  }
  return els.candidateSubtitleSettings;
}

function shouldShowCandidateSubtitleSettings(job, candidates) {
  return Array.isArray(candidates) && candidates.length > 0 && job?.status === "ready" && !isCandidateSelectionLocked(job);
}

function hideCandidateSubtitleSettings() {
  const subtitleSettings = candidateSubtitleSettingsElement();
  if (!subtitleSettings) return;
  subtitleSettings.hidden = true;
}

function renderCandidates(job) {
  const candidates = Array.isArray(job?.candidates) ? job.candidates : [];
  if (!candidates.length) {
    state.candidateRenderToken += 1;
    if (els.candidates) delete els.candidates.dataset.renderKey;
    renderCandidatesNow(job);
    return;
  }

  const renderKey = candidateRenderKey(job, candidates);
  if (els.candidates?.dataset.renderKey === renderKey) {
    syncCandidateSelectionState(job);
    updateGlobalSubtitlePreviewCandidate();
    return;
  }

  const token = ++state.candidateRenderToken;
  showCandidateRenderLoader(job, candidates);
  runAfterLoaderPaint(() => {
    if (token !== state.candidateRenderToken) return;
    if (job?.id && state.job?.id && job.id !== state.job.id) return;
    renderCandidatesNow(job);
    if (els.candidates) els.candidates.dataset.renderKey = renderKey;
  });
}

function candidateRenderKey(job, candidates) {
  return [
    job?.id || "",
    job?.status || "",
    job?.current_step || "",
    isCandidateSelectionLocked(job) ? "locked" : "editable",
    candidates
      .map((candidate) => [
        candidate?.id,
        candidate?.start,
        candidate?.end,
        candidate?.title,
        candidate?.hook,
        candidate?.preview_frame_url || candidate?.preview_frame_path || "",
      ].join(":"))
      .join("|"),
  ].join("::");
}

function candidateSkeletonHtml(count = 4) {
  const total = Math.min(Math.max(Number(count || 4), 2), 8);
  return `
    <div class="clipper-ui-loader">
      <span class="clipper-loader-spinner" aria-hidden="true"></span>
      <strong>Preparando cortes sugeridos</strong>
    </div>
    <div class="clipper-candidate-list is-loading-list" aria-hidden="true">
      ${Array.from({ length: total }).map(() => `
        <div class="clipper-candidate-card clipper-skeleton-card">
          <span class="clipper-skeleton-check"></span>
          <div class="clipper-candidate-body">
            <span class="clipper-skeleton-line is-title"></span>
            <span class="clipper-skeleton-line is-short"></span>
            <span class="clipper-skeleton-line"></span>
            <span class="clipper-skeleton-line is-mid"></span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function candidateSettingsSkeletonHtml() {
  return `
    <section class="candidate-subtitle-settings">
      <div class="candidate-render-settings">
        <span class="candidate-render-title">Formato do corte</span>
        <div class="clip-format-options" aria-hidden="true">
          ${Array.from({ length: 4 }).map(() => '<span class="clip-format-option clipper-skeleton-format"></span>').join("")}
        </div>
      </div>
      <div class="subtitle-color-preview clipper-skeleton-preview" aria-hidden="true"></div>
    </section>
  `;
}

function showCandidateRenderLoader(job, candidates) {
  const subtitleSettings = candidateSubtitleSettingsElement();
  if (els.candidatesMeta) {
    els.candidatesMeta.textContent = "Montando cortes sugeridos...";
  }
  if (els.renderButton) {
    els.renderButton.disabled = true;
    els.renderButton.textContent = "Preparando...";
  }
  if (els.selectAllCandidates) {
    els.selectAllCandidates.disabled = true;
    els.selectAllCandidates.checked = false;
    els.selectAllCandidates.indeterminate = false;
  }
  if (subtitleSettings) {
    const showSubtitleSettings = shouldShowCandidateSubtitleSettings(job, candidates);
    subtitleSettings.hidden = !showSubtitleSettings;
    subtitleSettings.innerHTML = showSubtitleSettings ? candidateSettingsSkeletonHtml() : "";
  }
  if (els.candidates) {
    delete els.candidates.dataset.renderKey;
    els.candidates.innerHTML = candidateSkeletonHtml(candidates.length);
  }
}

function renderCandidatesNow(job) {
  const candidates = Array.isArray(job?.candidates) ? job.candidates : [];
  const subtitleSettings = candidateSubtitleSettingsElement();
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
    if (subtitleSettings) {
      subtitleSettings.innerHTML = "";
      subtitleSettings.hidden = true;
    }
    syncSelectAllCandidates(job);
    return;
  }

  els.candidatesMeta.textContent = `${candidates.length} cortes sugeridos. Selecione os melhores.`;
  const selectionLocked = isCandidateSelectionLocked(job);
  const cards = candidates
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
  if (subtitleSettings) {
    const showSubtitleSettings = shouldShowCandidateSubtitleSettings(job, candidates);
    subtitleSettings.hidden = !showSubtitleSettings;
    subtitleSettings.innerHTML = showSubtitleSettings ? candidateSubtitleSettingsHtml(candidates) : "";
  }
  els.candidates.innerHTML = `<div class="clipper-candidate-list">${cards}</div>`;
  syncCandidateSelectionState(job);
}

function candidateSubtitleSettingsHtml(candidates) {
  const candidate = globalSubtitlePreviewCandidate(candidates);
  const previewOutput = {
    id: GLOBAL_SUBTITLE_PREVIEW_ID,
    subtitle_style: "standard",
    subtitle_text_color: "white",
    subtitle_border_color: "black",
    subtitle_size: "medium",
    subtitle_position: "bottom",
    subtitle_preview_text: candidateSubtitlePreviewText(candidate),
    subtitle_preview_title: "Legenda padrão dos cortes",
    subtitle_preview_hint: "Aplicada aos clipes selecionados na renderização",
  };
  return `
    <section class="candidate-subtitle-settings">
      <div class="candidate-render-settings">
        <span class="candidate-render-title">Formato do corte</span>
        <div id="podcast-candidate-clip-format" class="clip-format-options" role="radiogroup" aria-label="Formato do corte">
          ${clipFormatOptionsHtml("auto")}
        </div>
      </div>
      ${subtitleColorPreviewHtml(previewOutput, candidatePreviewFrameUrl(candidate))}
    </section>
  `;
}

function clipFormatOptionsHtml(selectedValue = "auto") {
  return CLIP_FORMAT_OPTIONS.map((option) => {
    const checked = option.value === selectedValue ? " checked" : "";
    const iconHtml = option.icon
      ? `<img src="${escapeHtml(option.icon)}" alt="" loading="lazy" />`
      : `<span class="clip-format-auto-icon">Auto</span>`;
    return `
      <label class="clip-format-option">
        <input type="radio" name="podcast-candidate-clip-format" value="${escapeHtml(option.value)}"${checked} />
        <span class="clip-format-icon">${iconHtml}</span>
        <span class="clip-format-copy">
          <strong>${escapeHtml(option.ratio)}</strong>
          <small>${escapeHtml(option.label)}</small>
          <em>${escapeHtml(option.hint)}</em>
        </span>
      </label>
    `;
  }).join("");
}

function globalSubtitlePreviewCandidate(candidates = state.job?.candidates || []) {
  const selected = new Set(selectedCandidateIds());
  return (
    candidates.find((candidate) => selected.has(String(candidate?.id || ""))) ||
    candidates.find((candidate) => candidate?.preview_frame_url || candidate?.preview_frame_path) ||
    candidates[0] ||
    null
  );
}

function candidatePreviewFrameUrl(candidate) {
  return cacheBustedUrl(candidate?.preview_frame_url || candidate?.preview_frame || "", state.job?.updated_at);
}

function candidateSubtitlePreviewText(candidate) {
  return String(candidate?.hook || candidate?.title || "você tem que sair cedo").trim();
}

function updateGlobalSubtitlePreviewCandidate() {
  const group = document.querySelector(`[data-subtitle-style-group="${CSS.escape(GLOBAL_SUBTITLE_PREVIEW_ID)}"]`);
  if (!group) return;
  const candidate = globalSubtitlePreviewCandidate();
  const frameUrl = candidatePreviewFrameUrl(candidate);
  const previewText = candidateSubtitlePreviewText(candidate);
  group.dataset.subtitlePreviewText = previewText;
  const style = normalizeSubtitleStyleValue(group.dataset.subtitleStyle || "standard");
  group.querySelectorAll(".subtitle-color-frame").forEach((frame) => {
    const image = frame.querySelector("img");
    const placeholder = frame.querySelector(".subtitle-color-frame-placeholder");
    if (frameUrl && image) {
      image.src = frameUrl;
    } else if (frameUrl && placeholder) {
      placeholder.outerHTML = `<img src="${escapeHtml(frameUrl)}" alt="" loading="lazy" />`;
    }
  });
  group.querySelectorAll(".subtitle-color-frame strong").forEach((label) => {
    label.textContent = subtitleAppearancePreviewTextForStyle(style, previewText);
  });
}

function selectedCandidateIds() {
  return [...els.candidates.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function selectedClipFormat() {
  return document.querySelector("input[name='podcast-candidate-clip-format']:checked")?.value || "auto";
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
  return coverTitleText(value).toUpperCase();
}

function coverTitleText(value) {
  return String(value || "CAPA DO CORTE")
    .replace(/\s*\(editado\)\s*$/gi, "")
    .trim() || "CAPA DO CORTE";
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
    state.outputRenderToken += 1;
    if (els.outputs) delete els.outputs.dataset.renderKey;
    renderOutputsNow(job);
    return;
  }

  const renderKey = outputRenderKey(job, outputs);
  if (els.outputs?.dataset.renderKey === renderKey) {
    if (els.youtubeUploadAllButton) els.youtubeUploadAllButton.disabled = !state.youtubeAuthorized;
    return;
  }

  const token = ++state.outputRenderToken;
  showOutputRenderLoader(outputs.length);
  runAfterLoaderPaint(() => {
    if (token !== state.outputRenderToken) return;
    if (job?.id && state.job?.id && job.id !== state.job.id) return;
    renderOutputsNow(job);
    if (els.outputs) els.outputs.dataset.renderKey = renderKey;
  });
}

function outputRenderKey(job, outputs) {
  const expanded = [...state.expandedOutputs].sort().join(",");
  const tabs = [...state.outputTabs.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([id, tab]) => `${id}:${tab}`)
    .join(",");
  return [
    job?.id || "",
    job?.status || "",
    job?.updated_at || "",
    state.youtubeAuthorized ? "yt" : "no-yt",
    expanded,
    tabs,
    outputs
      .map((output) => [
        output?.id,
        output?.title,
        output?.description,
        output?.hashtags,
        output?.video_url,
        output?.cover_updated_at,
        output?.metadata_edited_at,
        output?.subtitle_edited_at,
        output?.timeline_updated_at,
        output?.clip_format,
        output?.youtube_uploaded_at,
        Array.isArray(output?.cover_options) ? output.cover_options.length : 0,
      ].join(":"))
      .join("|"),
  ].join("::");
}

function outputSkeletonHtml(count = 3) {
  const total = Math.min(Math.max(Number(count || 3), 1), 6);
  return `
    <div class="clipper-ui-loader">
      <span class="clipper-loader-spinner" aria-hidden="true"></span>
      <strong>Preparando cortes renderizados</strong>
    </div>
    <div class="clipper-output-list is-loading-list" aria-hidden="true">
      ${Array.from({ length: total }).map(() => `
        <div class="clipper-output-card clipper-skeleton-output">
          <span class="clipper-skeleton-video"></span>
          <div class="clipper-output-copy">
            <span class="clipper-skeleton-line is-title"></span>
            <span class="clipper-skeleton-line"></span>
            <span class="clipper-skeleton-line is-mid"></span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function showOutputRenderLoader(count) {
  if (els.outputsMeta) {
    els.outputsMeta.textContent = "Montando cortes renderizados...";
  }
  if (els.youtubeUploadAllButton) els.youtubeUploadAllButton.disabled = true;
  if (els.downloadThumbnailsButton) els.downloadThumbnailsButton.disabled = true;
  if (els.downloadSubtitlesButton) els.downloadSubtitlesButton.disabled = true;
  if (els.outputs) {
    delete els.outputs.dataset.renderKey;
    els.outputs.innerHTML = outputSkeletonHtml(count);
  }
}

function renderOutputsNow(job) {
  const outputs = Array.isArray(job?.outputs) ? job.outputs : [];
  if (!outputs.length) {
    els.outputsMeta.textContent = "Renderize cortes para ver seus cortes prontos.";
    els.outputs.innerHTML = '<div class="empty-state">Nenhum corte renderizado ainda.</div>';
    els.youtubeUploadAllButton.disabled = true;
    if (els.downloadThumbnailsButton) els.downloadThumbnailsButton.disabled = true;
    if (els.downloadSubtitlesButton) els.downloadSubtitlesButton.disabled = true;
    return;
  }
  els.outputsMeta.textContent = `${outputs.length} corte(s) pronto(s) para revisar.`;
  els.youtubeUploadAllButton.disabled = !state.youtubeAuthorized;
  if (els.downloadThumbnailsButton) els.downloadThumbnailsButton.disabled = false;
  if (els.downloadSubtitlesButton) {
    els.downloadSubtitlesButton.disabled = !outputs.some(
      (output) => output?.subtitle_url || output?.subtitle_path || output?.subtitle_key || output?.r2_subtitle_key,
    );
  }
  const candidatesById = new Map((job?.candidates || []).map((candidate) => [candidate.id, candidate]));
  els.outputs.innerHTML = outputs
    .map(
      (output, index) => {
        const candidate = candidatesById.get(output.id) || {};
        const title = output.title || candidate.title || `Corte ${index + 1}`;
        const description = outputDescription(output, candidate, title);
        const tags = outputTagsForDisplay(output, title, description);
        const coverTitle = coverTitleText(output.cover_title || title);
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
        const subtitleStyleLabel =
          output.subtitle_style === "word" ? "Uma palavra por vez" : "Blocos";
        const subtitleTextColorLabel = subtitleColorLabel(output.subtitle_text_color || "white");
        const subtitleBorderColorLabel = subtitleColorLabel(output.subtitle_border_color || "black");
        const subtitleSizeLabel = subtitleSizeLabelFor(output.subtitle_size || "medium");
        const subtitlePositionLabel = subtitlePositionLabelFor(output.subtitle_position || "middle");
        const canDeleteOutput = Boolean(output.edited_from);
        const outputId = String(output.id || "");
        const detailsExpanded = state.expandedOutputs.has(outputId);
        const publishAtValue = datetimeLocalValue(output.youtube_publish_at || output.publish_at || "");
        const publishAtMin = minimumPublishAtLocalValue();
        const youtubeUploaded = Boolean(output.youtube_uploaded || output.youtube_video_id);
        const youtubeButtonLabel = youtubeUploaded ? "Enviar novamente" : "Enviar ao YouTube";
        const outputPrivacy = output.youtube_privacy_status || els.youtubePrivacy?.value || "private";
        const outputCategory = output.youtube_category_id || output.category_id || els.youtubeCategory?.value || "";
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
                  : `<div class="clipper-output-placeholder">Prévia do corte</div>`
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
          ${renderOutputCopyHtml({
            output,
            outputs,
            title,
            description,
            tags,
            coverTitle,
            coverTemplate,
            coverTextPosition,
            hasFramePreviews,
            videoUrl,
            coverUrl,
            previewFrameUrl,
            burnSubtitles,
            canDeleteOutput,
            publishAtValue,
            publishAtMin,
            youtubeUploaded,
            youtubeButtonLabel,
            outputPrivacy,
            outputCategory,
          })}
          <!-- Legacy output layout removed from the UI after tabbed layout migration.
            <dl class="output-metadata output-metadata-primary">
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
            </dl>
            <button
              type="button"
              class="secondary-button output-details-toggle"
              data-output-details-toggle="${escapeHtml(output.id)}"
              aria-expanded="${detailsExpanded ? "true" : "false"}"
            >
              ${detailsExpanded ? "Esconder" : "Mostrar mais"}
            </button>
            <div class="output-details" data-output-details="${escapeHtml(output.id)}" ${detailsExpanded ? "" : "hidden"}>
              ${coverOptionsHtml(output)}
              ${coverCustomizationHtml(output, coverTemplate, coverTextPosition, hasFramePreviews)}
              <dl class="output-metadata">
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
                <dt><label for="podcast-youtube-publish-at-${escapeHtml(output.id)}">Agendar publicação</label></dt>
                <dd>
                  <input
                    id="podcast-youtube-publish-at-${escapeHtml(output.id)}"
                    class="output-edit-input"
                    data-youtube-publish-at="${escapeHtml(output.id)}"
                    type="datetime-local"
                    min="${escapeHtml(publishAtMin)}"
                    value="${escapeHtml(publishAtValue)}"
                  />
                  <div class="helper">Vazio envia agora. Com horário preenchido, o YouTube publica automaticamente no horário escolhido.</div>
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
                <dd>${burnSubtitles ? `Aplicada ao vídeo (${escapeHtml(subtitleStyleLabel)} · ${escapeHtml(subtitleSizeLabel)} · ${escapeHtml(subtitlePositionLabel)} · letra ${escapeHtml(subtitleTextColorLabel)} · borda ${escapeHtml(subtitleBorderColorLabel)}) + arquivo de legenda disponível` : "Vídeo sem legenda aplicada + arquivo de legenda disponível"}</dd>
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
                    <span>Tempo total do corte</span>
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
                  <span data-range-duration-label="${escapeHtml(output.id)}">Tempo total do corte: ${escapeHtml(formatMilliseconds(output.duration || 0))}</span>
                  <span data-range-end-label="${escapeHtml(output.id)}">Fim: ${escapeHtml(formatMilliseconds(output.duration || 0))}</span>
                </div>
              </div>
              ${subtitleColorPreviewHtml(output, previewFrameUrl)}
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
              <div class="helper">
                A exportação cria uma nova versão e mantém este clipe original intacto.
              </div>
              </div>
              <div class="output-actions">
              <button
                type="button"
                class="secondary-button youtube-upload-button"
                data-output-id="${escapeHtml(output.id)}"
                data-uploaded="${youtubeUploaded ? "true" : "false"}"
                ${state.youtubeAuthorized ? "" : "disabled"}
              >
                ${escapeHtml(youtubeButtonLabel)}
              </button>
              <button type="button" class="secondary-button" data-subtitle-toggle="${escapeHtml(output.id)}" hidden>
                Editar legenda
              </button>
              <button type="button" class="secondary-button" data-subtitle-save="${escapeHtml(output.id)}" hidden>
                Salvar alterações no clipe atual
              </button>
              <button
                type="button"
                class="secondary-button"
                data-subtitle-mode="${escapeHtml(output.id)}"
                data-burn-subtitles="${burnSubtitles ? "false" : "true"}"
              >
                ${burnSubtitles ? "Salvar clipe sem legenda" : "Salvar clipe com legenda"}
              </button>
              <button type="button" class="secondary-button" data-edit-toggle="${escapeHtml(output.id)}">Editar corte</button>
              <button type="button" class="secondary-button" data-edit-save="${escapeHtml(output.id)}" hidden disabled>
                Recortar e salvar
              </button>
              ${
                canDeleteOutput
                  ? `<button type="button" class="secondary-button danger-button output-delete-button" data-output-delete="${escapeHtml(output.id)}">Excluir clipe</button>`
                  : ""
              }
              </div>
            </div>
          -->
        </article>
      `;
      }
    )
    .join("");
  for (const output of outputs) {
    const outputId = String(output?.id || "");
    if (outputId && state.outputTabs.get(outputId) === "edit") {
      loadEditPreviewVideo(outputId);
      syncClipRangeTimeline(outputId);
    }
  }
  syncActionLockControls();
}

function outputTabsHtml(outputId, activeTab = "metadata") {
  return OUTPUT_TABS.map(([tab, label], index) => `
    <button
      type="button"
      class="output-tab ${tab === activeTab ? "is-active" : ""}"
      role="tab"
      aria-selected="${tab === activeTab ? "true" : "false"}"
      data-output-tab="${escapeHtml(outputId)}"
      data-output-tab-target="${escapeHtml(tab)}"
    >
      ${escapeHtml(label)}
    </button>
  `).join("");
}

function selectOutputTab(outputId, tabName) {
  if (!outputId || !tabName) return;
  state.outputTabs.set(outputId, tabName);
  const tabs = els.outputs.querySelectorAll(`[data-output-tab="${CSS.escape(outputId)}"]`);
  const panels = els.outputs.querySelectorAll(`[data-output-tab-panel="${CSS.escape(outputId)}"]`);
  for (const tab of tabs) {
    const selected = tab.dataset.outputTabTarget === tabName;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", selected ? "true" : "false");
  }
  for (const panel of panels) {
    const selected = panel.dataset.outputTabName === tabName;
    panel.classList.toggle("is-active", selected);
    panel.hidden = !selected;
  }
  if (tabName === "edit") {
    loadEditPreviewVideo(outputId);
    syncClipRangeTimeline(outputId);
  }
}

function outputTabPanelAttrs(outputId, tabName, activeTab) {
  const active = tabName === activeTab;
  return `class="output-tab-panel ${active ? "is-active" : ""}" data-output-tab-panel="${escapeHtml(outputId)}" data-output-tab-name="${escapeHtml(tabName)}" ${active ? "" : "hidden"}`;
}

function renderOutputCopyHtml({
  output,
  outputs,
  title,
  description,
  tags,
  coverTitle,
  coverTemplate,
  coverTextPosition,
  hasFramePreviews,
  videoUrl,
  coverUrl,
  previewFrameUrl,
  burnSubtitles,
  canDeleteOutput,
  publishAtValue,
  publishAtMin,
  youtubeUploaded,
  youtubeButtonLabel,
  outputPrivacy,
  outputCategory,
}) {
  const outputId = String(output?.id || "");
  const activeTab = state.outputTabs.get(outputId) || "metadata";
  return `
    <div class="clipper-output-copy">
      <div class="output-tabs" role="tablist" aria-label="Configurações do clipe">
        ${outputTabsHtml(outputId, activeTab)}
      </div>
      <div class="output-tab-panels">
        ${metadataTabHtml({ output, title, description, tags, activeTab })}
        ${coverTabHtml({ output, title, coverTitle, coverTemplate, coverTextPosition, hasFramePreviews, activeTab })}
        ${subtitleTabHtml({ output, previewFrameUrl, burnSubtitles, activeTab })}
        ${editTabHtml({ output, outputs, videoUrl, coverUrl, canDeleteOutput, activeTab })}
        ${uploadTabHtml({ output, publishAtValue, publishAtMin, youtubeUploaded, youtubeButtonLabel, outputPrivacy, outputCategory, activeTab })}
      </div>
    </div>
  `;
}

function metadataTabHtml({ output, title, description, tags, activeTab }) {
  const outputId = String(output?.id || "");
  return `
    <section ${outputTabPanelAttrs(outputId, "metadata", activeTab)}>
      <dl class="output-metadata output-metadata-primary">
        <div>
          <dt><label for="podcast-youtube-title-${escapeHtml(outputId)}">Título</label></dt>
          <dd>
            <input
              id="podcast-youtube-title-${escapeHtml(outputId)}"
              class="output-edit-input"
              data-youtube-title="${escapeHtml(outputId)}"
              data-previous-title="${escapeHtml(title)}"
              maxlength="100"
              value="${escapeHtml(title)}"
            />
          </dd>
        </div>
        <div>
          <dt><label for="podcast-youtube-description-${escapeHtml(outputId)}">Descrição</label></dt>
          <dd>
            <textarea
              id="podcast-youtube-description-${escapeHtml(outputId)}"
              class="output-edit-textarea"
              data-youtube-description="${escapeHtml(outputId)}"
              rows="4"
            >${escapeHtml(description)}</textarea>
          </dd>
        </div>
        <div>
          <dt><label for="podcast-youtube-tags-${escapeHtml(outputId)}">Hashtags</label></dt>
          <dd>
            <input
              id="podcast-youtube-tags-${escapeHtml(outputId)}"
              class="output-edit-input"
              data-youtube-tags="${escapeHtml(outputId)}"
              value="${escapeHtml(tags.join(" "))}"
            />
          </dd>
        </div>
        <div class="output-metadata-save">
          <dt>Alterações</dt>
          <dd>
            <button type="button" class="secondary-button" data-metadata-save="${escapeHtml(outputId)}">
              Salvar alterações
            </button>
          </dd>
        </div>
      </dl>
    </section>
  `;
}

function coverTabHtml({ output, title, coverTitle, coverTemplate, coverTextPosition, hasFramePreviews, activeTab }) {
  const outputId = String(output?.id || "");
  return `
    <section ${outputTabPanelAttrs(outputId, "cover", activeTab)}>
      ${coverOptionsHtml(output)}
      ${coverCustomizationHtml(output, coverTemplate, coverTextPosition, hasFramePreviews)}
      <dl class="output-metadata">
        <div>
          <dt><label for="podcast-cover-title-${escapeHtml(outputId)}">Texto da capa</label></dt>
          <dd>
            <input
              id="podcast-cover-title-${escapeHtml(outputId)}"
              class="output-edit-input"
              data-cover-title="${escapeHtml(outputId)}"
              data-manually-edited="${output.cover_title && output.cover_title !== title ? "true" : "false"}"
              maxlength="80"
              value="${escapeHtml(coverTitle)}"
            />
            <div class="helper">Texto curto usado nas miniaturas.</div>
          </dd>
        </div>
        <div class="output-metadata-save">
          <dt>Alterações</dt>
          <dd>
            <button type="button" class="secondary-button" data-metadata-save="${escapeHtml(outputId)}">
              Salvar alterações
            </button>
          </dd>
        </div>
      </dl>
    </section>
  `;
}

function subtitleTabHtml({ output, previewFrameUrl, burnSubtitles, activeTab }) {
  const outputId = String(output?.id || "");
  return `
    <section ${outputTabPanelAttrs(outputId, "subtitle", activeTab)}>
      <div class="output-tab-actions subtitle-primary-actions">
        <button type="button" class="secondary-button subtitle-edit-button" data-subtitle-toggle="${escapeHtml(outputId)}">
          Editar legenda
        </button>
      </div>
      <div class="subtitle-editor" data-subtitle-panel="${escapeHtml(outputId)}" hidden>
        <label for="podcast-subtitle-${escapeHtml(outputId)}">Editar legenda</label>
        <div
          id="podcast-subtitle-${escapeHtml(outputId)}"
          class="subtitle-template"
          data-subtitle-editor="${escapeHtml(outputId)}"
        ></div>
      </div>
      ${subtitleColorPreviewHtml(output, previewFrameUrl)}
      <div class="output-tab-actions">
        <button type="button" class="secondary-button" data-subtitle-save="${escapeHtml(outputId)}">
          Salvar alterações
        </button>
        <button
          type="button"
          class="secondary-button"
          data-subtitle-mode="${escapeHtml(outputId)}"
          data-burn-subtitles="${burnSubtitles ? "false" : "true"}"
        >
          ${burnSubtitles ? "Salvar clipe sem legenda" : "Salvar clipe com legenda"}
        </button>
      </div>
    </section>
  `;
}

function editTabHtml({ output, outputs, canDeleteOutput, activeTab }) {
  const outputId = String(output?.id || "");
  return `
    <section ${outputTabPanelAttrs(outputId, "edit", activeTab)}>
      <div class="clip-editor" data-edit-panel="${escapeHtml(outputId)}">
        ${clipEditorInnerHtml(output, outputs, canDeleteOutput)}
      </div>
    </section>
  `;
}

function clipEditorInnerHtml(output, outputs, canDeleteOutput = false) {
  const outputId = String(output?.id || "");
  const duration = Math.max(0.001, Number(output?.duration || 0));
  const sourceStart = Math.max(0, Number(output?.start || 0));
  const sourceEnd = Math.max(sourceStart, Number(output?.end || sourceStart));
  const sourceDuration = Number(state.job?.source_metadata?.duration || 0);
  const canRecover = Boolean(state.job?.source_file && sourceEnd > sourceStart);
  const recoverBeforeMax = Math.max(0, sourceStart);
  const recoverAfterMax = sourceDuration > sourceEnd ? Math.max(0, sourceDuration - sourceEnd) : null;
  const recoverDisabled = canRecover ? "" : "disabled";
  const recoverAfterMaxAttr = recoverAfterMax == null ? "" : `max="${escapeHtml(recoverAfterMax.toFixed(3))}"`;
  return `
    <div class="clip-editor-preview">
      <div class="clip-editor-video-frame">
        <video
          controls
          playsinline
          preload="metadata"
          poster="${escapeHtml(outputCoverUrl(output))}"
          data-src="${escapeHtml(output.video_url || "")}"
          data-edit-preview="${escapeHtml(outputId)}"
        ></video>
        <div class="clip-editor-loader" data-edit-loader="${escapeHtml(outputId)}" hidden>
          <span>Preparando vídeo...</span>
        </div>
      </div>
      <div class="clip-editor-time-panel">
        <div>
          <span>Tempo atual</span>
          <strong data-preview-current="${escapeHtml(outputId)}">0.000s</strong>
        </div>
        <div>
          <span>Início</span>
          <strong data-preview-start="${escapeHtml(outputId)}">0.000s</strong>
        </div>
        <div>
          <span>Fim</span>
          <strong data-preview-end="${escapeHtml(outputId)}">${escapeHtml(formatSeconds(duration))}</strong>
        </div>
        <div>
          <span>Tempo total do corte</span>
          <strong data-preview-selected="${escapeHtml(outputId)}">${escapeHtml(formatSeconds(duration))}</strong>
        </div>
      </div>
    </div>
    <div class="clip-editor-grid">
      <div class="field">
        <label for="podcast-edit-start-${escapeHtml(outputId)}">Início do corte</label>
        <input
          id="podcast-edit-start-${escapeHtml(outputId)}"
          class="output-edit-input"
          data-edit-start="${escapeHtml(outputId)}"
          type="number"
          min="0"
          max="${escapeHtml(duration.toFixed(3))}"
          step="0.001"
          value="0.000"
        />
      </div>
      <div class="field">
        <label for="podcast-edit-end-${escapeHtml(outputId)}">Fim do corte</label>
        <input
          id="podcast-edit-end-${escapeHtml(outputId)}"
          class="output-edit-input"
          data-edit-end="${escapeHtml(outputId)}"
          type="number"
          min="0.1"
          max="${escapeHtml(duration.toFixed(3))}"
          step="0.001"
          value="${escapeHtml(duration.toFixed(3))}"
        />
      </div>
      <div class="field">
        <label for="podcast-recover-before-${escapeHtml(outputId)}">Recuperar antes (s)</label>
        <input
          id="podcast-recover-before-${escapeHtml(outputId)}"
          class="output-edit-input"
          data-recover-before="${escapeHtml(outputId)}"
          type="number"
          min="0"
          max="${escapeHtml(recoverBeforeMax.toFixed(3))}"
          step="0.001"
          value="0.000"
          ${recoverDisabled}
        />
      </div>
      <div class="field">
        <label for="podcast-recover-after-${escapeHtml(outputId)}">Recuperar depois (s)</label>
        <input
          id="podcast-recover-after-${escapeHtml(outputId)}"
          class="output-edit-input"
          data-recover-after="${escapeHtml(outputId)}"
          type="number"
          min="0"
          ${recoverAfterMaxAttr}
          step="0.001"
          value="0.000"
          ${recoverDisabled}
        />
      </div>
    </div>
    <div class="clip-range-timeline" data-range-timeline="${escapeHtml(outputId)}" data-duration="${escapeHtml(duration)}">
      ${clipRangeRulerHtml(outputId, duration)}
      <div class="clip-range-track" data-range-track="${escapeHtml(outputId)}">
        <div class="clip-range-selection" data-range-selection="${escapeHtml(outputId)}" style="left: 0%; right: 0%"></div>
        <div class="clip-range-playhead" data-range-playhead="${escapeHtml(outputId)}" style="left: 0%"></div>
        <button
          type="button"
          class="clip-range-handle clip-range-handle-start"
          data-range-handle="${escapeHtml(outputId)}"
          data-handle-kind="start"
          style="left: 0%"
          aria-label="Arrastar início do corte"
        ></button>
        <button
          type="button"
          class="clip-range-handle clip-range-handle-end"
          data-range-handle="${escapeHtml(outputId)}"
          data-handle-kind="end"
          style="left: 100%"
          aria-label="Arrastar fim do corte"
        ></button>
      </div>
      <div class="clip-range-readout">
        <span data-range-start-label="${escapeHtml(outputId)}">Início: 0 ms</span>
        <span data-range-duration-label="${escapeHtml(outputId)}">Tempo total do corte: ${escapeHtml(formatMilliseconds(duration))}</span>
        <span data-range-end-label="${escapeHtml(outputId)}">Fim: ${escapeHtml(formatMilliseconds(duration))}</span>
      </div>
    </div>
    ${editMediaSelectorHtml(output, outputs)}
    <div class="helper">
      ${
        canRecover
          ? "Arraste as extremidades para cortar. Use recuperação para puxar segundos do vídeo original antes ou depois do clipe."
          : "Arraste as extremidades para cortar. Recuperar segundos exige o vídeo original do projeto."
      }
    </div>
    <div class="output-tab-actions">
      <button type="button" class="secondary-button" data-edit-save="${escapeHtml(outputId)}" disabled>
        Recortar e salvar
      </button>
      ${
        canDeleteOutput
          ? `<button type="button" class="secondary-button danger-button output-delete-button" data-output-delete="${escapeHtml(outputId)}">Excluir clipe</button>`
          : ""
      }
    </div>
  `;
}

function editMediaSelectorHtml(output, outputs = []) {
  const outputId = String(output?.id || "");
  const availableOutputs = (outputs || []).filter(
    (item) => item?.id && item?.video_url && String(item.id) !== outputId,
  );
  if (!availableOutputs.length) {
    return `
      <section class="clip-editor-media-picker">
        <div class="clip-editor-media-header">
          <strong>Mídias do projeto</strong>
          <span>Renderize mais cortes para complementar este vídeo.</span>
        </div>
      </section>
    `;
  }
  return `
    <section class="clip-editor-media-picker" data-edit-media-picker="${escapeHtml(outputId)}">
      <div class="clip-editor-media-header">
        <strong>Mídias do projeto</strong>
        <span>Escolha um corte para adicionar antes ou depois deste vídeo.</span>
      </div>
      <input type="hidden" data-edit-append="${escapeHtml(outputId)}" value="" />
      <input type="hidden" data-edit-position="${escapeHtml(outputId)}" value="after" />
      <div class="clip-editor-media-position" data-edit-media-position-group="${escapeHtml(outputId)}">
        <button type="button" data-edit-media-position="${escapeHtml(outputId)}" data-position="before" disabled>
          Antes
        </button>
        <button type="button" data-edit-media-position="${escapeHtml(outputId)}" data-position="after" data-selected="true" disabled>
          Depois
        </button>
        <button type="button" data-edit-media-clear="${escapeHtml(outputId)}" disabled>
          Não complementar
        </button>
      </div>
      <div class="clip-editor-media-list">
        ${availableOutputs.map((item, index) => {
          const title = item.title || `Corte ${index + 1}`;
          const posterUrl = outputPreviewFrameUrl(item);
          return `
            <button
              type="button"
              class="clip-editor-media-card"
              data-edit-media-option="${escapeHtml(outputId)}"
              data-edit-media-id="${escapeHtml(item.id)}"
              data-selected="false"
            >
              ${
                posterUrl
                  ? `<img src="${escapeHtml(posterUrl)}" alt="" loading="lazy" />`
                  : `<span class="clip-editor-media-placeholder"></span>`
              }
              <span>
                <strong>${escapeHtml(title)}</strong>
                <small>${escapeHtml(formatSeconds(item.duration || 0))}</small>
              </span>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function clipRangeRulerHtml(outputId, duration) {
  const total = Math.max(0.001, Number(duration || 0));
  const interval = timelineRulerInterval(total);
  const ticks = [];
  for (let time = 0; time <= total + 0.001; time += interval) {
    ticks.push(Math.min(time, total));
  }
  if (!ticks.length || ticks[ticks.length - 1] < total - 0.001) ticks.push(total);
  return `
    <div
      class="clip-range-ruler"
      data-range-ruler="${escapeHtml(outputId)}"
      role="slider"
      tabindex="0"
      aria-label="Navegar pelo vídeo"
      aria-valuemin="0"
      aria-valuemax="${escapeHtml(total.toFixed(3))}"
      aria-valuenow="0"
    >
      <div class="clip-range-ruler-line"></div>
      <div class="clip-range-ruler-playhead" data-range-ruler-playhead="${escapeHtml(outputId)}" style="left: 0%"></div>
      ${ticks.map((time) => {
        const left = Math.max(0, Math.min(100, (time / total) * 100));
        return `
          <span class="clip-range-tick" style="left: ${left}%">
            <strong>${escapeHtml(formatRangeRulerLabel(time))}</strong>
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function formatRangeRulerLabel(value) {
  const seconds = Math.max(0, Number(value || 0));
  if (seconds >= 60) return formatTime(seconds);
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function timelineAssetsHtml(outputId, project) {
  return (project.assets || []).map((asset) => `
    <article class="nle-asset-card">
      ${
        asset.posterUrl
          ? `<img src="${escapeHtml(asset.posterUrl)}" alt="" loading="lazy" />`
          : `<span class="nle-asset-placeholder"></span>`
      }
      <div>
        <strong>${escapeHtml(asset.name || "Asset")}</strong>
        <span>${escapeHtml(formatSeconds(asset.duration || 0))}</span>
      </div>
      <button
        type="button"
        class="secondary-button"
        data-nle-insert="${escapeHtml(outputId)}"
        data-nle-asset-id="${escapeHtml(asset.id)}"
        onclick="event.preventDefault(); event.stopPropagation(); window.flixoTimelineInsert?.(this.dataset.nleInsert, this.dataset.nleAssetId); return false;"
      >
        Inserir no cursor
      </button>
    </article>
  `).join("");
}

function timelineTrackHtml(outputId, project) {
  const duration = timelineVisualDuration(project);
  const projectDuration = Math.max(0.1, timelineProjectDuration(project));
  const playheadPercent = timelinePlayheadPercent(project, duration);
  const clips = timelineVideoClips(project);
  return `
    <div class="nle-timeline" data-nle-timeline="${escapeHtml(outputId)}" data-duration="${escapeHtml(duration)}">
      ${timelineRulerHtml(outputId, duration)}
      <div class="nle-track" data-nle-track="${escapeHtml(outputId)}">
        <div class="clip-range-playhead nle-playhead" data-nle-playhead="${escapeHtml(outputId)}" style="left: ${playheadPercent}%"></div>
        <button
          type="button"
          class="nle-playhead-split"
          data-nle-split="${escapeHtml(outputId)}"
          style="left: ${playheadPercent}%"
          title="Cortar no cursor"
          aria-label="Cortar no cursor"
          onclick="event.preventDefault(); event.stopPropagation(); window.flixoTimelineSplit?.(this.dataset.nleSplit); return false;"
        >
          <span aria-hidden="true">✂</span>
        </button>
        ${clips.map((clip, index) => timelineClipHtml(outputId, project, clip, index, duration)).join("")}
      </div>
      <button type="button" class="nle-audio-lane" data-nle-audio-add="${escapeHtml(outputId)}">
        <span aria-hidden="true">♬</span>
        Adicionar áudio
      </button>
      <div class="clip-range-readout">
        <span>Cursor: ${escapeHtml(formatMilliseconds(project.playhead || 0))}</span>
        <span>${clips.length} trecho(s)</span>
        <span>Total: ${escapeHtml(formatMilliseconds(projectDuration))}</span>
      </div>
    </div>
  `;
}

function timelineClipHtml(outputId, project, clip, index, totalDuration) {
  const asset = timelineAssetById(project, clip.assetId);
  const selected = state.timelineSelections.get(outputId) === clip.id;
  return `
    <div
      role="button"
      tabindex="0"
      class="nle-clip"
      data-nle-clip="${escapeHtml(outputId)}"
      data-nle-clip-id="${escapeHtml(clip.id)}"
      data-selected="${selected ? "true" : "false"}"
      style="${timelineClipVisualStyle(project, clip, totalDuration)}"
      title="${escapeHtml(asset?.name || `Trecho ${index + 1}`)}"
    >
      <span
        class="nle-clip-trim-handle nle-clip-trim-handle-start"
        data-nle-trim-handle="${escapeHtml(outputId)}"
        data-nle-clip-id="${escapeHtml(clip.id)}"
        data-nle-trim-kind="start"
        aria-hidden="true"
      ></span>
      <strong>${escapeHtml(asset?.name || `Trecho ${index + 1}`)}</strong>
      <span data-nle-clip-duration="${escapeHtml(clip.id)}">${escapeHtml(formatSeconds(clip.duration))}</span>
      <span
        class="nle-clip-trim-handle nle-clip-trim-handle-end"
        data-nle-trim-handle="${escapeHtml(outputId)}"
        data-nle-clip-id="${escapeHtml(clip.id)}"
        data-nle-trim-kind="end"
        aria-hidden="true"
      ></span>
    </div>
  `;
}

function timelineRulerHtml(outputId, duration) {
  const total = Math.max(0.1, Number(duration || 0));
  const interval = timelineRulerInterval(total);
  const ticks = [];
  for (let time = 0; time <= total + 0.001; time += interval) {
    ticks.push(Math.min(time, total));
  }
  if (ticks[ticks.length - 1] < total) ticks.push(total);
  return `
    <div
      class="nle-time-ruler"
      data-nle-ruler="${escapeHtml(outputId)}"
      role="slider"
      tabindex="0"
      aria-label="Navegar pela timeline"
      aria-valuemin="0"
      aria-valuemax="${escapeHtml(total)}"
    >
      ${ticks.map((time, index) => {
        const left = Math.max(0, Math.min(100, (time / total) * 100));
        const label = index === 0 ? "0,0s" : `${time.toFixed(1).replace(".", ",")}s`;
        return `
          <span class="nle-time-tick" style="left: ${left}%">
            <strong>${escapeHtml(label)}</strong>
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function timelineRulerInterval(duration) {
  if (duration <= 12) return 4;
  if (duration <= 30) return 5;
  if (duration <= 90) return 10;
  return 30;
}

function timelineClipInspectorHtml(outputId, clip, asset) {
  return `
    <div class="nle-clip-inspector">
      <div class="field">
        <label for="nle-source-in-${escapeHtml(outputId)}">Entrada no asset</label>
        <input
          id="nle-source-in-${escapeHtml(outputId)}"
          class="output-edit-input"
          data-nle-source-in="${escapeHtml(outputId)}"
          type="number"
          min="0"
          step="0.001"
          value="${escapeHtml(Number(clip.sourceIn || 0).toFixed(3))}"
        />
      </div>
      <div class="field">
        <label for="nle-source-out-${escapeHtml(outputId)}">Saída no asset</label>
        <input
          id="nle-source-out-${escapeHtml(outputId)}"
          class="output-edit-input"
          data-nle-source-out="${escapeHtml(outputId)}"
          type="number"
          min="0.1"
          max="${escapeHtml(Number(asset?.duration || clip.sourceOut || 0).toFixed(3))}"
          step="0.001"
          value="${escapeHtml(Number(clip.sourceOut || 0).toFixed(3))}"
        />
      </div>
    </div>
  `;
}

function uploadTabHtml({ output, publishAtValue, publishAtMin, youtubeUploaded, youtubeButtonLabel, outputPrivacy, outputCategory, activeTab }) {
  const outputId = String(output?.id || "");
  return `
    <section ${outputTabPanelAttrs(outputId, "upload", activeTab)}>
      <dl class="output-metadata">
        <div>
          <dt><label for="podcast-youtube-privacy-${escapeHtml(outputId)}">Visibilidade</label></dt>
          <dd>
            <select id="podcast-youtube-privacy-${escapeHtml(outputId)}" data-youtube-privacy-output="${escapeHtml(outputId)}">
              <option value="private" ${outputPrivacy === "private" ? "selected" : ""}>Privado</option>
              <option value="unlisted" ${outputPrivacy === "unlisted" ? "selected" : ""}>Não listado</option>
              <option value="public" ${outputPrivacy === "public" ? "selected" : ""}>Público</option>
            </select>
          </dd>
        </div>
        <div>
          <dt><label for="podcast-youtube-category-${escapeHtml(outputId)}">Categoria</label></dt>
          <dd>
            <select id="podcast-youtube-category-${escapeHtml(outputId)}" data-youtube-category-output="${escapeHtml(outputId)}">
              ${youtubeCategoryOptionsHtml(outputCategory)}
            </select>
          </dd>
        </div>
        <div>
          <dt><label for="podcast-youtube-publish-at-${escapeHtml(outputId)}">Agendar publicação</label></dt>
          <dd>
            <input
              id="podcast-youtube-publish-at-${escapeHtml(outputId)}"
              class="output-edit-input"
              data-youtube-publish-at="${escapeHtml(outputId)}"
              type="datetime-local"
              min="${escapeHtml(publishAtMin)}"
              value="${escapeHtml(publishAtValue)}"
            />
            <div class="helper">Vazio envia agora. Com horário preenchido, o YouTube publica automaticamente no horário escolhido.</div>
          </dd>
        </div>
      </dl>
      <div class="output-tab-actions">
        <button
          type="button"
          class="secondary-button youtube-upload-button"
          data-output-id="${escapeHtml(outputId)}"
          data-uploaded="${youtubeUploaded ? "true" : "false"}"
          ${state.youtubeAuthorized ? "" : "disabled"}
        >
          ${escapeHtml(youtubeButtonLabel)}
        </button>
      </div>
    </section>
  `;
}

function youtubeCategoryOptionsHtml(selectedCategory) {
  const selected = String(selectedCategory || "");
  return YOUTUBE_CATEGORY_OPTIONS.map(([value, label]) => `
    <option value="${escapeHtml(value)}" ${String(value) === selected ? "selected" : ""}>
      ${escapeHtml(label)}
    </option>
  `).join("");
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

function outputCandidate(outputId) {
  return (state.job?.candidates || []).find((candidate) => String(candidate?.id || "") === String(outputId)) || {};
}

function outputById(outputId) {
  return (state.job?.outputs || []).find((output) => String(output?.id || "") === String(outputId)) || null;
}

function outputAssetId(outputId) {
  return `asset-${String(outputId || "").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function timelineAssetFromOutput(output) {
  const outputId = String(output?.id || "");
  return {
    id: outputAssetId(outputId),
    type: "video",
    name: output?.title || `Corte ${outputId.slice(0, 6)}`,
    duration: Math.max(0.1, Number(output?.duration || 0)),
    sourceOutputId: outputId,
    videoUrl: cacheBustedUrl(output?.video_url || "", output?.subtitle_edited_at || output?.edited_at),
    subtitleUrl: output?.subtitle_url || "",
    posterUrl: outputPreviewFrameUrl(output),
  };
}

function timelineAssetsForOutputs(outputs) {
  return (outputs || [])
    .filter((output) => output?.id && output?.video_url && Number(output?.duration || 0) > 0)
    .map(timelineAssetFromOutput);
}

function createTimelineProjectFromOutput(output, outputs = state.job?.outputs || []) {
  const assets = timelineAssetsForOutputs(outputs);
  const outputId = String(output?.id || "");
  const primaryAsset = assets.find((asset) => asset.sourceOutputId === outputId) || timelineAssetFromOutput(output);
  const duration = Math.max(0.1, Number(primaryAsset.duration || output?.duration || 0));
  return recalculateTimelineStarts({
    version: 1,
    assets: mergeTimelineAssets([primaryAsset], assets),
    tracks: [
      {
        id: "v1",
        type: "video",
        clips: [
          {
            id: `clip-${outputId || Date.now()}`,
            assetId: primaryAsset.id,
            sourceIn: 0,
            sourceOut: duration,
            timelineStart: 0,
            duration,
          },
        ],
      },
    ],
    playhead: 0,
  });
}

function mergeTimelineAssets(existingAssets, projectAssets) {
  const map = new Map();
  for (const asset of [...(existingAssets || []), ...(projectAssets || [])]) {
    if (!asset?.id) continue;
    map.set(String(asset.id), {
      id: String(asset.id),
      type: asset.type || "video",
      name: asset.name || "Asset",
      duration: Math.max(0.1, Number(asset.duration || 0)),
      sourceOutputId: String(asset.sourceOutputId || asset.source_output_id || ""),
      videoUrl: asset.videoUrl || asset.video_url || "",
      subtitleUrl: asset.subtitleUrl || asset.subtitle_url || "",
      posterUrl: asset.posterUrl || asset.poster_url || "",
    });
  }
  return [...map.values()].filter((asset) => asset.sourceOutputId);
}

function normalizeTimelineProject(project, output, outputs = state.job?.outputs || []) {
  if (!project || typeof project !== "object") {
    return createTimelineProjectFromOutput(output, outputs);
  }
  const assets = mergeTimelineAssets(project.assets || [], timelineAssetsForOutputs(outputs));
  const assetIds = new Set(assets.map((asset) => asset.id));
  const tracks = Array.isArray(project.tracks) ? project.tracks : [];
  const videoTrack = tracks.find((track) => track?.type === "video") || tracks[0] || {};
  const clips = (Array.isArray(videoTrack.clips) ? videoTrack.clips : [])
    .filter((clip) => clip?.assetId && assetIds.has(String(clip.assetId)))
    .map((clip, index) => {
      const asset = assets.find((item) => item.id === String(clip.assetId));
      const assetDuration = Math.max(0.1, Number(asset?.duration || 0));
      const sourceIn = Math.max(0, Math.min(Number(clip.sourceIn || 0), Math.max(0, assetDuration - 0.1)));
      const sourceOut = Math.max(sourceIn + 0.1, Math.min(Number(clip.sourceOut || assetDuration), assetDuration));
      return {
        id: String(clip.id || `clip-${index + 1}-${Date.now()}`),
        assetId: String(clip.assetId),
        sourceIn,
        sourceOut,
        timelineStart: Math.max(0, Number(clip.timelineStart || 0)),
        duration: Math.max(0.1, sourceOut - sourceIn),
      };
    });

  if (!clips.length) {
    return createTimelineProjectFromOutput(output, outputs);
  }

  return recalculateTimelineStarts({
    version: 1,
    assets,
    tracks: [{ id: "v1", type: "video", clips }],
    playhead: Math.max(0, Number(project.playhead || 0)),
  });
}

function timelineProjectForOutput(output, outputs = state.job?.outputs || []) {
  const outputId = String(output?.id || "");
  const cached = state.timelineProjects.get(outputId);
  const sourceProject = cached || output?.timeline_project || null;
  const project = normalizeTimelineProject(sourceProject, output, outputs);
  project.playhead = Math.min(project.playhead || 0, Math.max(0, timelineProjectDuration(project) - 0.001));
  state.timelineProjects.set(outputId, project);
  if (!state.timelineSelections.get(outputId)) {
    const selectedClip = timelineClipAt(project, project.playhead) || timelineVideoClips(project)[0];
    if (selectedClip) state.timelineSelections.set(outputId, selectedClip.id);
  }
  return project;
}

function cloneTimelineProject(project) {
  return JSON.parse(JSON.stringify(project || {}));
}

function setActiveTimelineOutput(outputId) {
  if (outputId) state.activeTimelineOutputId = String(outputId);
}

function pushTimelineUndo(outputId) {
  const output = outputById(outputId);
  if (!output) return false;
  const project = timelineProjectForOutput(output);
  const stack = state.timelineUndoStacks.get(outputId) || [];
  stack.push({
    project: cloneTimelineProject(project),
    selectedClipId: state.timelineSelections.get(outputId) || null,
  });
  if (stack.length > 50) stack.shift();
  state.timelineUndoStacks.set(outputId, stack);
  return true;
}

function undoTimelineAction(outputId = state.activeTimelineOutputId) {
  const id = String(outputId || "");
  const stack = state.timelineUndoStacks.get(id) || [];
  const snapshot = stack.pop();
  if (!snapshot) return false;
  state.timelineUndoStacks.set(id, stack);
  state.timelineProjects.set(id, cloneTimelineProject(snapshot.project));
  if (snapshot.selectedClipId) {
    state.timelineSelections.set(id, snapshot.selectedClipId);
  } else {
    state.timelineSelections.delete(id);
  }
  setActiveTimelineOutput(id);
  refreshTimelineEditor(id);
  els.outputsMeta.textContent = "Última ação da timeline desfeita.";
  return true;
}

function isEditableShortcutTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
}

function visibleTimelineOutputIdFromElement(target) {
  if (!(target instanceof Element)) return "";
  const editor = target.closest("[data-nle-editor]");
  if (!editor || editor.closest("[hidden]")) return "";
  return String(editor.dataset.nleEditor || "");
}

function currentTimelineShortcutOutputId(target = document.activeElement) {
  const focusedOutputId = visibleTimelineOutputIdFromElement(target);
  if (focusedOutputId) return focusedOutputId;

  const activeOutputId = String(state.activeTimelineOutputId || "");
  const activeEditor = activeOutputId
    ? els.outputs?.querySelector(`[data-nle-editor="${CSS.escape(activeOutputId)}"]`)
    : null;
  if (activeEditor && !activeEditor.closest("[hidden]")) return activeOutputId;

  const visibleEditor = els.outputs?.querySelector(".output-tab-panel.is-active [data-nle-editor]");
  return visibleEditor && !visibleEditor.closest("[hidden]") ? String(visibleEditor.dataset.nleEditor || "") : "";
}

function timelineVideoTrack(project) {
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  let track = tracks.find((item) => item?.type === "video");
  if (!track) {
    track = { id: "v1", type: "video", clips: [] };
    project.tracks = [track, ...tracks];
  }
  if (!Array.isArray(track.clips)) track.clips = [];
  return track;
}

function timelineVideoClips(project) {
  return timelineVideoTrack(project).clips;
}

function timelineProjectDuration(project) {
  return timelineVideoClips(project).reduce((total, clip) => total + Math.max(0, Number(clip.duration || 0)), 0);
}

function recalculateTimelineStarts(project) {
  let cursor = 0;
  for (const clip of timelineVideoClips(project)) {
    clip.sourceIn = Math.max(0, Number(clip.sourceIn || 0));
    clip.sourceOut = Math.max(clip.sourceIn + 0.1, Number(clip.sourceOut || clip.sourceIn + Number(clip.duration || 0)));
    clip.duration = Math.max(0.1, clip.sourceOut - clip.sourceIn);
    clip.timelineStart = Number(cursor.toFixed(3));
    clip.duration = Number(clip.duration.toFixed(3));
    clip.sourceIn = Number(clip.sourceIn.toFixed(3));
    clip.sourceOut = Number(clip.sourceOut.toFixed(3));
    cursor += clip.duration;
  }
  project.playhead = Math.max(0, Math.min(Number(project.playhead || 0), Math.max(0, cursor - 0.001)));
  return project;
}

function timelineAssetById(project, assetId) {
  return (project.assets || []).find((asset) => String(asset.id) === String(assetId)) || null;
}

function timelineClipById(project, clipId) {
  return timelineVideoClips(project).find((clip) => String(clip.id) === String(clipId)) || null;
}

function timelineClipAt(project, time) {
  const cursor = Math.max(0, Number(time || 0));
  return timelineVideoClips(project).find((clip) => cursor >= clip.timelineStart && cursor < clip.timelineStart + clip.duration) || null;
}

function timelineClipNear(project, time) {
  const cursor = Math.max(0, Number(time || 0));
  return timelineVideoClips(project).find((clip) => {
    const start = Number(clip.timelineStart || 0);
    const end = start + Number(clip.duration || 0);
    return cursor >= start - 0.05 && cursor <= end + 0.05;
  }) || null;
}

function selectedTimelineClip(outputId, project) {
  const selectedId = state.timelineSelections.get(outputId);
  return timelineClipById(project, selectedId) || timelineClipAt(project, project.playhead) || timelineVideoClips(project)[0] || null;
}

function timelineClipSourceTime(clip, timelineTime) {
  return Math.max(0, Number(clip?.sourceIn || 0) + Math.max(0, Number(timelineTime || 0) - Number(clip?.timelineStart || 0)));
}

function singleTimelineClip(project) {
  const clips = timelineVideoClips(project);
  return clips.length === 1 ? clips[0] : null;
}

function timelineVisualDuration(project) {
  return Math.max(0.1, timelineProjectDuration(project));
}

function timelinePlayheadVisualTime(project) {
  return Number(project?.playhead || 0);
}

function timelinePlayheadPercent(project, visualDuration = timelineVisualDuration(project)) {
  return Math.max(0, Math.min(100, (timelinePlayheadVisualTime(project) / Math.max(0.1, visualDuration)) * 100));
}

function timelineClipVisualStyle(project, clip, visualDuration = timelineVisualDuration(project)) {
  const width = Math.max(7, (Number(clip.duration || 0) / Math.max(0.1, visualDuration)) * 100);
  return `width: ${width}%;`;
}

function newTimelineClipId(prefix = "clip") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 7)}`;
}

function setTimelinePlayhead(outputId, time, selectClip = true) {
  const output = outputById(outputId);
  if (!output) return;
  setActiveTimelineOutput(outputId);
  const project = timelineProjectForOutput(output);
  project.playhead = Math.max(0, Math.min(Number(time || 0), Math.max(0, timelineProjectDuration(project) - 0.001)));
  const previousSelection = state.timelineSelections.get(outputId);
  if (selectClip) {
    const clip = timelineClipAt(project, project.playhead);
    if (clip) state.timelineSelections.set(outputId, clip.id);
  }
  if (previousSelection && previousSelection !== state.timelineSelections.get(outputId)) {
    refreshTimelineEditor(outputId);
  } else {
    syncTimelinePreview(outputId);
  }
}

function setTimelinePlayheadFromClientX(outputId, element, clientX, options = {}) {
  const output = outputById(outputId);
  if (!output || !element) return false;
  setActiveTimelineOutput(outputId);
  const project = timelineProjectForOutput(output);
  const previousSelection = state.timelineSelections.get(outputId);
  const rect = element.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  project.playhead = ratio * timelineProjectDuration(project);
  const clip = timelineClipAt(project, project.playhead);
  if (clip) state.timelineSelections.set(outputId, clip.id);
  const selectionChanged = previousSelection && previousSelection !== state.timelineSelections.get(outputId);
  if (!options.deferRefresh && selectionChanged) {
    refreshTimelineEditor(outputId);
  } else if (!options.deferPreview) {
    syncTimelinePreview(outputId);
  }
  return true;
}

function setTimelinePlayheadFromPreviewCurrent(outputId) {
  const output = outputById(outputId);
  const preview = els.outputs?.querySelector(`[data-edit-preview="${CSS.escape(outputId)}"]`);
  if (!output || !preview) return false;
  if (preview.readyState < 1 && !preview.currentSrc && !preview.getAttribute("src")) return false;
  const project = timelineProjectForOutput(output);
  const current = Number(preview.currentTime || 0);
  if (!Number.isFinite(current)) return false;
  const selected = selectedTimelineClip(outputId, project);
  const currentSource = preview.currentSrc || preview.getAttribute("src") || preview.dataset.src || "";
  const clip =
    selected &&
    current >= Number(selected.sourceIn || 0) - 0.05 &&
    current <= Number(selected.sourceOut || 0) + 0.05
      ? selected
      : timelineVideoClips(project).find((item) => {
          const asset = timelineAssetById(project, item.assetId);
          const assetUrl = asset?.videoUrl || "";
          return (
            assetUrl &&
            currentSource.includes(assetUrl) &&
            current >= Number(item.sourceIn || 0) - 0.05 &&
            current <= Number(item.sourceOut || 0) + 0.05
          );
        });
  if (!clip) return false;
  const nextPlayhead = Math.max(
    0,
    Math.min(
      Number(clip.timelineStart || 0) + Math.max(0, current - Number(clip.sourceIn || 0)),
      Math.max(0, timelineProjectDuration(project) - 0.001),
    ),
  );
  if (nextPlayhead <= 0.001 && Number(project.playhead || 0) > 0.001) return false;
  project.playhead = nextPlayhead;
  state.timelineSelections.set(outputId, clip.id);
  return true;
}

function splitTimelineClip(outputId) {
  const output = outputById(outputId);
  if (!output) return false;
  setActiveTimelineOutput(outputId);
  const project = timelineProjectForOutput(output);
  const playhead = Math.max(0, Number(project.playhead || 0));
  const selected = selectedTimelineClip(outputId, project);
  const playheadClip = timelineClipAt(project, playhead) || timelineClipNear(project, playhead);
  const clip = playheadClip || selected;
  if (!clip) return false;
  let localSplit = Math.max(
    0,
    Math.min(Number(clip.duration || 0), playhead - Number(clip.timelineStart || 0)),
  );
  const sourceIn = Number(clip.sourceIn || 0);
  const sourceOut = Number(clip.sourceOut || sourceIn + Number(clip.duration || 0));
  if (sourceIn + localSplit <= sourceIn + 0.05 || sourceIn + localSplit >= sourceOut - 0.05) {
    localSplit = Number(clip.duration || 0) / 2;
  }
  const sourceSplit = sourceIn + localSplit;
  if (sourceSplit <= sourceIn + 0.05 || sourceSplit >= sourceOut - 0.05) return false;
  pushTimelineUndo(outputId);
  const first = {
    ...clip,
    id: newTimelineClipId("clip-a"),
    sourceOut: sourceSplit,
    duration: sourceSplit - sourceIn,
  };
  const second = {
    ...clip,
    id: newTimelineClipId("clip-b"),
    sourceIn: sourceSplit,
    duration: sourceOut - sourceSplit,
  };
  const clips = timelineVideoClips(project);
  const index = clips.findIndex((item) => item.id === clip.id);
  clips.splice(index, 1, first, second);
  state.timelineSelections.set(outputId, second.id);
  recalculateTimelineStarts(project);
  project.playhead = second.timelineStart;
  refreshTimelineEditor(outputId);
  return true;
}

function requestTimelineSplit(outputId) {
  const id = String(outputId || "");
  const now = Date.now();
  if (state.lastTimelineSplit?.outputId === id && now - state.lastTimelineSplit.at < 350) {
    return true;
  }
  const didSplit = splitTimelineClip(id);
  if (didSplit) state.lastTimelineSplit = { outputId: id, at: now };
  return didSplit;
}

function timelineSplitFailureMessage(outputId) {
  const output = outputById(outputId);
  if (!output) return "Não foi possível localizar este clipe.";
  const project = timelineProjectForOutput(output);
  const playhead = Number(project.playhead || 0);
  const selected = selectedTimelineClip(outputId, project);
  const clip = timelineClipAt(project, playhead) || timelineClipNear(project, playhead) || selected;
  if (!clip) return `Não há trecho selecionado no cursor ${formatSeconds(playhead)}.`;
  return `Não foi possível dividir em ${formatSeconds(playhead)}. Mova o cursor para dentro do trecho selecionado.`;
}

function handleTimelineSplitAction(outputId) {
  if (!requestTimelineSplit(outputId)) {
    els.error.hidden = false;
    els.error.textContent = timelineSplitFailureMessage(outputId);
    return false;
  }
  els.error.hidden = true;
  els.error.textContent = "";
  els.outputsMeta.textContent = "Corte dividido na timeline.";
  return true;
}

function handleTimelineInsertAction(outputId, assetId) {
  if (!insertTimelineAsset(outputId, assetId)) {
    els.error.hidden = false;
    els.error.textContent = "Não foi possível inserir esta mídia na timeline.";
    return false;
  }
  els.error.hidden = true;
  els.error.textContent = "";
  els.outputsMeta.textContent = "Mídia inserida na timeline.";
  return true;
}

window.flixoTimelineSplit = handleTimelineSplitAction;
window.flixoTimelineInsert = handleTimelineInsertAction;

function stopTimelineDomEvent(event, preventDefault = true) {
  if (preventDefault) event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  event.flixoTimelineHandled = true;
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const nleSplitButton = target.closest("[data-nle-split]");
    if (nleSplitButton) {
      stopTimelineDomEvent(event);
      handleTimelineSplitAction(nleSplitButton.dataset.nleSplit || "");
      return;
    }

    const nleInsertAsset = target.closest("[data-nle-insert]");
    if (nleInsertAsset) {
      stopTimelineDomEvent(event);
      handleTimelineInsertAction(nleInsertAsset.dataset.nleInsert || "", nleInsertAsset.dataset.nleAssetId || "");
      return;
    }

    const nleUndoButton = target.closest("[data-nle-undo]");
    if (nleUndoButton) {
      stopTimelineDomEvent(event);
      if (!undoTimelineAction(nleUndoButton.dataset.nleUndo || "")) {
        els.outputsMeta.textContent = "Nenhuma ação da timeline para desfazer.";
      }
      return;
    }

    const nleAudioAddButton = target.closest("[data-nle-audio-add]");
    if (nleAudioAddButton) {
      stopTimelineDomEvent(event);
      els.error.hidden = true;
      els.error.textContent = "";
      els.outputsMeta.textContent = "Faixa de audio preparada. O upload/biblioteca de audio entra na proxima etapa.";
    }
  },
  true,
);

function insertTimelineAsset(outputId, assetId) {
  const output = outputById(outputId);
  if (!output) return false;
  setActiveTimelineOutput(outputId);
  const project = timelineProjectForOutput(output);
  const asset = timelineAssetById(project, assetId);
  if (!asset) return false;
  const clips = timelineVideoClips(project);
  const cursorClip = timelineClipAt(project, project.playhead);
  let index = clips.findIndex((clip) => clip.timelineStart >= project.playhead - 0.001);
  if (index < 0) index = clips.length;
  const duration = Math.max(0.1, Number(asset.duration || 0));
  pushTimelineUndo(outputId);
  if (cursorClip) {
    const cursorIndex = clips.findIndex((item) => item.id === cursorClip.id);
    const localTime = Math.max(
      0,
      Math.min(Number(cursorClip.duration || 0), Number(project.playhead || 0) - Number(cursorClip.timelineStart || 0)),
    );
    if (cursorIndex >= 0 && localTime > 0.05 && localTime < Number(cursorClip.duration || 0) - 0.05) {
      const sourceSplit = Number(cursorClip.sourceIn || 0) + localTime;
      const first = {
        ...cursorClip,
        id: newTimelineClipId("clip-a"),
        sourceOut: sourceSplit,
        duration: sourceSplit - Number(cursorClip.sourceIn || 0),
      };
      const second = {
        ...cursorClip,
        id: newTimelineClipId("clip-b"),
        sourceIn: sourceSplit,
        duration: Number(cursorClip.sourceOut || 0) - sourceSplit,
      };
      clips.splice(cursorIndex, 1, first, second);
      index = cursorIndex + 1;
    } else {
      index = cursorIndex >= 0 && localTime >= Number(cursorClip.duration || 0) - 0.05 ? cursorIndex + 1 : cursorIndex;
    }
  }
  const clip = {
    id: newTimelineClipId("clip"),
    assetId: asset.id,
    sourceIn: 0,
    sourceOut: duration,
    timelineStart: project.playhead,
    duration,
  };
  clips.splice(index, 0, clip);
  state.timelineSelections.set(outputId, clip.id);
  recalculateTimelineStarts(project);
  refreshTimelineEditor(outputId);
  return true;
}

function deleteTimelineClip(outputId) {
  const output = outputById(outputId);
  if (!output) return false;
  setActiveTimelineOutput(outputId);
  const project = timelineProjectForOutput(output);
  const clips = timelineVideoClips(project);
  if (clips.length <= 1) return false;
  const selected = selectedTimelineClip(outputId, project);
  const index = clips.findIndex((clip) => clip.id === selected?.id);
  if (index < 0) return false;
  pushTimelineUndo(outputId);
  clips.splice(index, 1);
  const next = clips[Math.min(index, clips.length - 1)];
  if (next) state.timelineSelections.set(outputId, next.id);
  recalculateTimelineStarts(project);
  refreshTimelineEditor(outputId);
  return true;
}

function moveTimelineClip(outputId, direction) {
  const output = outputById(outputId);
  if (!output) return false;
  setActiveTimelineOutput(outputId);
  const project = timelineProjectForOutput(output);
  const clips = timelineVideoClips(project);
  const selected = selectedTimelineClip(outputId, project);
  const index = clips.findIndex((clip) => clip.id === selected?.id);
  const nextIndex = direction === "left" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= clips.length) return false;
  pushTimelineUndo(outputId);
  const [clip] = clips.splice(index, 1);
  clips.splice(nextIndex, 0, clip);
  state.timelineSelections.set(outputId, clip.id);
  recalculateTimelineStarts(project);
  project.playhead = clip.timelineStart;
  refreshTimelineEditor(outputId);
  return true;
}

function moveTimelineClipToIndex(outputId, clipId, targetIndex) {
  const output = outputById(outputId);
  if (!output) return false;
  setActiveTimelineOutput(outputId);
  const project = timelineProjectForOutput(output);
  const clips = timelineVideoClips(project);
  const fromIndex = clips.findIndex((clip) => String(clip.id) === String(clipId));
  if (fromIndex < 0) return false;
  const nextIndex = Math.max(0, Math.min(Number(targetIndex || 0), clips.length - 1));
  if (fromIndex === nextIndex) return false;
  pushTimelineUndo(outputId);
  const [clip] = clips.splice(fromIndex, 1);
  clips.splice(nextIndex, 0, clip);
  state.timelineSelections.set(outputId, clip.id);
  recalculateTimelineStarts(project);
  project.playhead = clip.timelineStart;
  refreshTimelineEditor(outputId);
  return true;
}

function trimTimelineClip(outputId, field, value) {
  const output = outputById(outputId);
  if (!output) return;
  setActiveTimelineOutput(outputId);
  const project = timelineProjectForOutput(output);
  const clip = selectedTimelineClip(outputId, project);
  if (!clip) return;
  const asset = timelineAssetById(project, clip.assetId);
  const assetDuration = Math.max(0.1, Number(asset?.duration || clip.sourceOut || 0));
  const number = Math.max(0, Number(value || 0));
  pushTimelineUndo(outputId);
  if (field === "sourceIn") {
    clip.sourceIn = Math.min(number, Math.max(0, clip.sourceOut - 0.1));
  } else {
    clip.sourceOut = Math.max(clip.sourceIn + 0.1, Math.min(number, assetDuration));
  }
  recalculateTimelineStarts(project);
  refreshTimelineEditor(outputId, { keepFocus: field });
}

function trimTimelineClipById(outputId, clipId, field, value, options = {}) {
  const output = outputById(outputId);
  if (!output) return false;
  setActiveTimelineOutput(outputId);
  const project = timelineProjectForOutput(output);
  const clip = timelineClipById(project, clipId);
  if (!clip) return false;
  const asset = timelineAssetById(project, clip.assetId);
  const assetDuration = Math.max(0.1, Number(asset?.duration || clip.sourceOut || 0));
  const number = Math.max(0, Number(value || 0));
  if (!options.skipUndo) pushTimelineUndo(outputId);
  if (field === "sourceIn") {
    clip.sourceIn = Math.min(number, Math.max(0, clip.sourceOut - 0.1));
    project.playhead = clip.timelineStart;
  } else {
    clip.sourceOut = Math.max(clip.sourceIn + 0.1, Math.min(number, assetDuration));
    project.playhead = clip.timelineStart + Math.max(0, clip.sourceOut - clip.sourceIn);
  }
  state.timelineSelections.set(outputId, clip.id);
  recalculateTimelineStarts(project);
  if (!options.deferRefresh) refreshTimelineEditor(outputId);
  return true;
}

function timelineProjectPayload(outputId) {
  const output = outputById(outputId);
  if (!output) return null;
  return recalculateTimelineStarts(timelineProjectForOutput(output));
}

function refreshTimelineEditor(outputId, options = {}) {
  const output = outputById(outputId);
  const panel = els.outputs?.querySelector(`[data-edit-panel="${CSS.escape(outputId)}"]`);
  if (!output || !panel) return;
  panel.innerHTML = clipEditorInnerHtml(output, state.job?.outputs || [], Boolean(output.edited_from));
  syncTimelinePreview(outputId);
  const focusField = options.keepFocus;
  if (focusField) {
    const selector = focusField === "sourceIn" ? "[data-nle-source-in]" : "[data-nle-source-out]";
    const input = panel.querySelector(selector);
    input?.focus();
    input?.select?.();
  }
}

function syncTimelinePreview(outputId) {
  const output = outputById(outputId);
  if (!output) return;
  const project = timelineProjectForOutput(output);
  const clip = timelineClipAt(project, project.playhead) || selectedTimelineClip(outputId, project);
  const asset = clip ? timelineAssetById(project, clip.assetId) : null;
  const duration = timelineVisualDuration(project);
  const projectDuration = Math.max(0.1, timelineProjectDuration(project));
  const playhead = els.outputs?.querySelector(`[data-nle-playhead="${CSS.escape(outputId)}"]`);
  const splitButton = els.outputs?.querySelector(`.nle-playhead-split[data-nle-split="${CSS.escape(outputId)}"]`);
  const playheadLabel = els.outputs?.querySelector(`[data-nle-playhead-label="${CSS.escape(outputId)}"]`);
  const durationLabel = els.outputs?.querySelector(`[data-nle-duration-label="${CSS.escape(outputId)}"]`);
  const selectedLabel = els.outputs?.querySelector(`[data-nle-selected-label="${CSS.escape(outputId)}"]`);
  const sourceLabel = els.outputs?.querySelector(`[data-nle-source-label="${CSS.escape(outputId)}"]`);
  const playheadPercent = `${timelinePlayheadPercent(project, duration)}%`;
  if (playhead) playhead.style.left = playheadPercent;
  if (splitButton) splitButton.style.left = playheadPercent;
  if (playheadLabel) playheadLabel.textContent = formatSeconds(project.playhead);
  if (durationLabel) durationLabel.textContent = formatSeconds(projectDuration);
  if (selectedLabel) selectedLabel.textContent = asset?.name || "Nenhum";
  if (sourceLabel && clip) sourceLabel.textContent = `${formatSeconds(clip.sourceIn)} - ${formatSeconds(clip.sourceOut)}`;
  els.outputs?.querySelectorAll(`[data-nle-clip="${CSS.escape(outputId)}"]`).forEach((button) => {
    const currentClip = timelineClipById(project, button.dataset.nleClipId || "");
    button.dataset.selected = button.dataset.nleClipId === clip?.id ? "true" : "false";
    if (currentClip) {
      button.setAttribute("style", timelineClipVisualStyle(project, currentClip, duration));
      const clipDuration = button.querySelector("[data-nle-clip-duration]");
      if (clipDuration) clipDuration.textContent = formatSeconds(currentClip.duration);
    }
  });
  const preview = els.outputs?.querySelector(`[data-edit-preview="${CSS.escape(outputId)}"]`);
  if (!preview || !asset?.videoUrl) return;
  preview.dataset.src = asset.videoUrl;
  if (asset.posterUrl) preview.setAttribute("poster", asset.posterUrl);
  const video = ensureVideoSource(preview);
  if (!video) return;
  const sourceTime = clip ? timelineClipSourceTime(clip, project.playhead) : 0;
  const applySeek = () => {
    const target = Math.max(0, Number(sourceTime || 0));
    if (Number.isFinite(target)) {
      video.currentTime = target;
    }
  };
  if (video.readyState >= 1) {
    applySeek();
  } else {
    video.addEventListener("loadedmetadata", applySeek, { once: true });
  }
}

function syncTimelineFromPreview(outputId) {
  const output = outputById(outputId);
  const preview = els.outputs?.querySelector(`[data-edit-preview="${CSS.escape(outputId)}"]`);
  if (!output || !preview) return;
  const project = timelineProjectForOutput(output);
  const clip = selectedTimelineClip(outputId, project);
  if (!clip) return;
  const current = Number(preview.currentTime || 0);
  if (current >= clip.sourceOut) {
    preview.pause();
    preview.currentTime = clip.sourceOut;
  }
  project.playhead = Math.max(0, Math.min(clip.timelineStart + Math.max(0, current - clip.sourceIn), Math.max(0, timelineProjectDuration(project) - 0.001)));
  const duration = Math.max(0.1, timelineProjectDuration(project));
  const playhead = els.outputs?.querySelector(`[data-nle-playhead="${CSS.escape(outputId)}"]`);
  const playheadLabel = els.outputs?.querySelector(`[data-nle-playhead-label="${CSS.escape(outputId)}"]`);
  const selectedLabel = els.outputs?.querySelector(`[data-nle-selected-label="${CSS.escape(outputId)}"]`);
  const sourceLabel = els.outputs?.querySelector(`[data-nle-source-label="${CSS.escape(outputId)}"]`);
  const asset = timelineAssetById(project, clip.assetId);
  if (playhead) playhead.style.left = `${(project.playhead / duration) * 100}%`;
  const splitButton = els.outputs?.querySelector(`.nle-playhead-split[data-nle-split="${CSS.escape(outputId)}"]`);
  if (splitButton) splitButton.style.left = `${(project.playhead / duration) * 100}%`;
  if (playheadLabel) playheadLabel.textContent = formatSeconds(project.playhead);
  if (selectedLabel) selectedLabel.textContent = asset?.name || "Nenhum";
  if (sourceLabel) sourceLabel.textContent = `${formatSeconds(clip.sourceIn)} - ${formatSeconds(clip.sourceOut)}`;
}

function savedOutputMetadata(outputId) {
  const output = outputById(outputId);
  if (!output) return null;
  const candidate = outputCandidate(outputId);
  const title = output.title || candidate.title || "Corte";
  const description = outputDescription(output, candidate, title);
  return {
    title,
    description,
    tags: outputTagsForDisplay(output, title, description),
    cover_title: coverTitleText(output.cover_title || title),
    cover_template: output.cover_template || "impact",
    cover_text_position: output.cover_text_position || "bottom",
  };
}

function normalizeComparableText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeComparableTags(tags) {
  const values = Array.isArray(tags) ? tags : parseTags(tags);
  return values
    .map((tag) => String(tag || "").trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean)
    .sort();
}

function sameTags(left, right) {
  const leftTags = normalizeComparableTags(left);
  const rightTags = normalizeComparableTags(right);
  return leftTags.length === rightTags.length && leftTags.every((tag, index) => tag === rightTags[index]);
}

function subtitleColorLabel(value) {
  return {
    white: "branca",
    yellow: "amarela",
    black: "preta",
    blue: "azul",
    red: "vermelha",
  }[String(value || "").toLowerCase()] || "branca";
}

function subtitleSizeLabelFor(value) {
  return {
    small: "letra menor",
    medium: "letra média",
    large: "letra maior",
  }[String(value || "").toLowerCase()] || "letra média";
}

function subtitlePositionLabelFor(value) {
  return {
    top: "topo",
    middle: "centro",
    bottom: "baixo",
  }[String(value || "").toLowerCase()] || "centro";
}

function subtitleColorHex(value) {
  return {
    white: "#ffffff",
    yellow: "#ffdd57",
    black: "#05070d",
    blue: "#38bdf8",
    red: "#ef4444",
  }[String(value || "").toLowerCase()] || "#ffffff";
}

function subtitleAppearancePreviewText(output) {
  return subtitleAppearancePreviewTextForStyle(output?.subtitle_style, output?.subtitle_preview_text);
}

function subtitleAppearancePreviewTextForStyle(subtitleStyle, text = "") {
  const previewText = String(text || "você tem que sair cedo").trim();
  if (normalizeSubtitleStyleValue(subtitleStyle) !== "word") {
    return previewText.length > 38 ? `${previewText.slice(0, 35).trim()}...` : previewText;
  }
  const word = previewText.match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/u)?.[0] || "atraso";
  return word.length > 16 ? `${word.slice(0, 14)}-` : word;
}

function normalizeSubtitleStyleValue(value) {
  return String(value || "").toLowerCase() === "word" ? "word" : "standard";
}

function selectedSubtitleAppearance(outputId, fallbackOutput = null) {
  const selected = document.querySelector(`[data-subtitle-color-option="${CSS.escape(outputId)}"][data-selected="true"]`);
  const selectedStyle = document.querySelector(`[data-subtitle-style-option="${CSS.escape(outputId)}"][data-selected="true"]`);
  const selectedSize = document.querySelector(`[data-subtitle-size-option="${CSS.escape(outputId)}"][data-selected="true"]`);
  const selectedPosition = document.querySelector(`[data-subtitle-position-option="${CSS.escape(outputId)}"][data-selected="true"]`);
  return {
    subtitle_style: selectedStyle?.dataset.subtitleStyle || fallbackOutput?.subtitle_style || "standard",
    subtitle_text_color: selected?.dataset.subtitleTextColor || fallbackOutput?.subtitle_text_color || "white",
    subtitle_border_color: selected?.dataset.subtitleBorderColor || fallbackOutput?.subtitle_border_color || "black",
    subtitle_size: selectedSize?.dataset.subtitleSize || fallbackOutput?.subtitle_size || "medium",
    subtitle_position: selectedPosition?.dataset.subtitlePosition || fallbackOutput?.subtitle_position || "middle",
  };
}

function subtitleColorPreviewHtml(output, frameUrl) {
  const outputId = String(output?.id || "");
  if (!outputId) return "";
  const currentStyle = normalizeSubtitleStyleValue(output?.subtitle_style || "standard");
  const currentTextColor = output?.subtitle_text_color || "white";
  const currentBorderColor = output?.subtitle_border_color || "black";
  const currentSize = output?.subtitle_size || "medium";
  const currentPosition = output?.subtitle_position || "middle";
  const previewText = subtitleAppearancePreviewText(output);
  const styleOptions = SUBTITLE_STYLE_OPTIONS.map(([value, label]) => {
    const selected = value === currentStyle;
    return `
      <button
        type="button"
        class="subtitle-preview-choice"
        data-subtitle-style-option="${escapeHtml(outputId)}"
        data-subtitle-style="${escapeHtml(value)}"
        data-selected="${selected ? "true" : "false"}"
        aria-pressed="${selected ? "true" : "false"}"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }).join("");
  const cards = SUBTITLE_COLOR_PRESETS.map((preset) => {
    const selected = preset.text === currentTextColor && preset.border === currentBorderColor;
    return `
      <button
        type="button"
        class="subtitle-color-card"
        data-subtitle-color-option="${escapeHtml(outputId)}"
        data-subtitle-text-color="${escapeHtml(preset.text)}"
        data-subtitle-border-color="${escapeHtml(preset.border)}"
        data-selected="${selected ? "true" : "false"}"
        aria-pressed="${selected ? "true" : "false"}"
        style="--subtitle-preview-text: ${escapeHtml(subtitleColorHex(preset.text))}; --subtitle-preview-border: ${escapeHtml(subtitleColorHex(preset.border))};"
      >
        <span class="subtitle-color-frame">
          ${
            frameUrl
              ? `<img src="${escapeHtml(frameUrl)}" alt="" loading="lazy" />`
              : `<span class="subtitle-color-frame-placeholder"></span>`
          }
          <strong>${escapeHtml(previewText)}</strong>
        </span>
        <span class="subtitle-color-label">${escapeHtml(preset.label)}</span>
      </button>
    `;
  }).join("");
  const sizeOptions = SUBTITLE_SIZE_OPTIONS.map(([value, label]) => {
    const selected = value === currentSize;
    return `
      <button
        type="button"
        class="subtitle-preview-choice"
        data-subtitle-size-option="${escapeHtml(outputId)}"
        data-subtitle-size="${escapeHtml(value)}"
        data-selected="${selected ? "true" : "false"}"
        aria-pressed="${selected ? "true" : "false"}"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }).join("");
  const positionOptions = SUBTITLE_POSITION_OPTIONS.map(([value, label]) => {
    const selected = value === currentPosition;
    return `
      <button
        type="button"
        class="subtitle-preview-choice"
        data-subtitle-position-option="${escapeHtml(outputId)}"
        data-subtitle-position="${escapeHtml(value)}"
        data-selected="${selected ? "true" : "false"}"
        aria-pressed="${selected ? "true" : "false"}"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }).join("");
  return `
    <section
      class="subtitle-color-preview"
      data-subtitle-style-group="${escapeHtml(outputId)}"
      data-subtitle-color-group="${escapeHtml(outputId)}"
      data-subtitle-size-group="${escapeHtml(outputId)}"
      data-subtitle-position-group="${escapeHtml(outputId)}"
      data-subtitle-style="${escapeHtml(currentStyle)}"
      data-subtitle-size="${escapeHtml(currentSize)}"
      data-subtitle-position="${escapeHtml(currentPosition)}"
      data-subtitle-preview-text="${escapeHtml(output?.subtitle_preview_text || "")}"
    >
      <div class="cover-options-head">
        <strong>${escapeHtml(output?.subtitle_preview_title || "Legenda no vídeo")}</strong>
        <span>${escapeHtml(output?.subtitle_preview_hint || "Preview no frame do clipe")}</span>
      </div>
      <div class="subtitle-preview-section-title">Cor e borda</div>
      <div class="subtitle-color-grid">
        ${cards}
      </div>
      <div class="subtitle-preview-controls">
        <div>
          <strong>Formato</strong>
          <div class="subtitle-preview-choice-group">${styleOptions}</div>
        </div>
        <div>
          <strong>Tamanho</strong>
          <div class="subtitle-preview-choice-group">${sizeOptions}</div>
        </div>
        <div>
          <strong>Posição</strong>
          <div class="subtitle-preview-choice-group">${positionOptions}</div>
        </div>
      </div>
    </section>
  `;
}

function appendClipOptions(outputs, currentId) {
  return outputs
    .filter((output) => output?.id && output.id !== currentId)
    .map((output, index) => {
      const title = output.title || `Corte ${index + 1}`;
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
  if (text.includes("stand up") || text.includes("standup") || text.includes("comediante") || text.includes("plateia")) {
    add("#StandUp", "#Comedia", "#Humor", "#Brasil");
  }
  if (text.includes("sao paulo") || /\bsp\b/.test(text)) add("#SaoPaulo", "#SP", "#Brasil");
  if (text.includes("motiv") || text.includes("crescer") || text.includes("sonho")) add("#Motivacao");
  if (text.includes("empreend")) add("#Empreendedorismo");
  if (text.includes("dinheiro") || text.includes("negocio")) add("#Negocios");
  if (text.includes("humor") || text.includes("engrac") || text.includes("comedia")) add("#Humor", "#Comedia");

  if (hasAutomotiveContext(text)) add("#Carros", "#Automotivo");
  add(...keywordTags(text));
  return tags.filter((tag) => !isGenericHashtag(tag)).slice(0, 12);
}

function outputTagsForDisplay(output, title, description) {
  const saved = Array.isArray(output?.youtube_tags) ? output.youtube_tags : [];
  const sourceMetadata = state.job?.source_metadata || {};
  const sourceText = [
    sourceMetadata.title,
    sourceMetadata.channel,
    sourceMetadata.uploader,
    Array.isArray(sourceMetadata.tags) ? sourceMetadata.tags.join(" ") : "",
    Array.isArray(sourceMetadata.categories) ? sourceMetadata.categories.join(" ") : "",
  ].filter(Boolean).join(" ");
  const suggested = outputTags(`${title} ${sourceText}`, description);
  if (saved.length) {
    const normalizedSaved = saved
      .map((tag) => `#${String(tag || "").trim().replace(/^#/, "")}`)
      .filter((tag) => tag.length > 1 && !isGenericHashtag(tag))
    return [...suggested, ...normalizedSaved]
      .filter((tag, index, list) => list.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index)
      .slice(0, 12);
  }
  return suggested;
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
    ["stand up", "#StandUp"],
    ["standup", "#StandUp"],
    ["humor", "#Humor"],
    ["comedia", "#Comedia"],
    ["comediante", "#Comediante"],
    ["sao paulo", "#SaoPaulo"],
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
  return [
    "#shorts",
    "#podcast",
    "#youtubeshorts",
    "#youtube",
    "#editado",
    "#culminando",
    "#ridicularizado",
    "#guardadas",
    "#frescor",
    "#combinacao",
    "#dedicacao",
    "#fundamental",
    "#petrolifera",
    "#temporada",
    "#tecnico",
    "#desenvolvimento",
    "#investimentos",
  ].includes(String(tag || "").toLowerCase());
}

function outputYoutubeOverride(outputId) {
  const title = els.outputs.querySelector(`[data-youtube-title="${CSS.escape(outputId)}"]`)?.value?.trim() || "";
  const description =
    els.outputs.querySelector(`[data-youtube-description="${CSS.escape(outputId)}"]`)?.value?.trim() || "";
  const tagsValue = els.outputs.querySelector(`[data-youtube-tags="${CSS.escape(outputId)}"]`)?.value || "";
  const privacyStatus =
    els.outputs.querySelector(`[data-youtube-privacy-output="${CSS.escape(outputId)}"]`)?.value ||
    els.youtubePrivacy?.value ||
    "private";
  const categoryId =
    els.outputs.querySelector(`[data-youtube-category-output="${CSS.escape(outputId)}"]`)?.value ||
    els.youtubeCategory?.value ||
    "";
  return {
    title,
    description,
    tags: parseTags(tagsValue),
    publish_at: publishAtIsoValue(outputId),
    privacy_status: privacyStatus,
    category_id: categoryId,
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

function metadataHasPendingChanges(outputId) {
  const saved = savedOutputMetadata(outputId);
  if (!saved) return false;
  const current = outputMetadataPayload(outputId);
  return (
    normalizeComparableText(current.title) !== normalizeComparableText(saved.title) ||
    normalizeComparableText(current.description) !== normalizeComparableText(saved.description) ||
    !sameTags(current.tags, saved.tags) ||
    normalizeComparableText(current.cover_title) !== normalizeComparableText(saved.cover_title) ||
    String(current.cover_template || "impact") !== String(saved.cover_template || "impact") ||
    String(current.cover_text_position || "bottom") !== String(saved.cover_text_position || "bottom")
  );
}

function subtitleAppearanceHasPendingChanges(outputId) {
  const output = outputById(outputId);
  if (!output) return false;
  const current = selectedSubtitleAppearance(outputId, output);
  return (
    normalizeSubtitleStyleValue(current.subtitle_style) !== normalizeSubtitleStyleValue(output.subtitle_style || "standard") ||
    String(current.subtitle_text_color || "white") !== String(output.subtitle_text_color || "white") ||
    String(current.subtitle_border_color || "black") !== String(output.subtitle_border_color || "black") ||
    String(current.subtitle_size || "medium") !== String(output.subtitle_size || "medium") ||
    String(current.subtitle_position || "middle") !== String(output.subtitle_position || "middle")
  );
}

function subtitleTextHasPendingChanges(outputId) {
  const editor = els.outputs.querySelector(`[data-subtitle-editor="${CSS.escape(outputId)}"]`);
  if (!editor || editor.dataset.loaded !== "true") return false;
  return canonicalSubtitle(subtitleFromTemplate(outputId)) !== String(editor.dataset.savedSubtitle || "").trim();
}

function pendingOutputChanges(outputId) {
  const changes = [];
  if (metadataHasPendingChanges(outputId)) changes.push("metadados e miniatura");
  if (subtitleAppearanceHasPendingChanges(outputId) || subtitleTextHasPendingChanges(outputId)) changes.push("legenda");
  return changes;
}

async function savePendingOutputChanges(outputId) {
  let updatedOutput = null;
  if (metadataHasPendingChanges(outputId)) {
    updatedOutput = await saveOutputMetadata(outputId);
    if (updatedOutput) replaceOutput(updatedOutput);
  }
  if (subtitleAppearanceHasPendingChanges(outputId) || subtitleTextHasPendingChanges(outputId)) {
    await ensureSubtitleEditorLoaded(outputId);
    updatedOutput = await saveSubtitle(outputId, subtitleFromTemplate(outputId));
    if (updatedOutput) replaceOutput(updatedOutput);
  }
  return updatedOutput;
}

async function confirmAndSavePendingChanges(outputIds) {
  const ids = [...new Set(outputIds.map((id) => String(id || "")).filter(Boolean))];
  const changed = ids
    .map((outputId) => ({ outputId, changes: pendingOutputChanges(outputId) }))
    .filter((item) => item.changes.length > 0);
  if (!changed.length) return true;

  const confirmed = await confirmAction({
    title: "Salvar alterações antes de enviar?",
    message:
      changed.length === 1
        ? `Este corte tem alterações não salvas em ${changed[0].changes.join(" e ")}. Salvar antes de enviar?`
        : `${changed.length} cortes têm alterações não salvas. Salvar antes de enviar?`,
    confirmLabel: "Salvar e enviar",
    cancelLabel: "Cancelar envio",
  });
  if (!confirmed) return false;

  setActionLocked(true);
  els.outputsMeta.textContent = "Salvando alterações antes do envio...";
  try {
    for (const item of changed) {
      await savePendingOutputChanges(item.outputId);
    }
  } finally {
    setActionLocked(false);
  }
  renderOutputs(state.job);
  loadHistory().catch(() => {});
  return true;
}

function outputYoutubeOverrides() {
  const overrides = {};
  for (const output of state.job?.outputs || []) {
    if (output?.id) overrides[output.id] = outputYoutubeOverride(output.id);
  }
  return overrides;
}

function parseTags(value) {
  const tags = String(value || "")
    .split(/[,\s]+/)
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter((tag) => tag && !isGenericHashtag(`#${tag}`));
  return [...new Set(tags)].slice(0, 12);
}

function youtubeSettingsPayload() {
  const videoLanguage = els.youtubeVideoLanguage?.value || "pt-BR";
  return {
    privacy_status: els.youtubePrivacy?.value || "private",
    video_language: videoLanguage,
    audio_language: videoLanguage,
    category_id: els.youtubeCategory?.value || "",
  };
}

function syncYoutubeActionState() {
  if (els.youtubeUploadAllButton) {
    els.youtubeUploadAllButton.disabled = !state.youtubeAuthorized || !(state.job?.outputs || []).length;
  }
  els.outputs?.querySelectorAll(".youtube-upload-button").forEach((button) => {
    button.disabled = !state.youtubeAuthorized;
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
  if (!els.youtubeVideoLanguage) return;
  const payload = await fetch("/api/youtube/i18n-options").then(readJson);
  const languages = payload?.data?.languages || [];
  populateLanguageSelect(els.youtubeVideoLanguage, languages, els.youtubeVideoLanguage?.value || "pt-BR");
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
    els.youtubeStatusMeta.textContent = `Canal conectado: ${channelNames}`;
  } else if (authorized && channelError) {
    els.youtubeStatusMeta.textContent =
      "YouTube conectado, mas é preciso reconectar para permitir leitura do canal autorizado.";
  } else {
    els.youtubeStatusMeta.textContent = authorized
      ? "YouTube conectado."
      : "Conecte o canal para habilitar upload dos cortes.";
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
  let canContinue = false;
  try {
    canContinue = await confirmAndSavePendingChanges([outputId]);
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    return;
  }
  if (!canContinue) return;
  const activeButton =
    els.outputs.querySelector(`.youtube-upload-button[data-output-id="${CSS.escape(outputId)}"]`) || button;
  const originalText = activeButton.textContent;
  let uploaded = false;
  setActionLocked(true);
  activeButton.disabled = true;
  activeButton.textContent = "Enviando...";
  try {
    const payload = await fetch("/api/youtube/upload-podcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: state.jobId,
        output_id: outputId,
        ...youtubeSettingsPayload(),
        ...outputYoutubeOverride(outputId),
      }),
    }).then(readJson);
    const upload = payload?.data?.upload;
    const scheduled = Boolean(upload?.publish_at);
    uploaded = true;
    replaceOutput({
      id: outputId,
      youtube_uploaded: true,
      youtube_uploaded_at: Math.floor(Date.now() / 1000),
      youtube_video_id: upload?.video_id || "",
      youtube_url: upload?.url || "",
      youtube_publish_at: upload?.publish_at || null,
      youtube_privacy_status: upload?.privacy_status || "",
      youtube_category_id: upload?.category_id || "",
    });
    activeButton.textContent = "Enviar novamente";
    activeButton.dataset.uploaded = "true";
    els.outputsMeta.textContent = scheduled
      ? "Publicação agendada. Legenda e capas continuam disponíveis para download."
      : "Vídeo enviado. Legenda e capas continuam disponíveis para download.";
    if (upload?.url) {
      activeButton.insertAdjacentHTML(
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
      activeButton.disabled = !state.youtubeAuthorized;
      activeButton.textContent = "Enviar novamente";
      activeButton.dataset.uploaded = "true";
    } else {
      activeButton.disabled = !state.youtubeAuthorized;
      activeButton.textContent = originalText;
    }
  }
}

async function uploadAllOutputsToYoutube() {
  if (!state.jobId || !state.job?.outputs?.length) return;
  if (state.actionLocked) return;
  const outputIds = state.job.outputs.map((output) => output?.id).filter(Boolean);
  const canContinue = await confirmAndSavePendingChanges(outputIds);
  if (!canContinue) return;
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
    const scheduledCount = uploads.filter((upload) => upload?.publish_at).length;
    els.outputsMeta.textContent = scheduledCount
      ? `${uploads.length} corte(s) enviados ao YouTube, com ${scheduledCount} publicação(ões) agendada(s).`
      : `${uploads.length} corte(s) enviados ao YouTube. Legendas e capas seguem disponíveis para download.`;
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

async function downloadAllSubtitles() {
  const outputs = Array.isArray(state.job?.outputs) ? state.job.outputs : [];
  const downloads = outputs
    .map((output, index) => ({
      output_id: output?.id,
      subtitle_key: output?.subtitle_key || output?.r2_subtitle_key || "",
      subtitle_url: output?.subtitle_url || "",
      filename: `${String(index + 1).padStart(2, "0")}-${safeDownloadName(output?.title, output?.id)}.srt`,
    }))
    .filter((item) => item.output_id && (item.subtitle_key || item.subtitle_url));

  if (!downloads.length) {
    els.error.hidden = false;
    els.error.textContent = "Nenhuma legenda disponível para download.";
    return;
  }

  if (!state.jobId) return;
  const originalText = els.downloadSubtitlesButton?.textContent || "Baixar legendas";
  if (els.downloadSubtitlesButton) {
    els.downloadSubtitlesButton.disabled = true;
    els.downloadSubtitlesButton.textContent = "Preparando...";
  }
  try {
    const response = await fetch(`/api/podcast/jobs/${encodeURIComponent(state.jobId)}/subtitles/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subtitles: downloads.map((item) => ({
          output_id: item.output_id,
          subtitle_key: item.subtitle_key,
          subtitle_url: item.subtitle_url,
          filename: item.filename,
        })),
      }),
    });
    if (!response.ok) {
      let message = "Falha ao baixar legendas.";
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
    await downloadFile(objectUrl, `legendas-${safeDownloadName(state.job?.title || state.jobId, state.jobId)}.zip`);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    els.outputsMeta.textContent = `${downloads.length} legenda(s) baixadas em um arquivo ZIP.`;
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (els.downloadSubtitlesButton) {
      els.downloadSubtitlesButton.disabled = false;
      els.downloadSubtitlesButton.textContent = originalText;
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

function parseSrtTimestamp(value) {
  const match = String(value || "").trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return NaN;
  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 3600000 +
    Number(minutes) * 60000 +
    Number(seconds) * 1000 +
    Number(milliseconds.padEnd(3, "0"))
  );
}

function formatSrtTimestamp(milliseconds) {
  const total = Math.max(0, Math.round(Number(milliseconds || 0)));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const ms = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function parseSrtTimeRange(value) {
  const [start, end] = String(value || "").split("-->").map((part) => part.trim());
  return {
    startMs: parseSrtTimestamp(start),
    endMs: parseSrtTimestamp(end),
  };
}

function formatSubtitleSecondValue(milliseconds) {
  return (Math.max(0, Number(milliseconds || 0)) / 1000).toFixed(3);
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

function canDeleteHistoryJob(job) {
  const status = String(job?.status || "");
  const step = String(job?.current_step || "");
  const activeStatuses = ["queued", "running", "rendering"];
  const activeSteps = ["queued", "ingesting", "transcribing", "analyzing", "rendering"];
  return !activeStatuses.includes(status) && !activeSteps.includes(step);
}

function renderHistory(jobs) {
  if (!els.history || !els.historyMeta) return;
  const visibleJobs = Array.isArray(jobs) ? jobs.filter((job) => job?.id !== state.jobId) : [];
  const processing = isProcessingProject(state.job);
  state.historyCount = visibleJobs.length;
  syncProjectPanels(state.job);
  if (!visibleJobs.length) {
    els.historyMeta.textContent = processing
      ? "Seu projeto atual está em processamento. Os projetos do histórico aparecerão aqui."
      : "Nenhum projeto criado ainda.";
    els.history.innerHTML = '<div class="empty-state">Seus projetos aparecerão aqui.</div>';
    return;
  }
  els.historyMeta.textContent = processing
    ? "Você pode navegar pelos projetos do histórico enquanto o projeto atual fica pronto."
    : `${visibleJobs.length} projeto(s) recentes.`;
  els.history.innerHTML = visibleJobs
    .map((job) => {
      const outputsCount = Number(job.outputs_count || 0);
      const status = jobStatusLabel(job);
      const canDelete = canDeleteHistoryJob(job);
      return `
        <article class="history-card">
          <div class="history-card-content">
            <strong>${escapeHtml(job.title || "Projeto de clipes")}</strong>
            <span>${escapeHtml(formatHistoryDate(job.updated_at || job.created_at))}</span>
            <div class="history-card-meta">
              <span class="meta-pill">${escapeHtml(status)}</span>
              <span class="meta-pill">${outputsCount} corte(s)</span>
            </div>
          </div>
          <div class="history-card-actions">
            <button type="button" class="secondary-button history-open-button" data-history-job="${escapeHtml(job.id)}">Abrir projeto</button>
            ${canDelete ? `<button type="button" class="history-delete-button" data-history-delete="${escapeHtml(job.id)}">Excluir</button>` : ""}
          </div>
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
  cancelPendingUiRenders();
  state.timelineProjects.clear();
  state.timelineSelections.clear();
  state.timelineUndoStacks.clear();
  state.activeTimelineOutputId = null;
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

async function deleteHistoryJob(jobId, button) {
  if (!jobId || state.deletingHistoryJobs.has(jobId)) return;
  const confirmed = await confirmAction({
    title: "Excluir projeto?",
    message: "Os clipes, legendas e capas deste projeto serão removidos permanentemente. Esta ação não pode ser desfeita.",
    confirmLabel: "Excluir projeto",
  });
  if (!confirmed) return;

  const card = button?.closest(".history-card");
  const controls = card ? [...card.querySelectorAll("button")] : [];
  state.deletingHistoryJobs.add(jobId);
  controls.forEach((control) => {
    control.disabled = true;
  });
  if (card) card.setAttribute("aria-busy", "true");
  button.textContent = "Excluindo...";
  button.classList.add("is-deleting");
  els.error.hidden = true;
  els.error.textContent = "";

  try {
    await fetch(`/api/podcast/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }).then(readJson);
    await loadHistory();
  } catch (error) {
    controls.forEach((control) => {
      control.disabled = false;
    });
    if (card) card.removeAttribute("aria-busy");
    button.textContent = "Excluir";
    button.classList.remove("is-deleting");
    els.error.hidden = false;
    els.error.textContent = error instanceof Error
      ? error.message
      : "Não foi possível excluir o projeto agora. Tente novamente.";
  } finally {
    state.deletingHistoryJobs.delete(jobId);
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
    state.timelineProjects.clear();
    state.timelineSelections.clear();
    state.timelineUndoStacks.clear();
    state.activeTimelineOutputId = null;
    state.jobId = latestJobId;
    localStorage.setItem(PODCAST_LAST_JOB_KEY, latestJobId);
    await refreshJob();
    return;
  }
  state.jobId = null;
  state.job = null;
  state.expandedOutputs.clear();
  state.outputTabs.clear();
  state.timelineProjects.clear();
  state.timelineSelections.clear();
  state.timelineUndoStacks.clear();
  state.activeTimelineOutputId = null;
  cancelPendingUiRenders();
  state.renderSelectionLocked = false;
  renderCandidates(null);
  renderOutputs(null);
  setProgress({ status: "queued", current_step: "queued", progress: 0 });
}

async function restoreLastJob() {
  const queryJobId = new URLSearchParams(window.location.search).get("job");
  const activeJobId = queryJobId ? "" : await latestActivePodcastJobId();
  const jobId = queryJobId || activeJobId || localStorage.getItem(PODCAST_LAST_JOB_KEY);
  if (!jobId) return;
  state.timelineProjects.clear();
  state.timelineSelections.clear();
  state.timelineUndoStacks.clear();
  state.activeTimelineOutputId = null;
  state.jobId = jobId;
  try {
    const payload = await fetch(`/api/podcast/jobs/${encodeURIComponent(jobId)}`).then(readJson);
    const job = normalizeJob(payload);
    if (!queryJobId && isInterruptedJob(job)) {
      localStorage.removeItem(PODCAST_LAST_JOB_KEY);
      state.jobId = null;
      state.job = null;
      state.expandedOutputs.clear();
      state.outputTabs.clear();
      state.timelineProjects.clear();
      state.timelineSelections.clear();
      state.timelineUndoStacks.clear();
      state.activeTimelineOutputId = null;
      cancelPendingUiRenders();
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
    state.expandedOutputs.clear();
    state.outputTabs.clear();
    state.timelineProjects.clear();
    state.timelineSelections.clear();
    state.timelineUndoStacks.clear();
    state.activeTimelineOutputId = null;
    cancelPendingUiRenders();
    state.renderSelectionLocked = false;
    renderCandidates(null);
    renderOutputs(null);
  }
}

async function latestPodcastJobId() {
  const payload = await fetch("/api/podcast/jobs?limit=10").then(readJson).catch(() => null);
  const jobs = payload?.data?.jobs || payload?.jobs || [];
  return (
    jobs.find((job) =>
      !isInterruptedJob(job) &&
      ["queued", "running", "ready", "rendering"].includes(String(job?.status || ""))
    )?.id ||
    jobs.find((job) => !isInterruptedJob(job) && job?.status !== "failed")?.id ||
    ""
  );
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

async function requestRenderSelectedCandidates(selectedIds, replaceExistingReady = false) {
  const subtitleAppearance = selectedSubtitleAppearance(GLOBAL_SUBTITLE_PREVIEW_ID);
  return fetch(`/api/podcast/jobs/${encodeURIComponent(state.jobId)}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selected_ids: selectedIds,
      replace_existing_ready: replaceExistingReady,
      burn_subtitles: els.burnSubtitles?.checked ?? true,
      remove_silence: els.removeSilence?.checked ?? true,
      artificial_cuts: els.artificialCuts?.checked ?? true,
      clip_format: selectedClipFormat(),
      ...subtitleAppearance,
    }),
  }).then(readJson);
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
  if (els.outputs) delete els.outputs.dataset.renderKey;
}

function removeOutput(outputId) {
  if (!state.job || !Array.isArray(state.job.outputs)) return;
  state.job.outputs = state.job.outputs.filter((output) => String(output?.id || "") !== String(outputId || ""));
  if (els.outputs) delete els.outputs.dataset.renderKey;
}

function ensureVideoSource(video) {
  if (!video) return null;
  attachEditPreviewVideoListeners(video);
  const source = video.dataset.src || video.dataset.videoUrl || "";
  if (source && video.getAttribute("src") !== source) {
    setEditPreviewLoading(video, true);
    video.src = source;
    video.load();
  } else {
    updateEditPreviewLoading(video);
  }
  return video;
}

function attachEditPreviewVideoListeners(video) {
  if (!video?.dataset?.editPreview || video.dataset.editPreviewListeners === "true") return;
  video.dataset.editPreviewListeners = "true";
  const settle = () => {
    settleEditPreviewLoading(video);
  };
  video.addEventListener("loadstart", () => setEditPreviewLoading(video, true));
  video.addEventListener("loadedmetadata", () => {
    applyPendingEditSeek(video);
    if (!hasPendingEditSeek(video)) settle();
  });
  video.addEventListener("loadeddata", settle);
  video.addEventListener("canplay", settle);
  video.addEventListener("canplaythrough", settle);
  video.addEventListener("seeked", () => settleEditPreviewLoading(video, { force: true }));
  video.addEventListener("timeupdate", settle);
  video.addEventListener("waiting", () => setEditPreviewLoading(video, true));
  video.addEventListener("stalled", () => setEditPreviewLoading(video, true));
}

function hasPendingEditSeek(video) {
  return Number.isFinite(Number(video?.dataset?.pendingSeek || ""));
}

function isEditPreviewReady(video) {
  return (
    Boolean(video?.currentSrc || video?.getAttribute?.("src")) &&
    !video.seeking &&
    video.readyState >= 2 &&
    !hasPendingEditSeek(video)
  );
}

function setEditPreviewLoading(video, loading) {
  const outputId = String(video?.dataset?.editPreview || "");
  const preview = video?.closest?.(".clip-editor-preview");
  const loader = outputId
    ? els.outputs.querySelector(`[data-edit-loader="${CSS.escape(outputId)}"]`)
    : preview?.querySelector?.("[data-edit-loader]");
  if (video?.dataset?.editPreviewLoadingTimer) {
    window.clearTimeout(Number(video.dataset.editPreviewLoadingTimer));
    delete video.dataset.editPreviewLoadingTimer;
  }
  if (preview) preview.classList.toggle("is-loading", Boolean(loading));
  if (loader) loader.hidden = !loading;
  if (video) {
    video.controls = !loading;
    if (loading) {
      video.dataset.editPreviewLoadingTimer = String(window.setTimeout(() => {
        if (!video.seeking && video.readyState >= 1) {
          delete video.dataset.pendingSeek;
          syncPreviewPlayhead(String(video.dataset.editPreview || ""));
          setEditPreviewLoading(video, false);
        }
      }, 2500));
    }
  }
}

function updateEditPreviewLoading(video) {
  setEditPreviewLoading(video, !isEditPreviewReady(video));
}

function settleEditPreviewLoading(video, options = {}) {
  if (!video) return false;
  if (!options.force && (video.seeking || video.readyState < 2)) return false;
  delete video.dataset.pendingSeek;
  syncPreviewPlayhead(String(video.dataset.editPreview || ""));
  setEditPreviewLoading(video, false);
  return true;
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

function selectSubtitleColorOption(outputId, textColor, borderColor) {
  if (!outputId || !textColor || !borderColor) return;
  const buttons = document.querySelectorAll(`[data-subtitle-color-option="${CSS.escape(outputId)}"]`);
  for (const button of buttons) {
    const selected = button.dataset.subtitleTextColor === textColor && button.dataset.subtitleBorderColor === borderColor;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
}

function selectSubtitleStyleOption(outputId, subtitleStyle) {
  if (!outputId || !subtitleStyle) return;
  const style = normalizeSubtitleStyleValue(subtitleStyle);
  const buttons = document.querySelectorAll(`[data-subtitle-style-option="${CSS.escape(outputId)}"]`);
  for (const button of buttons) {
    const selected = normalizeSubtitleStyleValue(button.dataset.subtitleStyle) === style;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  const group = document.querySelector(`[data-subtitle-style-group="${CSS.escape(outputId)}"]`);
  if (group) {
    group.dataset.subtitleStyle = style;
    for (const label of group.querySelectorAll(".subtitle-color-frame strong")) {
      label.textContent = subtitleAppearancePreviewTextForStyle(style, group.dataset.subtitlePreviewText || "");
    }
  }
  selectSubtitlePositionOption(outputId, style === "word" ? "middle" : "bottom");
}

function selectSubtitleSizeOption(outputId, size) {
  if (!outputId || !size) return;
  const buttons = document.querySelectorAll(`[data-subtitle-size-option="${CSS.escape(outputId)}"]`);
  for (const button of buttons) {
    const selected = button.dataset.subtitleSize === size;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  const group = document.querySelector(`[data-subtitle-size-group="${CSS.escape(outputId)}"]`);
  if (group) group.dataset.subtitleSize = size;
}

function selectSubtitlePositionOption(outputId, position) {
  if (!outputId || !position) return;
  const buttons = document.querySelectorAll(`[data-subtitle-position-option="${CSS.escape(outputId)}"]`);
  for (const button of buttons) {
    const selected = button.dataset.subtitlePosition === position;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  const group = document.querySelector(`[data-subtitle-position-group="${CSS.escape(outputId)}"]`);
  if (group) group.dataset.subtitlePosition = position;
}

async function ensureSubtitleEditorLoaded(outputId, button = null) {
  const editor = els.outputs.querySelector(`[data-subtitle-editor="${CSS.escape(outputId)}"]`);
  if (!editor || editor.dataset.loaded === "true") return editor;
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Carregando legenda...";
  }
  try {
    renderSubtitleTemplate(outputId, await loadSubtitle(outputId));
    return editor;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
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
    "Capa do corte";
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
  const lines = String(subtitle || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const blocks = [];

  for (let cursor = 0; cursor < lines.length;) {
    const timeIndex = lines.findIndex((line, index) => index >= cursor && line.includes("-->"));
    if (timeIndex < 0) break;

    const nextTimeIndex = lines.findIndex((line, index) => index > timeIndex && line.includes("-->"));
    const maybeIndex = lines[timeIndex - 1]?.trim() || "";
    const index = /^\d+$/.test(maybeIndex) ? maybeIndex : String(blocks.length + 1);
    const textStart = timeIndex + 1;
    const textEnd = nextTimeIndex > -1 && /^\d+$/.test(lines[nextTimeIndex - 1]?.trim() || "")
      ? nextTimeIndex - 1
      : nextTimeIndex;
    const textLines = lines
      .slice(textStart, textEnd > -1 ? textEnd : lines.length)
      .filter((line) => line.trim() !== "");

    const range = parseSrtTimeRange(lines[timeIndex].trim());
    if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) {
      cursor = nextTimeIndex > -1 ? nextTimeIndex : lines.length;
      continue;
    }

    blocks.push({
      index,
      time: lines[timeIndex].trim(),
      startMs: range.startMs,
      endMs: range.endMs,
      text: textLines.join("\n").trim(),
    });
    cursor = nextTimeIndex > -1 ? nextTimeIndex : lines.length;
  }

  return blocks;
}

function subtitleFromBlocks(blocks) {
  return blocks
    .map((block, index) => {
      const subtitleIndex = block.subtitleIndex || block.index || String(index + 1);
      const startMs = Math.round(Number(block.startMs));
      const endMs = Math.round(Number(block.endMs));
      const text = String(block.text || "").trim() || " ";
      const subtitleTime = `${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}`;
      return `${subtitleIndex}\n${subtitleTime}\n${text}`;
    })
    .join("\n\n");
}

function canonicalSubtitle(subtitle) {
  const blocks = parseSrtBlocks(subtitle);
  if (!blocks.length) return String(subtitle || "").trim();
  return subtitleFromBlocks(blocks);
}

function subtitleTemplateRowHtml(outputId, block, index, blocks) {
  const previousEndMs = index > 0 ? blocks[index - 1].endMs : 0;
  const nextStartMs = blocks[index + 1]?.startMs;
  const canInsertAfter = Number.isFinite(nextStartMs) && nextStartMs > block.endMs + 1;
  return `
    <article
      class="subtitle-template-row"
      data-subtitle-block="${escapeHtml(outputId)}"
      data-subtitle-index="${escapeHtml(block.index || index + 1)}"
      data-subtitle-original-time="${escapeHtml(block.time || subtitleTimeTextFromBlock(block))}"
      data-subtitle-start-ms="${escapeHtml(block.startMs)}"
      data-subtitle-end-ms="${escapeHtml(block.endMs)}"
      data-subtitle-min-start-ms="${escapeHtml(previousEndMs)}"
      data-subtitle-max-end-ms="${Number.isFinite(nextStartMs) ? escapeHtml(nextStartMs) : ""}"
    >
      <div class="subtitle-template-meta">
        <span data-subtitle-row-number>${escapeHtml(block.index || index + 1)}</span>
        <button
          type="button"
          class="subtitle-template-time"
          data-subtitle-time-toggle="${escapeHtml(outputId)}"
        >
          ${escapeHtml(block.time || subtitleTimeTextFromBlock(block))}
        </button>
        <button
          type="button"
          class="subtitle-insert-button"
          data-subtitle-insert-after="${escapeHtml(outputId)}"
          ${canInsertAfter ? "" : "disabled"}
          aria-label="Inserir legenda neste intervalo"
          title="${canInsertAfter ? "Inserir legenda entre este tempo e o próximo" : "Não há intervalo livre até a próxima legenda"}"
        >
          +
        </button>
        <div class="subtitle-template-time-editor" data-subtitle-time-editor="${escapeHtml(outputId)}" hidden></div>
      </div>
      <textarea
        class="output-edit-textarea subtitle-template-text"
        data-subtitle-text="${escapeHtml(outputId)}"
        rows="2"
        spellcheck="true"
      >${escapeHtml(block.text)}</textarea>
    </article>
  `;
}

function subtitleTimeTextFromBlock(block) {
  const startMs = Math.round(Number(block?.startMs));
  const endMs = Math.round(Number(block?.endMs));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  return `${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}`;
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
  editor.innerHTML = blocks.map((block, index) => subtitleTemplateRowHtml(outputId, block, index, blocks)).join("");
  editor.dataset.loaded = "true";
  editor.dataset.savedSubtitle = canonicalSubtitle(subtitle);
}

function subtitleFromTemplate(outputId) {
  commitOpenSubtitleTimeEdit(outputId);
  const rows = [...els.outputs.querySelectorAll(`[data-subtitle-block="${CSS.escape(outputId)}"]`)];
  if (!rows.length) {
    throw new Error("Legenda não carregada. Abra o editor novamente.");
  }
  const blocks = rows.map((row, index) => {
    const subtitleIndex = row.dataset.subtitleIndex || String(index + 1);
    const startMs = Math.round(Number(row.dataset.subtitleStartMs));
    const endMs = Math.round(Number(row.dataset.subtitleEndMs));
    const text = row.querySelector("[data-subtitle-text]")?.value?.trim() || "";
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error(`Tempo inválido na legenda ${subtitleIndex}.`);
    }
    if (endMs <= startMs) {
      throw new Error(`O fim da legenda ${subtitleIndex} precisa ser maior que o início.`);
    }
    return { subtitleIndex, startMs, endMs, text };
  });

  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    if (previous && block.startMs < previous.endMs) {
      throw new Error(`A legenda ${block.subtitleIndex} começa antes da legenda anterior terminar.`);
    }
  });

  return subtitleFromBlocks(blocks);
}

function subtitleTimeTextFromRow(row) {
  const startMs = Math.round(Number(row?.dataset.subtitleStartMs));
  const endMs = Math.round(Number(row?.dataset.subtitleEndMs));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  return `${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}`;
}

function subtitleBlockFromRow(row, fallbackIndex = 1) {
  const startMs = Math.round(Number(row?.dataset.subtitleStartMs));
  const endMs = Math.round(Number(row?.dataset.subtitleEndMs));
  return {
    index: String(row?.dataset.subtitleIndex || fallbackIndex),
    time: subtitleTimeTextFromRow(row),
    startMs: Number.isFinite(startMs) ? startMs : 0,
    endMs: Number.isFinite(endMs) ? endMs : 0,
    text: row?.querySelector("[data-subtitle-text]")?.value || "",
  };
}

function refreshSubtitleTemplateRows(outputId) {
  const rows = [...els.outputs.querySelectorAll(`[data-subtitle-block="${CSS.escape(outputId)}"]`)];
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    const next = rows[index + 1];
    const previousEndMs = previous ? Math.round(Number(previous.dataset.subtitleEndMs || 0)) : 0;
    const nextStartMs = next ? Math.round(Number(next.dataset.subtitleStartMs || 0)) : Infinity;
    const startMs = Math.round(Number(row.dataset.subtitleStartMs || 0));
    const endMs = Math.round(Number(row.dataset.subtitleEndMs || 0));
    const number = String(index + 1);
    row.dataset.subtitleIndex = number;
    row.dataset.subtitleMinStartMs = String(Math.max(0, previousEndMs));
    row.dataset.subtitleMaxEndMs = Number.isFinite(nextStartMs) ? String(nextStartMs) : "";
    const label = row.querySelector("[data-subtitle-row-number]");
    if (label) label.textContent = number;
    const timeToggle = row.querySelector("[data-subtitle-time-toggle]");
    if (timeToggle) timeToggle.textContent = subtitleTimeTextFromRow(row);
    const insertButton = row.querySelector("[data-subtitle-insert-after]");
    if (insertButton) {
      const canInsertAfter = Number.isFinite(nextStartMs) && nextStartMs > endMs + 1;
      insertButton.disabled = !canInsertAfter;
      insertButton.title = canInsertAfter
        ? "Inserir legenda entre este tempo e o próximo"
        : "Não há intervalo livre até a próxima legenda";
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      row.dataset.subtitleStartMs = "0";
      row.dataset.subtitleEndMs = "1";
    }
  });
}

function insertSubtitleRowAfter(outputId, row) {
  if (!row) return;
  closeSubtitleTimeEditors(outputId);
  const rows = [...els.outputs.querySelectorAll(`[data-subtitle-block="${CSS.escape(outputId)}"]`)];
  const rowIndex = rows.indexOf(row);
  const nextRow = rows[rowIndex + 1];
  if (!nextRow) {
    throw new Error("Só é possível inserir uma legenda entre dois tempos existentes.");
  }
  const currentEndMs = Math.round(Number(row.dataset.subtitleEndMs || 0));
  const nextStartMs = Math.round(Number(nextRow.dataset.subtitleStartMs || 0));
  if (!Number.isFinite(currentEndMs) || !Number.isFinite(nextStartMs) || nextStartMs <= currentEndMs + 1) {
    throw new Error("Não há intervalo livre suficiente para inserir uma legenda aqui.");
  }

  const currentBlocks = rows.map((item, index) => subtitleBlockFromRow(item, index + 1));
  const newBlock = {
    index: String(rowIndex + 2),
    time: `${formatSrtTimestamp(currentEndMs)} --> ${formatSrtTimestamp(nextStartMs)}`,
    startMs: currentEndMs,
    endMs: nextStartMs,
    text: "",
  };
  const blocksWithInsert = [
    ...currentBlocks.slice(0, rowIndex + 1),
    newBlock,
    ...currentBlocks.slice(rowIndex + 1),
  ];
  const wrapper = document.createElement("div");
  wrapper.innerHTML = subtitleTemplateRowHtml(outputId, newBlock, rowIndex + 1, blocksWithInsert).trim();
  const insertedRow = wrapper.firstElementChild;
  if (!insertedRow) return;
  row.insertAdjacentElement("afterend", insertedRow);
  refreshSubtitleTemplateRows(outputId);
  insertedRow.querySelector("[data-subtitle-text]")?.focus();
}

function closeSubtitleTimeEditors(outputId, exceptRow = null) {
  const rows = [...els.outputs.querySelectorAll(`[data-subtitle-block="${CSS.escape(outputId)}"]`)];
  rows.forEach((row) => {
    if (exceptRow && row === exceptRow) return;
    const editor = row.querySelector("[data-subtitle-time-editor]");
    const toggle = row.querySelector("[data-subtitle-time-toggle]");
    if (editor) {
      editor.hidden = true;
      editor.innerHTML = "";
    }
    if (toggle) toggle.hidden = false;
  });
}

function subtitleTimeLimits(row) {
  const minStartMs = Math.max(0, Math.round(Number(row?.dataset.subtitleMinStartMs || 0)));
  const startMs = Math.max(0, Math.round(Number(row?.dataset.subtitleStartMs || 0)));
  const endMs = Math.max(0, Math.round(Number(row?.dataset.subtitleEndMs || 0)));
  const maxEndRaw = row?.dataset.subtitleMaxEndMs;
  const maxEndMs = maxEndRaw === "" || maxEndRaw == null ? Infinity : Math.round(Number(maxEndRaw));
  return { minStartMs, startMs, endMs, maxEndMs };
}

function clampSubtitleTimeEditor(row) {
  const startInput = row?.querySelector("[data-subtitle-start-input]");
  const endInput = row?.querySelector("[data-subtitle-end-input]");
  if (!startInput || !endInput) return;
  const limits = subtitleTimeLimits(row);
  let startMs = Math.round(Number(startInput.value) * 1000);
  let endMs = Math.round(Number(endInput.value) * 1000);
  if (!Number.isFinite(startMs)) startMs = limits.startMs;
  if (!Number.isFinite(endMs)) endMs = limits.endMs;
  startMs = Math.max(limits.minStartMs, startMs);
  endMs = Math.min(limits.maxEndMs, Math.max(startMs + 1, endMs));
  startMs = Math.min(startMs, endMs - 1);
  startInput.value = formatSubtitleSecondValue(startMs);
  endInput.value = formatSubtitleSecondValue(endMs);
}

function openSubtitleTimeEditor(outputId, row) {
  if (!row) return;
  closeSubtitleTimeEditors(outputId, row);
  const editor = row.querySelector("[data-subtitle-time-editor]");
  const toggle = row.querySelector("[data-subtitle-time-toggle]");
  if (!editor || !toggle) return;
  const limits = subtitleTimeLimits(row);
  const maxEndLabel = Number.isFinite(limits.maxEndMs) ? formatSubtitleSecondValue(limits.maxEndMs) : "";
  editor.innerHTML = `
    <div class="subtitle-template-time-fields">
      <label>
        Início
        <input
          class="output-edit-input subtitle-time-input"
          data-subtitle-start-input
          type="number"
          min="${escapeHtml(formatSubtitleSecondValue(limits.minStartMs))}"
          max="${escapeHtml(formatSubtitleSecondValue(Math.max(limits.minStartMs, limits.endMs - 1)))}"
          step="0.001"
          value="${escapeHtml(formatSubtitleSecondValue(limits.startMs))}"
        />
      </label>
      <label>
        Fim
        <input
          class="output-edit-input subtitle-time-input"
          data-subtitle-end-input
          type="number"
          min="${escapeHtml(formatSubtitleSecondValue(limits.startMs + 1))}"
          ${maxEndLabel ? `max="${escapeHtml(maxEndLabel)}"` : ""}
          step="0.001"
          value="${escapeHtml(formatSubtitleSecondValue(limits.endMs))}"
        />
      </label>
    </div>
    <div class="subtitle-template-time-actions">
      <button type="button" class="secondary-button" data-subtitle-time-apply="${escapeHtml(outputId)}">Aplicar</button>
      <button type="button" class="secondary-button" data-subtitle-time-cancel="${escapeHtml(outputId)}">Cancelar</button>
    </div>
  `;
  toggle.hidden = true;
  editor.hidden = false;
  editor.querySelector("[data-subtitle-start-input]")?.focus();
}

function commitOpenSubtitleTimeEdit(outputId) {
  const editor = els.outputs.querySelector(
    `[data-subtitle-time-editor="${CSS.escape(outputId)}"]:not([hidden])`,
  );
  if (!editor) return false;
  const row = editor.closest("[data-subtitle-block]");
  if (!row) return false;
  clampSubtitleTimeEditor(row);
  const startInput = row.querySelector("[data-subtitle-start-input]");
  const endInput = row.querySelector("[data-subtitle-end-input]");
  const startMs = Math.round(Number(startInput?.value) * 1000);
  const endMs = Math.round(Number(endInput?.value) * 1000);
  const limits = subtitleTimeLimits(row);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("Tempo de legenda inválido.");
  }
  if (startMs < limits.minStartMs) {
    throw new Error("O início da legenda não pode ficar antes do fim da legenda anterior.");
  }
  if (Number.isFinite(limits.maxEndMs) && endMs > limits.maxEndMs) {
    throw new Error("O fim da legenda não pode passar do início da próxima legenda.");
  }
  if (endMs <= startMs) {
    throw new Error("O fim da legenda precisa ser maior que o início.");
  }
  row.dataset.subtitleStartMs = String(startMs);
  row.dataset.subtitleEndMs = String(endMs);
  const toggle = row.querySelector("[data-subtitle-time-toggle]");
  if (toggle) {
    toggle.textContent = subtitleTimeTextFromRow(row);
    toggle.hidden = false;
  }
  editor.hidden = true;
  editor.innerHTML = "";
  refreshSubtitleTemplateRows(outputId);
  return true;
}

async function saveSubtitle(outputId, subtitle) {
  const fallbackOutput = (state.job?.outputs || []).find((output) => String(output?.id || "") === String(outputId));
  const appearance = selectedSubtitleAppearance(outputId, fallbackOutput);
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/subtitle`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtitle, ...appearance }),
    },
  ).then(readJson);
  return payload?.data?.output || payload?.output || null;
}

async function setSubtitleMode(outputId, burnSubtitles) {
  const fallbackOutput = (state.job?.outputs || []).find((output) => String(output?.id || "") === String(outputId));
  const appearance = selectedSubtitleAppearance(outputId, fallbackOutput);
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/subtitle-mode`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ burn_subtitles: burnSubtitles, ...appearance }),
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

async function saveOutputTimeline(outputId) {
  const timelineProject = timelineProjectPayload(outputId);
  if (!timelineProject) throw new Error("Timeline inválida.");
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/timeline`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeline_project: timelineProject }),
    },
  ).then(readJson);
  return payload?.data?.output || payload?.output || null;
}

async function exportEditedOutput(outputId) {
  const { start, end } = trimValues(outputId);
  const recoverBefore = Number(els.outputs.querySelector(`[data-recover-before="${CSS.escape(outputId)}"]`)?.value || 0);
  const recoverAfter = Number(els.outputs.querySelector(`[data-recover-after="${CSS.escape(outputId)}"]`)?.value || 0);
  const appendOutputId = String(els.outputs.querySelector(`[data-edit-append="${CSS.escape(outputId)}"]`)?.value || "");
  const appendPosition = String(els.outputs.querySelector(`[data-edit-position="${CSS.escape(outputId)}"]`)?.value || "after");
  if (end - start < 1) {
    throw new Error("O corte editado precisa ter pelo menos 1 segundo.");
  }
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/edit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trim_start: start,
        trim_end: end,
        recover_before: Number.isFinite(recoverBefore) ? Math.max(0, recoverBefore) : 0,
        recover_after: Number.isFinite(recoverAfter) ? Math.max(0, recoverAfter) : 0,
        append_output_id: appendOutputId,
        append_position: appendPosition === "before" ? "before" : "after",
      }),
    },
  ).then(readJson);
  return payload?.data?.output || payload?.output || null;
}

async function deleteEditedOutput(outputId) {
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}`,
    { method: "DELETE" },
  ).then(readJson);
  return payload?.data?.deleted_output_id || payload?.deleted_output_id || outputId;
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

function recoveryValues(outputId) {
  const beforeInput = els.outputs.querySelector(`[data-recover-before="${CSS.escape(outputId)}"]`);
  const afterInput = els.outputs.querySelector(`[data-recover-after="${CSS.escape(outputId)}"]`);
  const recoverBefore = Math.max(0, Number(beforeInput?.value || 0));
  const recoverAfter = Math.max(0, Number(afterInput?.value || 0));
  return {
    recoverBefore: Number.isFinite(recoverBefore) ? recoverBefore : 0,
    recoverAfter: Number.isFinite(recoverAfter) ? recoverAfter : 0,
  };
}

function hasClipEditChanges(outputId) {
  const epsilon = 0.0005;
  const { start, end, duration } = trimValues(outputId);
  const { recoverBefore, recoverAfter } = recoveryValues(outputId);
  const appendOutputId = String(els.outputs.querySelector(`[data-edit-append="${CSS.escape(outputId)}"]`)?.value || "");
  return (
    start > epsilon ||
    Math.abs(end - duration) > epsilon ||
    recoverBefore > epsilon ||
    recoverAfter > epsilon ||
    Boolean(appendOutputId)
  );
}

function updateEditSaveState(outputId) {
  if (!outputId) return;
  const enabled = hasClipEditChanges(outputId) && !state.actionLocked;
  els.outputs.querySelectorAll(`[data-edit-save="${CSS.escape(outputId)}"]`).forEach((button) => {
    button.disabled = !enabled;
    button.setAttribute("aria-disabled", enabled ? "false" : "true");
  });
}

function updateVisibleEditSaveStates() {
  els.outputs.querySelectorAll("[data-edit-save]").forEach((button) => {
    updateEditSaveState(button.dataset.editSave || "");
  });
}

function setEditMediaSelection(outputId, mediaId) {
  const id = String(outputId || "");
  const selectedMediaId = String(mediaId || "");
  const picker = els.outputs.querySelector(`[data-edit-media-picker="${CSS.escape(id)}"]`);
  if (!picker) return;
  const appendInput = picker.querySelector(`[data-edit-append="${CSS.escape(id)}"]`);
  if (appendInput) appendInput.value = selectedMediaId;
  picker.querySelectorAll("[data-edit-media-option]").forEach((card) => {
    card.dataset.selected = card.dataset.editMediaId === selectedMediaId ? "true" : "false";
  });
  picker.querySelectorAll("[data-edit-media-position], [data-edit-media-clear]").forEach((button) => {
    button.disabled = !selectedMediaId;
  });
  updateEditSaveState(id);
}

function setEditMediaPosition(outputId, position) {
  const id = String(outputId || "");
  const nextPosition = position === "before" ? "before" : "after";
  const picker = els.outputs.querySelector(`[data-edit-media-picker="${CSS.escape(id)}"]`);
  if (!picker) return;
  const positionInput = picker.querySelector(`[data-edit-position="${CSS.escape(id)}"]`);
  if (positionInput) positionInput.value = nextPosition;
  picker.querySelectorAll("[data-edit-media-position]").forEach((button) => {
    button.dataset.selected = button.dataset.position === nextPosition ? "true" : "false";
  });
  updateEditSaveState(id);
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

function syncClipRangeTimeline(outputId, options = {}) {
  const { start, end, duration } = trimValues(outputId);
  const { startInput, endInput } = trimInputs(outputId);
  const normalizeInputs = options.normalizeInputs !== false;
  if (normalizeInputs && startInput && startInput.value !== start.toFixed(3)) startInput.value = start.toFixed(3);
  if (normalizeInputs && endInput && endInput.value !== end.toFixed(3)) endInput.value = end.toFixed(3);

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
  if (durationLabel) durationLabel.textContent = `Tempo total do corte: ${formatMilliseconds(end - start)}`;
  if (endLabel) endLabel.textContent = `Fim: ${formatMilliseconds(end)}`;
  if (previewStart) previewStart.textContent = formatSeconds(start);
  if (previewEnd) previewEnd.textContent = formatSeconds(end);
  if (previewSelected) previewSelected.textContent = formatSeconds(end - start);
  if (previewCurrent && preview) previewCurrent.textContent = formatSeconds(preview.currentTime || 0);
  syncPreviewPlayhead(outputId);
  updateEditSaveState(outputId);
}

function syncPreviewPlayhead(outputId) {
  const preview = els.outputs.querySelector(`[data-edit-preview="${CSS.escape(outputId)}"]`);
  const duration = clipDuration(outputId);
  if (!preview) return;
  const current = Math.max(0, Math.min(Number(preview.currentTime || 0), duration));
  setRangePlayheadPosition(outputId, current);
}

function setRangePlayheadPosition(outputId, time) {
  const playhead = els.outputs.querySelector(`[data-range-playhead="${CSS.escape(outputId)}"]`);
  const rulerPlayhead = els.outputs.querySelector(`[data-range-ruler-playhead="${CSS.escape(outputId)}"]`);
  const ruler = els.outputs.querySelector(`[data-range-ruler="${CSS.escape(outputId)}"]`);
  const previewCurrent = els.outputs.querySelector(`[data-preview-current="${CSS.escape(outputId)}"]`);
  const duration = clipDuration(outputId);
  const current = Math.max(0, Math.min(Number(time || 0), duration));
  const left = `${(current / duration) * 100}%`;
  if (playhead) playhead.style.left = left;
  if (rulerPlayhead) rulerPlayhead.style.left = left;
  if (ruler) ruler.setAttribute("aria-valuenow", current.toFixed(3));
  if (previewCurrent) previewCurrent.textContent = formatSeconds(current);
  return current;
}

function finishPendingEditSeek(video) {
  const outputId = String(video?.dataset?.editPreview || "");
  const pending = Number(video?.dataset?.pendingSeek || "");
  if (!outputId || !Number.isFinite(pending) || video.seeking) return false;
  const target = Math.max(0, Math.min(pending, clipDuration(outputId)));
  const current = Math.max(0, Math.min(Number(video.currentTime || 0), clipDuration(outputId)));
  if (Math.abs(current - target) > 0.5 && video.readyState < 2) return false;
  delete video.dataset.pendingSeek;
  setRangePlayheadPosition(outputId, current);
  return true;
}

function applyPendingEditSeek(video) {
  const outputId = String(video?.dataset?.editPreview || "");
  const pending = Number(video?.dataset?.pendingSeek || "");
  if (!outputId || !Number.isFinite(pending) || video.readyState < 1) return false;
  const target = Math.max(0, Math.min(pending, clipDuration(outputId)));
  try {
    video.currentTime = target;
    setRangePlayheadPosition(outputId, target);
    window.setTimeout(() => {
      finishPendingEditSeek(video);
      settleEditPreviewLoading(video);
    }, 180);
    return true;
  } catch (_error) {
    video.dataset.pendingSeek = String(target);
    return false;
  }
}

function seekPreview(outputId, time) {
  const preview = loadEditPreviewVideo(outputId);
  if (!preview) return;
  const target = Math.max(0, Math.min(Number(time || 0), clipDuration(outputId)));
  preview.dataset.pendingSeek = String(target);
  setRangePlayheadPosition(outputId, target);
  setEditPreviewLoading(preview, true);
  if (!applyPendingEditSeek(preview)) {
    preview.addEventListener("loadedmetadata", () => applyPendingEditSeek(preview), { once: true });
  }
}

function seekPreviewFromRangeElement(outputId, element, clientX) {
  if (!outputId || !element) return;
  const rect = element.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  seekPreview(outputId, ratio * clipDuration(outputId));
}

els.outputs.addEventListener("click", async (event) => {
  if (event.flixoTimelineHandled) return;

  const nleTrimHandle = event.target.closest("[data-nle-trim-handle]");
  if (nleTrimHandle) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const nleSplitButton = event.target.closest("[data-nle-split]");
  if (nleSplitButton) {
    event.preventDefault();
    event.stopPropagation();
    handleTimelineSplitAction(nleSplitButton.dataset.nleSplit || "");
    return;
  }

  const nleInsertAsset = event.target.closest("[data-nle-insert]");
  if (nleInsertAsset) {
    event.preventDefault();
    event.stopPropagation();
    handleTimelineInsertAction(nleInsertAsset.dataset.nleInsert || "", nleInsertAsset.dataset.nleAssetId || "");
    return;
  }

  const nleUndoButton = event.target.closest("[data-nle-undo]");
  if (nleUndoButton) {
    event.preventDefault();
    event.stopPropagation();
    if (!undoTimelineAction(nleUndoButton.dataset.nleUndo || "")) {
      els.outputsMeta.textContent = "Nenhuma ação da timeline para desfazer.";
    }
    return;
  }

  const nleAudioAddButton = event.target.closest("[data-nle-audio-add]");
  if (nleAudioAddButton) {
    event.preventDefault();
    event.stopPropagation();
    els.error.hidden = true;
    els.error.textContent = "";
    els.outputsMeta.textContent = "Faixa de audio preparada. O upload/biblioteca de audio entra na proxima etapa.";
    return;
  }

  if (state.actionLocked && event.target.closest("button, a.secondary-button")) {
    event.preventDefault();
    return;
  }

  const editMediaOption = event.target.closest("[data-edit-media-option]");
  if (editMediaOption) {
    event.preventDefault();
    setEditMediaSelection(
      editMediaOption.dataset.editMediaOption || "",
      editMediaOption.dataset.editMediaId || "",
    );
    return;
  }

  const editMediaPosition = event.target.closest("[data-edit-media-position]");
  if (editMediaPosition) {
    event.preventDefault();
    setEditMediaPosition(
      editMediaPosition.dataset.editMediaPosition || "",
      editMediaPosition.dataset.position || "after",
    );
    return;
  }

  const editMediaClear = event.target.closest("[data-edit-media-clear]");
  if (editMediaClear) {
    event.preventDefault();
    setEditMediaSelection(editMediaClear.dataset.editMediaClear || "", "");
    return;
  }

  const playButton = event.target.closest("[data-output-play]");
  if (playButton) {
    playOutputVideo(playButton.dataset.outputPlay || "");
    return;
  }

  const outputTab = event.target.closest("[data-output-tab]");
  if (outputTab) {
    selectOutputTab(outputTab.dataset.outputTab || "", outputTab.dataset.outputTabTarget || "");
    return;
  }

  const detailsToggle = event.target.closest("[data-output-details-toggle]");
  if (detailsToggle) {
    const outputId = String(detailsToggle.dataset.outputDetailsToggle || "");
    if (!outputId) return;
    const details = els.outputs.querySelector(`[data-output-details="${CSS.escape(outputId)}"]`);
    const expanded = details?.hidden === true;
    if (expanded) {
      state.expandedOutputs.add(outputId);
    } else {
      state.expandedOutputs.delete(outputId);
    }
    if (details) details.hidden = !expanded;
    detailsToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    detailsToggle.textContent = expanded ? "Esconder" : "Mostrar mais";
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

  const subtitleColorOption = event.target.closest("[data-subtitle-color-option]");
  if (subtitleColorOption) {
    selectSubtitleColorOption(
      subtitleColorOption.dataset.subtitleColorOption,
      subtitleColorOption.dataset.subtitleTextColor,
      subtitleColorOption.dataset.subtitleBorderColor,
    );
    return;
  }

  const subtitleStyleOption = event.target.closest("[data-subtitle-style-option]");
  if (subtitleStyleOption) {
    selectSubtitleStyleOption(
      subtitleStyleOption.dataset.subtitleStyleOption,
      subtitleStyleOption.dataset.subtitleStyle,
    );
    return;
  }

  const subtitleSizeOption = event.target.closest("[data-subtitle-size-option]");
  if (subtitleSizeOption) {
    selectSubtitleSizeOption(subtitleSizeOption.dataset.subtitleSizeOption, subtitleSizeOption.dataset.subtitleSize);
    return;
  }

  const subtitlePositionOption = event.target.closest("[data-subtitle-position-option]");
  if (subtitlePositionOption) {
    selectSubtitlePositionOption(
      subtitlePositionOption.dataset.subtitlePositionOption,
      subtitlePositionOption.dataset.subtitlePosition,
    );
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
      els.outputsMeta.textContent = "Alterações salvas.";
    } catch (error) {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setActionLocked(false);
      metadataSave.disabled = false;
      metadataSave.textContent = "Salvar alterações";
    }
    return;
  }

  const youtubeButton = event.target.closest(".youtube-upload-button");
  if (youtubeButton) {
    uploadOutputToYoutube(youtubeButton.dataset.outputId, youtubeButton);
    return;
  }

  if (Date.now() < state.suppressTimelineClickUntil) {
    event.preventDefault();
    return;
  }

  const timelineRuler = event.target.closest("[data-nle-ruler]");
  if (timelineRuler) {
    setTimelinePlayheadFromClientX(String(timelineRuler.dataset.nleRuler || ""), timelineRuler, event.clientX);
    return;
  }

  const timelineClip = event.target.closest("[data-nle-clip]");
  if (timelineClip) {
    const outputId = String(timelineClip.dataset.nleClip || "");
    const clipId = String(timelineClip.dataset.nleClipId || "");
    const output = outputById(outputId);
    if (!output || !clipId) return;
    const project = timelineProjectForOutput(output);
    const clip = timelineClipById(project, clipId);
    if (!clip) return;
    setActiveTimelineOutput(outputId);
    state.timelineSelections.set(outputId, clip.id);
    const track = timelineClip.closest("[data-nle-track]");
    if (track) {
      setTimelinePlayheadFromClientX(outputId, track, event.clientX);
    } else {
      project.playhead = clip.timelineStart;
      syncTimelinePreview(outputId);
    }
    return;
  }

  const timelineTrack = event.target.closest("[data-nle-track]");
  if (timelineTrack && !event.target.closest("[data-nle-clip]")) {
    setTimelinePlayheadFromClientX(String(timelineTrack.dataset.nleTrack || ""), timelineTrack, event.clientX);
    return;
  }

  const moveButton = event.target.closest("[data-nle-move]");
  if (moveButton) {
    moveTimelineClip(moveButton.dataset.nleMove || "", moveButton.dataset.nleDirection || "right");
    return;
  }

  const deleteTimelineButton = event.target.closest("[data-nle-delete]");
  if (deleteTimelineButton) {
    if (!deleteTimelineClip(deleteTimelineButton.dataset.nleDelete || "")) {
      els.error.hidden = false;
      els.error.textContent = "A timeline precisa manter pelo menos um trecho.";
    }
    return;
  }

  const timelineSave = event.target.closest("[data-timeline-save]");
  if (timelineSave) {
    const outputId = String(timelineSave.dataset.timelineSave || "");
    if (!outputId) return;
    const originalText = timelineSave.textContent;
    setActionLocked(true);
    timelineSave.disabled = true;
    timelineSave.textContent = "Salvando...";
    try {
      const updatedOutput = await saveOutputTimeline(outputId);
      if (updatedOutput) replaceOutput(updatedOutput);
      els.outputsMeta.textContent = "Timeline salva.";
      renderOutputs(state.job);
      loadHistory().catch(() => {});
    } catch (error) {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setActionLocked(false);
      if (document.contains(timelineSave)) {
        timelineSave.disabled = false;
        timelineSave.textContent = originalText;
      }
    }
    return;
  }

  const outputDelete = event.target.closest("[data-output-delete]");
  if (outputDelete) {
    const outputId = String(outputDelete.dataset.outputDelete || "");
    if (!outputId) return;
    const confirmed = await confirmAction({
      title: "Excluir este clipe?",
      message: "Este clipe editado será removido do projeto, incluindo vídeo, legenda e capas geradas para ele. Os clipes originais permanecem disponíveis.",
      confirmLabel: "Excluir clipe",
    });
    if (!confirmed) return;
    const originalText = outputDelete.textContent;
    setActionLocked(true);
    outputDelete.disabled = true;
    outputDelete.textContent = "Excluindo...";
    outputDelete.classList.add("is-deleting");
    try {
      const deletedId = await deleteEditedOutput(outputId);
      removeOutput(deletedId);
      renderOutputs(state.job);
      loadHistory().catch(() => {});
      els.outputsMeta.textContent = "Clipe removido do projeto.";
    } catch (error) {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setActionLocked(false);
      if (document.contains(outputDelete)) {
        outputDelete.textContent = originalText;
        outputDelete.classList.remove("is-deleting");
      }
    }
    return;
  }

  const editSave = event.target.closest("[data-edit-save]");
  if (editSave) {
    const outputId = String(editSave.dataset.editSave || "");
    if (!outputId) return;
    const originalText = editSave.textContent;
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
      if (document.contains(editSave)) {
        editSave.textContent = originalText;
        updateEditSaveState(outputId);
      }
    }
    return;
  }

  const timeToggle = event.target.closest("[data-subtitle-time-toggle]");
  const timeApply = event.target.closest("[data-subtitle-time-apply]");
  const timeCancel = event.target.closest("[data-subtitle-time-cancel]");
  const timeInsert = event.target.closest("[data-subtitle-insert-after]");
  if (timeToggle || timeApply || timeCancel || timeInsert) {
    const outputId = String(
      timeToggle?.dataset.subtitleTimeToggle ||
        timeApply?.dataset.subtitleTimeApply ||
        timeCancel?.dataset.subtitleTimeCancel ||
        timeInsert?.dataset.subtitleInsertAfter ||
        "",
    );
    const row = (timeToggle || timeApply || timeCancel || timeInsert).closest("[data-subtitle-block]");
    try {
      if (timeToggle) {
        openSubtitleTimeEditor(outputId, row);
      } else if (timeApply) {
        commitOpenSubtitleTimeEdit(outputId);
      } else if (timeInsert) {
        insertSubtitleRowAfter(outputId, row);
      } else {
        closeSubtitleTimeEditors(outputId);
      }
    } catch (error) {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
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
    const confirmed = await confirmAction({
      title: burnSubtitles ? "Salvar clipe com legenda?" : "Salvar clipe sem legenda?",
      message: burnSubtitles
        ? "As alterações feitas na legenda serão salvas antes de gerar uma nova versão do vídeo com texto embutido."
        : "As alterações feitas na legenda serão salvas e o arquivo SRT continuará disponível para download, mas a nova versão do vídeo será gerada sem texto embutido.",
      confirmLabel: burnSubtitles ? "Salvar com legenda" : "Salvar sem legenda",
    });
    if (!confirmed) return;
    setActionLocked(true);
    mode.disabled = true;
    mode.textContent = burnSubtitles ? "Aplicando legenda..." : "Preparando vídeo...";
    try {
      if (editor?.dataset.loaded === "true") {
        mode.textContent = "Salvando legenda...";
        await saveSubtitle(outputId, subtitleFromTemplate(outputId));
        mode.textContent = burnSubtitles ? "Aplicando legenda..." : "Preparando vídeo...";
      }
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
    await ensureSubtitleEditorLoaded(outputId);
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
    save.textContent = "Salvar alterações no clipe atual";
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

  const subtitleTimeInput = event.target.closest("[data-subtitle-start-input], [data-subtitle-end-input]");
  if (subtitleTimeInput) {
    return;
  }

  const startInput = event.target.closest("[data-edit-start]");
  const endInput = event.target.closest("[data-edit-end]");
  const recoverBeforeInput = event.target.closest("[data-recover-before]");
  const recoverAfterInput = event.target.closest("[data-recover-after]");
  const outputId =
    startInput?.dataset.editStart ||
    endInput?.dataset.editEnd ||
    recoverBeforeInput?.dataset.recoverBefore ||
    recoverAfterInput?.dataset.recoverAfter ||
    "";
  if (!outputId) return;
  if (startInput || endInput) {
    syncClipRangeTimeline(outputId, { normalizeInputs: false });
  } else {
    updateEditSaveState(outputId);
  }
});

els.outputs.addEventListener("focusout", (event) => {
  const trimInput = event.target.closest("[data-edit-start], [data-edit-end]");
  if (trimInput) {
    const outputId = trimInput.dataset.editStart || trimInput.dataset.editEnd || "";
    if (outputId) syncClipRangeTimeline(outputId);
    return;
  }

  const subtitleTimeInput = event.target.closest("[data-subtitle-start-input], [data-subtitle-end-input]");
  if (!subtitleTimeInput) return;
  const row = subtitleTimeInput.closest("[data-subtitle-block]");
  clampSubtitleTimeEditor(row);
});

els.outputs.addEventListener("change", (event) => {
  const trimInput = event.target.closest("[data-edit-start], [data-edit-end]");
  if (trimInput) {
    const outputId = trimInput.dataset.editStart || trimInput.dataset.editEnd || "";
    if (outputId) syncClipRangeTimeline(outputId);
    return;
  }

  const nleSourceIn = event.target.closest("[data-nle-source-in]");
  const nleSourceOut = event.target.closest("[data-nle-source-out]");
  if (nleSourceIn || nleSourceOut) {
    trimTimelineClip(
      nleSourceIn?.dataset.nleSourceIn || nleSourceOut?.dataset.nleSourceOut || "",
      nleSourceIn ? "sourceIn" : "sourceOut",
      nleSourceIn?.value || nleSourceOut?.value || 0,
    );
    return;
  }

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

document.addEventListener("keydown", (event) => {
  if (document.body.classList.contains("has-open-modal") || isEditableShortcutTarget(event.target)) return;

  const outputId = currentTimelineShortcutOutputId(event.target);
  if (!outputId) return;

  const key = String(event.key || "").toLowerCase();
  const isUndo = (event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey;
  if (isUndo) {
    event.preventDefault();
    if (!undoTimelineAction(outputId)) {
      els.outputsMeta.textContent = "Nenhuma ação da timeline para desfazer.";
    }
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    if (!deleteTimelineClip(outputId)) {
      els.error.hidden = false;
      els.error.textContent = "A timeline precisa manter pelo menos um trecho.";
    } else {
      els.error.hidden = true;
      els.error.textContent = "";
    }
  }
});

els.candidates.addEventListener("change", (event) => {
  if (!event.target.closest("input[type='checkbox']")) return;
  syncCandidateSelectionState(state.job);
  updateGlobalSubtitlePreviewCandidate();
});

function handleSubtitlePreviewClick(event) {
  const subtitleColorOption = event.target.closest("[data-subtitle-color-option]");
  if (subtitleColorOption) {
    selectSubtitleColorOption(
      subtitleColorOption.dataset.subtitleColorOption,
      subtitleColorOption.dataset.subtitleTextColor,
      subtitleColorOption.dataset.subtitleBorderColor,
    );
    return;
  }

  const subtitleStyleOption = event.target.closest("[data-subtitle-style-option]");
  if (subtitleStyleOption) {
    selectSubtitleStyleOption(
      subtitleStyleOption.dataset.subtitleStyleOption,
      subtitleStyleOption.dataset.subtitleStyle,
    );
    return;
  }

  const subtitleSizeOption = event.target.closest("[data-subtitle-size-option]");
  if (subtitleSizeOption) {
    selectSubtitleSizeOption(subtitleSizeOption.dataset.subtitleSizeOption, subtitleSizeOption.dataset.subtitleSize);
    return;
  }

  const subtitlePositionOption = event.target.closest("[data-subtitle-position-option]");
  if (subtitlePositionOption) {
    selectSubtitlePositionOption(
      subtitlePositionOption.dataset.subtitlePositionOption,
      subtitlePositionOption.dataset.subtitlePosition,
    );
  }
}

candidateSubtitleSettingsElement();

els.selectAllCandidates?.addEventListener("change", () => {
  const checked = Boolean(els.selectAllCandidates?.checked);
  els.candidates.querySelectorAll("input[type='checkbox']").forEach((input) => {
    if (!input.disabled) input.checked = checked;
  });
  syncCandidateSelectionState(state.job);
  updateGlobalSubtitlePreviewCandidate();
});

document.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest(".nle-editor-shell")) return;

    if (target.closest("[data-nle-split], [data-nle-insert], [data-nle-undo], [data-nle-audio-add]")) {
      event.stopPropagation();
      event.flixoTimelineHandled = true;
      return;
    }

    const trimHandle = target.closest("[data-nle-trim-handle]");
    if (trimHandle) {
      const outputId = String(trimHandle.dataset.nleTrimHandle || "");
      const clipId = String(trimHandle.dataset.nleClipId || "");
      const kind = String(trimHandle.dataset.nleTrimKind || "");
      const output = outputById(outputId);
      const project = output ? timelineProjectForOutput(output) : null;
      const clip = project ? timelineClipById(project, clipId) : null;
      const asset = clip ? timelineAssetById(project, clip.assetId) : null;
      const track = els.outputs.querySelector(`[data-nle-track="${CSS.escape(outputId)}"]`);
      if (!output || !project || !clip || !track || !["start", "end"].includes(kind)) return;

      stopTimelineDomEvent(event);
      trimHandle.setPointerCapture?.(event.pointerId);

      const rect = track.getBoundingClientRect();
      const visualDuration = timelineVisualDuration(project);
      const assetDuration = Math.max(0.1, Number(asset?.duration || clip.sourceOut || 0));
      const initialX = event.clientX;
      const initialSourceIn = Number(clip.sourceIn || 0);
      const initialSourceOut = Number(clip.sourceOut || 0);
      let frameRequested = false;
      pushTimelineUndo(outputId);

      const updateFromPointer = (pointerEvent) => {
        pointerEvent.preventDefault();
        const delta = ((pointerEvent.clientX - initialX) / Math.max(1, rect.width)) * visualDuration;
        const nextValue =
          kind === "start"
            ? Math.max(0, Math.min(initialSourceIn + delta, initialSourceOut - 0.1))
            : Math.max(initialSourceIn + 0.1, Math.min(initialSourceOut + delta, assetDuration));
        trimTimelineClipById(outputId, clipId, kind === "start" ? "sourceIn" : "sourceOut", nextValue, {
          deferRefresh: true,
          skipUndo: true,
        });

        if (!frameRequested) {
          frameRequested = true;
          requestAnimationFrame(() => {
            frameRequested = false;
            syncTimelinePreview(outputId);
          });
        }
      };

      const stopDragging = () => {
        window.removeEventListener("pointermove", updateFromPointer);
        window.removeEventListener("pointerup", stopDragging);
        window.removeEventListener("pointercancel", stopDragging);
        refreshTimelineEditor(outputId);
      };

      window.addEventListener("pointermove", updateFromPointer, { passive: false });
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
      return;
    }

    const dragClip = target.closest("[data-nle-clip]");
    if (dragClip) {
      const outputId = String(dragClip.dataset.nleClip || "");
      const clipId = String(dragClip.dataset.nleClipId || "");
      const track = dragClip.closest("[data-nle-track]");
      if (!outputById(outputId) || !clipId || !track) return;

      event.stopPropagation();
      event.stopImmediatePropagation?.();
      event.flixoTimelineHandled = true;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      dragClip.setPointerCapture?.(event.pointerId);

      const targetIndexFromPointer = (clientX) => {
        const clipButtons = [...track.querySelectorAll("[data-nle-clip]")].filter(
          (button) => button.dataset.nleClipId !== clipId,
        );
        const index = clipButtons.findIndex((button) => {
          const rect = button.getBoundingClientRect();
          return clientX < rect.left + rect.width / 2;
        });
        return index >= 0 ? index : clipButtons.length;
      };

      const updateFromPointer = (pointerEvent) => {
        const distance = Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY);
        if (!dragging && distance < 6) return;
        if (!dragging) {
          dragging = true;
          dragClip.classList.add("is-dragging");
          state.timelineSelections.set(outputId, clipId);
        }
        pointerEvent.preventDefault();
        dragClip.style.transform = `translateX(${pointerEvent.clientX - startX}px)`;
      };

      const stopDragging = (pointerEvent) => {
        window.removeEventListener("pointermove", updateFromPointer);
        window.removeEventListener("pointerup", stopDragging);
        window.removeEventListener("pointercancel", stopDragging);
        dragClip.classList.remove("is-dragging");
        dragClip.style.transform = "";
        if (!dragging) {
          const project = timelineProjectForOutput(outputById(outputId));
          const clip = timelineClipById(project, clipId);
          if (clip) {
            state.timelineSelections.set(outputId, clip.id);
            setTimelinePlayhead(outputId, clip.timelineStart, false);
          }
          return;
        }
        state.suppressTimelineClickUntil = Date.now() + 250;
        moveTimelineClipToIndex(outputId, clipId, targetIndexFromPointer(pointerEvent.clientX));
      };

      window.addEventListener("pointermove", updateFromPointer, { passive: false });
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
      return;
    }

    const nleRuler = target.closest("[data-nle-ruler]");
    if (nleRuler) {
      const outputId = String(nleRuler.dataset.nleRuler || "");
      if (!outputById(outputId)) return;
      stopTimelineDomEvent(event);

      const updateFromPointer = (pointerEvent) => {
        setTimelinePlayheadFromClientX(outputId, nleRuler, pointerEvent.clientX);
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
      return;
    }

    const nleTrack = target.closest("[data-nle-track]");
    if (nleTrack && !target.closest("[data-nle-clip]")) {
      const outputId = String(nleTrack.dataset.nleTrack || "");
      if (!outputById(outputId)) return;
      stopTimelineDomEvent(event);

      const updateFromPointer = (pointerEvent) => {
        setTimelinePlayheadFromClientX(outputId, nleTrack, pointerEvent.clientX);
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
    }
  },
  true,
);

els.outputs.addEventListener("pointerdown", (event) => {
  if (event.flixoTimelineHandled) return;

  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest("[data-nle-split], [data-nle-insert], [data-nle-undo], [data-nle-audio-add]")) {
    event.stopPropagation();
    return;
  }

  const trimHandle = target.closest("[data-nle-trim-handle]");
  if (trimHandle) {
    const outputId = String(trimHandle.dataset.nleTrimHandle || "");
    const clipId = String(trimHandle.dataset.nleClipId || "");
    const kind = String(trimHandle.dataset.nleTrimKind || "");
    const output = outputById(outputId);
    const project = output ? timelineProjectForOutput(output) : null;
    const clip = project ? timelineClipById(project, clipId) : null;
    const asset = clip ? timelineAssetById(project, clip.assetId) : null;
    const track = els.outputs.querySelector(`[data-nle-track="${CSS.escape(outputId)}"]`);
    if (!output || !project || !clip || !track || !["start", "end"].includes(kind)) return;

    event.preventDefault();
    event.stopPropagation();
    trimHandle.setPointerCapture?.(event.pointerId);

    const rect = track.getBoundingClientRect();
    const visualDuration = timelineVisualDuration(project);
    const assetDuration = Math.max(0.1, Number(asset?.duration || clip.sourceOut || 0));
    const initialX = event.clientX;
    const initialSourceIn = Number(clip.sourceIn || 0);
    const initialSourceOut = Number(clip.sourceOut || 0);
    let frameRequested = false;
    pushTimelineUndo(outputId);

    const updateFromPointer = (pointerEvent) => {
      pointerEvent.preventDefault();
      const delta = ((pointerEvent.clientX - initialX) / Math.max(1, rect.width)) * visualDuration;
      const nextValue =
        kind === "start"
          ? Math.max(0, Math.min(initialSourceIn + delta, initialSourceOut - 0.1))
          : Math.max(initialSourceIn + 0.1, Math.min(initialSourceOut + delta, assetDuration));
      trimTimelineClipById(outputId, clipId, kind === "start" ? "sourceIn" : "sourceOut", nextValue, {
        deferRefresh: true,
        skipUndo: true,
      });

      if (!frameRequested) {
        frameRequested = true;
        requestAnimationFrame(() => {
          frameRequested = false;
          syncTimelinePreview(outputId);
        });
      }
    };

    const stopDragging = () => {
      window.removeEventListener("pointermove", updateFromPointer);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      refreshTimelineEditor(outputId);
    };

    window.addEventListener("pointermove", updateFromPointer, { passive: false });
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return;
  }

  const dragClip = target.closest("[data-nle-clip]");
  if (dragClip) {
    const outputId = String(dragClip.dataset.nleClip || "");
    const clipId = String(dragClip.dataset.nleClipId || "");
    const track = dragClip.closest("[data-nle-track]");
    if (!outputById(outputId) || !clipId || !track) return;

    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    dragClip.setPointerCapture?.(event.pointerId);

    const targetIndexFromPointer = (clientX) => {
      const clipButtons = [...track.querySelectorAll("[data-nle-clip]")]
        .filter((button) => button.dataset.nleClipId !== clipId);
      const index = clipButtons.findIndex((button) => {
        const rect = button.getBoundingClientRect();
        return clientX < rect.left + rect.width / 2;
      });
      return index >= 0 ? index : clipButtons.length;
    };

    const updateFromPointer = (pointerEvent) => {
      const distance = Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY);
      if (!dragging && distance < 6) return;
      if (!dragging) {
        dragging = true;
        dragClip.classList.add("is-dragging");
        state.timelineSelections.set(outputId, clipId);
      }
      pointerEvent.preventDefault();
      dragClip.style.transform = `translateX(${pointerEvent.clientX - startX}px)`;
    };

    const stopDragging = (pointerEvent) => {
      window.removeEventListener("pointermove", updateFromPointer);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      dragClip.classList.remove("is-dragging");
      dragClip.style.transform = "";
      if (!dragging) {
        const project = timelineProjectForOutput(outputById(outputId));
        const clip = timelineClipById(project, clipId);
        if (clip) {
          state.timelineSelections.set(outputId, clip.id);
          setTimelinePlayhead(outputId, clip.timelineStart, false);
        }
        return;
      }
      state.suppressTimelineClickUntil = Date.now() + 250;
      moveTimelineClipToIndex(outputId, clipId, targetIndexFromPointer(pointerEvent.clientX));
    };

    window.addEventListener("pointermove", updateFromPointer, { passive: false });
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return;
  }

  const nleRuler = target.closest("[data-nle-ruler]");
  if (nleRuler) {
    const outputId = String(nleRuler.dataset.nleRuler || "");
    if (!outputById(outputId)) return;
    event.preventDefault();

    const updateFromPointer = (pointerEvent) => {
      setTimelinePlayheadFromClientX(outputId, nleRuler, pointerEvent.clientX);
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
    return;
  }

  const nleTrack = target.closest("[data-nle-track]");
  if (nleTrack && !target.closest("[data-nle-clip]")) {
    const outputId = String(nleTrack.dataset.nleTrack || "");
    if (!outputById(outputId)) return;
    event.preventDefault();

    const updateFromPointer = (pointerEvent) => {
      setTimelinePlayheadFromClientX(outputId, nleTrack, pointerEvent.clientX);
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
    return;
  }

  const rangeRuler = target.closest("[data-range-ruler]");
  if (rangeRuler) {
    const outputId = String(rangeRuler.dataset.rangeRuler || "");
    if (!outputId) return;
    event.preventDefault();

    const updateFromPointer = (pointerEvent) => {
      seekPreviewFromRangeElement(outputId, rangeRuler, pointerEvent.clientX);
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
    return;
  }

  const handle = target.closest("[data-range-handle]");
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
    const preview = els.outputs.querySelector(`[data-edit-preview="${CSS.escape(outputId)}"]`);
    const currentTime = Math.max(0, Number(preview?.currentTime || 0));
    if (kind === "start") {
      const nextStart = Math.min(nextTime, end - 0.001);
      setTrimValues(outputId, nextStart, end);
      if (currentTime < nextStart) {
        seekPreview(outputId, nextStart);
      }
    } else {
      const nextEnd = Math.max(nextTime, start + 0.001);
      setTrimValues(outputId, start, nextEnd);
      if (currentTime > nextEnd) {
        seekPreview(outputId, nextEnd);
      }
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
  const target = event.target.closest("[data-range-track], [data-range-ruler]");
  if (!target || event.target.closest("[data-range-handle]")) return;
  const outputId = String(target.dataset.rangeTrack || target.dataset.rangeRuler || "");
  if (!outputId) return;
  seekPreviewFromRangeElement(outputId, target, event.clientX);
});

els.outputs.addEventListener("timeupdate", (event) => {
  const preview = event.target.closest("[data-edit-preview]");
  if (!preview) return;
  const outputId = preview.dataset.editPreview || "";
  if (els.outputs.querySelector(`[data-nle-editor="${CSS.escape(outputId)}"]`)) {
    syncTimelineFromPreview(outputId);
    return;
  }
  syncPreviewPlayhead(outputId);
});

els.outputs.addEventListener("loadedmetadata", (event) => {
  const preview = event.target.closest("[data-edit-preview]");
  if (!preview) return;
  const outputId = preview.dataset.editPreview || "";
  if (els.outputs.querySelector(`[data-nle-editor="${CSS.escape(outputId)}"]`)) {
    syncTimelinePreview(outputId);
    return;
  }
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
    cancelPendingUiRenders();
    state.timelineProjects.clear();
    state.timelineSelections.clear();
    state.timelineUndoStacks.clear();
    state.activeTimelineOutputId = null;
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
  hideCandidateSubtitleSettings();
  setProgress(state.job);
  try {
    let payload;
    try {
      payload = await requestRenderSelectedCandidates(selectedIds);
    } catch (error) {
      if (error?.status !== 409 || !error?.data?.requires_ready_replacement_confirmation) {
        throw error;
      }
      const previousTitle = error.data.previous_title || "projeto anterior";
      const confirmed = await confirmAction({
        title: "Substituir projeto pronto?",
        message: `Ao avançar, este projeto substituirá "${previousTitle}". Os clipes, legendas e capas do projeto anterior serão removidos. Deseja continuar?`,
        confirmLabel: "Continuar e substituir",
        cancelLabel: "Cancelar",
      });
      if (!confirmed) {
        state.renderSelectionLocked = false;
        setCandidateSelectionDisabled(false);
        renderCandidates(state.job);
        syncCandidateSelectionState(state.job);
        return;
      }
      payload = await requestRenderSelectedCandidates(selectedIds, true);
    }
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
    renderCandidates(state.job);
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

els.downloadSubtitlesButton?.addEventListener("click", () => {
  downloadAllSubtitles();
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
  const deleteButton = event.target.closest("[data-history-delete]");
  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    deleteHistoryJob(deleteButton.dataset.historyDelete, deleteButton);
    return;
  }
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
