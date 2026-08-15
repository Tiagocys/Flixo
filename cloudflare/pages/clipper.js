const state = {
  jobId: null,
  job: null,
  timer: null,
  youtubeAuthorized: false,
  youtubeConfigured: false,
};

const CLIPPER_LAST_JOB_KEY = "flixo.clipper.lastJobId";

const els = {
  form: document.getElementById("clipper-form"),
  url: document.getElementById("clipper-url"),
  file: document.getElementById("clipper-file"),
  submit: document.getElementById("clipper-submit-button"),
  statusMeta: document.getElementById("clipper-status-meta"),
  statusPill: document.getElementById("clipper-status-pill"),
  progressBar: document.getElementById("clipper-progress-bar"),
  error: document.getElementById("clipper-error"),
  candidatesMeta: document.getElementById("clipper-candidates-meta"),
  candidates: document.getElementById("clipper-candidates"),
  renderButton: document.getElementById("clipper-render-button"),
  outputsMeta: document.getElementById("clipper-outputs-meta"),
  outputs: document.getElementById("clipper-outputs"),
  youtubeStatusMeta: document.getElementById("youtube-status-meta"),
  youtubeConnectButton: document.getElementById("youtube-connect-button"),
  youtubeUploadAllButton: document.getElementById("youtube-upload-all-button"),
  youtubePrivacy: document.getElementById("youtube-privacy"),
  youtubeVideoLanguage: document.getElementById("youtube-video-language"),
  youtubeAudioLanguage: document.getElementById("youtube-audio-language"),
  youtubeCaptionLanguage: document.getElementById("youtube-caption-language"),
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

function setProgress(job) {
  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));
  els.progressBar.style.width = `${progress}%`;
  els.statusPill.textContent = statusLabel(job?.status || "queued");
  els.statusMeta.textContent = stepLabel(job?.current_step || "queued", progress);
  if (job?.error) {
    els.error.hidden = false;
    els.error.textContent = job.error;
  } else {
    els.error.hidden = true;
    els.error.textContent = "";
  }
}

function statusLabel(status) {
  return {
    queued: "Na fila",
    running: "Analisando",
    ready: "Pronto para seleção",
    rendering: "Renderizando",
    done: "Concluído",
    failed: "Erro",
  }[status] || status;
}

function stepLabel(step, progress) {
  return {
    queued: "Preparando job.",
    ingesting: "Baixando ou preparando o vídeo original.",
    transcribing: "Extraindo áudio e transcrevendo com timestamps. Em vídeos longos, esta é a etapa mais demorada.",
    analyzing: "Analisando a transcrição e ranqueando possíveis cortes.",
    ready: "Escolha os cortes que deseja renderizar.",
    rendering: "Cortando, convertendo para 9:16 e aplicando legendas.",
    done: "Shorts prontos.",
    failed: "A execução falhou.",
  }[step] || `Progresso: ${progress}%`;
}

function renderCandidates(job) {
  const candidates = Array.isArray(job?.candidates) ? job.candidates : [];
  if (!candidates.length) {
    els.candidatesMeta.textContent = "Aguardando transcrição e análise.";
    els.candidates.innerHTML = '<div class="empty-state">Os candidatos aparecerão aqui.</div>';
    els.renderButton.disabled = true;
    return;
  }

  els.candidatesMeta.textContent = `${candidates.length} cortes sugeridos. Selecione os melhores antes de renderizar.`;
  els.candidates.innerHTML = candidates
    .map((candidate, index) => {
      const checked = index < Math.min(3, candidates.length) ? "checked" : "";
      const score = candidate?.scores?.overall ?? 0;
      return `
        <label class="clipper-candidate-card">
          <input type="checkbox" value="${escapeHtml(candidate.id)}" ${checked} />
          <div class="clipper-candidate-body">
            <div class="clipper-candidate-head">
              <strong>${escapeHtml(candidate.title || `Corte ${index + 1}`)}</strong>
              <span class="score-pill">${escapeHtml(score)}%</span>
            </div>
            <div class="clipper-time">${formatTime(candidate.start)} → ${formatTime(candidate.end)} · ${Math.round(candidate.duration || 0)}s</div>
            <p><b>Hook:</b> ${escapeHtml(candidate.hook || "Sem hook identificado.")}</p>
            <p>${escapeHtml(candidate.reason || candidate.summary || "")}</p>
          </div>
        </label>
      `;
    })
    .join("");
  els.renderButton.disabled = job.status !== "ready" && job.status !== "done";
}

function renderOutputs(job) {
  const outputs = Array.isArray(job?.outputs) ? job.outputs : [];
  if (!outputs.length) {
    els.outputsMeta.textContent = "Selecione cortes para gerar os MP4s finais.";
    els.outputs.innerHTML = '<div class="empty-state">Nenhum short renderizado ainda.</div>';
    els.youtubeUploadAllButton.disabled = true;
    return;
  }
  els.outputsMeta.textContent = `${outputs.length} short(s) renderizados.`;
  els.youtubeUploadAllButton.disabled = !state.youtubeAuthorized;
  const candidatesById = new Map((job?.candidates || []).map((candidate) => [candidate.id, candidate]));
  els.outputs.innerHTML = outputs
    .map(
      (output, index) => {
        const candidate = candidatesById.get(output.id) || {};
        const title = output.title || candidate.title || `Short ${index + 1}`;
        const description = outputDescription(output, candidate, title);
        const tags = outputTags(title, description);
        return `
          <article class="clipper-output-card">
            <video src="${escapeHtml(output.video_url)}" controls playsinline preload="metadata"></video>
            <div class="clipper-output-copy">
              <div class="output-heading">
                <span>Short ${index + 1}</span>
                <strong>${escapeHtml(title)}</strong>
              </div>
              <dl class="output-metadata">
                <div>
                  <dt><label for="youtube-title-${escapeHtml(output.id)}">Título do vídeo</label></dt>
                  <dd>
                    <input
                      id="youtube-title-${escapeHtml(output.id)}"
                      class="output-edit-input"
                      data-youtube-title="${escapeHtml(output.id)}"
                      maxlength="100"
                      value="${escapeHtml(title)}"
                    />
                  </dd>
                </div>
                <div>
                  <dt><label for="youtube-description-${escapeHtml(output.id)}">Descrição</label></dt>
                  <dd>
                    <textarea
                      id="youtube-description-${escapeHtml(output.id)}"
                      class="output-edit-textarea"
                      data-youtube-description="${escapeHtml(output.id)}"
                      rows="4"
                    >${escapeHtml(description)}</textarea>
                  </dd>
                </div>
                <div>
                  <dt><label for="youtube-tags-${escapeHtml(output.id)}">Hashtags</label></dt>
                  <dd>
                    <input
                      id="youtube-tags-${escapeHtml(output.id)}"
                      class="output-edit-input"
                      data-youtube-tags="${escapeHtml(output.id)}"
                      value="${escapeHtml(tags.join(" "))}"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Detalhes</dt>
                  <dd>${formatTime(output.start)} → ${formatTime(output.end)} · ${Math.round(output.duration || 0)}s · score ${escapeHtml(output.score || 0)}%</dd>
                </div>
              </dl>
              <div class="output-actions">
            <a class="secondary-button" href="${escapeHtml(output.video_url)}" target="_blank" rel="noreferrer">Abrir MP4</a>
            <button
              type="button"
              class="secondary-button youtube-upload-button"
              data-output-id="${escapeHtml(output.id)}"
              ${state.youtubeAuthorized ? "" : "disabled"}
            >
              Enviar ao YouTube
            </button>
              </div>
          </div>
        </article>
        `;
      }
    )
    .join("");
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
  const tags = ["#Shorts"];
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
  if (text.includes("spirit of ecstasy")) add("#SpiritOfEcstasy");
  if (text.includes("honda nsx") || /\bnsx\b/.test(text)) add("#HondaNSX", "#JDM", "#CarrosJaponeses");
  if (text.includes("nissan") || text.includes("gtr") || text.includes("skyline")) add("#NissanGTR", "#JDM");
  if (text.includes("need for speed")) add("#NeedForSpeed", "#CarrosCustomizados");
  if (text.includes("drift")) add("#Drift", "#CarrosPreparados");
  if (text.includes("rally")) add("#Rally", "#CarrosPreparados");
  if (text.includes("biturbo") || text.includes("bi turbo")) add("#Biturbo", "#CarrosPreparados");
  if (text.includes("turbo")) add("#Turbo", "#CarrosPreparados");
  if (text.includes("600 cavalos") || text.includes("cavalos de potencia")) add("#CarrosPreparados");
  if (text.includes("radiador")) add("#Radiador", "#MecanicaAutomotiva");
  if (text.includes("oleo")) add("#OleoDoMotor", "#MecanicaAutomotiva");
  if (text.includes("eletrico")) add("#CarroEletrico");
  if (text.includes("roda")) add("#Rodas");
  if (text.includes("escapamento")) add("#Escapamento");
  if (text.includes("pane")) add("#PaneNoCarro");
  if (text.includes("oficina") || text.includes("mecanica")) add("#Oficina", "#MecanicaAutomotiva");
  if (text.includes("painel") || text.includes("digital")) add("#TecnologiaAutomotiva");
  if (text.includes("teto estrelado") || text.includes("ceu estrelado")) add("#CarrosDeLuxo");
  if (text.includes("motiv") || text.includes("crescer") || text.includes("sonho")) add("#Motivacao");
  if (text.includes("dica") || text.includes("aprend")) add("#Dicas");

  if (hasAutomotiveContext(text)) add("#Carros", "#Automotivo");
  if (tags.length < 6) add(...keywordTags(text));
  return tags.slice(0, 12);
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
    ["pandemia", "#Historia"],
    ["peste negra", "#PesteNegra"],
    ["medieval", "#IdadeMedia"],
    ["armadura", "#Armaduras"],
    ["gato", "#Gatos"],
    ["cachorro", "#Cachorros"],
    ["curiosidade", "#Curiosidades"],
    ["podcast", "#Podcast"],
    ["youtube", "#YouTube"],
  ];
  return known.filter(([term]) => text.includes(term)).map(([, tag]) => tag);
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
  return {
    privacy_status: els.youtubePrivacy?.value || "private",
    video_language: els.youtubeVideoLanguage?.value || "pt-BR",
    audio_language: els.youtubeAudioLanguage?.value || "pt-BR",
    caption_language: els.youtubeCaptionLanguage?.value || "pt-BR",
  };
}

function setYoutubeStatus(configured, authorized, channels = [], channelError = "") {
  state.youtubeConfigured = Boolean(configured);
  state.youtubeAuthorized = Boolean(authorized);
  if (!configured) {
    els.youtubeStatusMeta.textContent = "Configure YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET no backend.";
    els.youtubeConnectButton.disabled = true;
    els.youtubeUploadAllButton.disabled = true;
    els.youtubeConnectButton.textContent = "YouTube não configurado";
    return;
  }
  els.youtubeConnectButton.disabled = false;
  els.youtubeUploadAllButton.disabled = !authorized || !(state.job?.outputs || []).length;
  if (authorized && channels.length) {
    const channelNames = channels.map((channel) => channel.title).filter(Boolean).join(", ");
    els.youtubeStatusMeta.textContent = `YouTube conectado: ${channelNames}. Configure visibilidade e idioma antes de enviar.`;
  } else if (authorized && channelError) {
    els.youtubeStatusMeta.textContent =
      "YouTube conectado, mas é preciso reconectar para permitir leitura do canal autorizado.";
  } else {
    els.youtubeStatusMeta.textContent = authorized
      ? "YouTube conectado. Configure visibilidade e idioma antes de enviar."
      : "Conecte o canal para habilitar upload dos shorts.";
  }
  els.youtubeConnectButton.textContent = authorized ? "Reconectar YouTube" : "Conectar YouTube";
}

async function refreshYoutubeStatus() {
  const payload = await fetch("/api/youtube/oauth/status").then(readJson);
  const data = payload?.data || {};
  setYoutubeStatus(data.configured, data.authorized, data.channels || [], data.channel_error || "");
  renderOutputs(state.job);
}

async function connectYoutube() {
  const frontendUrl = `${window.location.origin}${window.location.pathname}`;
  const payload = await fetch(`/api/youtube/oauth/start?frontend_url=${encodeURIComponent(frontendUrl)}`).then(readJson);
  const authorizationUrl = payload?.data?.authorization_url;
  if (!authorizationUrl) throw new Error("Backend não retornou URL de autorização.");
  window.location.href = authorizationUrl;
}

async function uploadOutputToYoutube(outputId, button) {
  if (!state.jobId || !outputId) return;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Enviando...";
  try {
    const payload = await fetch("/api/youtube/upload", {
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
    button.textContent = "Enviado";
    if (upload?.url) {
      button.insertAdjacentHTML(
        "afterend",
        ` <a class="secondary-button" href="${escapeHtml(upload.url)}" target="_blank" rel="noreferrer">Abrir YouTube</a>`
      );
    }
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function uploadAllOutputsToYoutube() {
  if (!state.jobId || !state.job?.outputs?.length) return;
  els.youtubeUploadAllButton.disabled = true;
  const originalText = els.youtubeUploadAllButton.textContent;
  els.youtubeUploadAllButton.textContent = "Enviando...";
  try {
    const payload = await fetch("/api/youtube/upload-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: state.jobId,
        cleanup_after_upload: true,
        overrides: outputYoutubeOverrides(),
        ...youtubeSettingsPayload(),
      }),
    }).then(readJson);
    const uploads = payload?.data?.uploads || [];
    state.jobId = null;
    state.job = null;
    localStorage.removeItem(CLIPPER_LAST_JOB_KEY);
    els.outputsMeta.textContent = `${uploads.length} short(s) enviados ao YouTube. Projeto local limpo.`;
    els.outputs.innerHTML = uploads
      .map(
        (upload, index) => `
          <article class="clipper-output-card youtube-clean-result">
            <div class="clipper-output-copy">
              <div class="output-heading">
                <span>Publicado ${index + 1}</span>
                <strong>${escapeHtml(upload.title || `Short ${index + 1}`)}</strong>
              </div>
              <a class="secondary-button" href="${escapeHtml(upload.url)}" target="_blank" rel="noreferrer">Abrir YouTube</a>
            </div>
          </article>
        `
      )
      .join("");
    renderCandidates(null);
    setProgress({ status: "done", current_step: "done", progress: 100 });
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    els.youtubeUploadAllButton.disabled = !state.youtubeAuthorized;
  } finally {
    els.youtubeUploadAllButton.textContent = originalText;
  }
}

function refreshDelay(job) {
  if (job?.current_step === "transcribing") return 20000;
  if (job?.current_step === "analyzing") return 10000;
  if (job?.current_step === "rendering") return 7000;
  return 5000;
}

function formatTime(value) {
  const seconds = Math.max(0, Number(value || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

async function refreshJob() {
  if (!state.jobId) return;
  const payload = await fetch(`/api/clipper/jobs/${encodeURIComponent(state.jobId)}`).then(readJson);
  const job = normalizeJob(payload);
  state.job = job;
  setProgress(job);
  renderCandidates(job);
  renderOutputs(job);
  if (["ready", "done", "failed"].includes(job?.status)) {
    clearTimeout(state.timer);
    state.timer = null;
  } else {
    scheduleRefresh(job);
  }
}

async function restoreLastJob() {
  const queryJobId = new URLSearchParams(window.location.search).get("job");
  const jobId = queryJobId || localStorage.getItem(CLIPPER_LAST_JOB_KEY) || (await latestJobId());
  if (!jobId) return;
  state.jobId = jobId;
  try {
    const payload = await fetch(`/api/clipper/jobs/${encodeURIComponent(jobId)}`).then(readJson);
    const job = normalizeJob(payload);
    localStorage.setItem(CLIPPER_LAST_JOB_KEY, job.id);
    state.job = job;
    setProgress(job);
    renderCandidates(job);
    renderOutputs(job);
    if (!["ready", "done", "failed"].includes(job?.status)) {
      scheduleRefresh(job);
    }
  } catch (_error) {
    localStorage.removeItem(CLIPPER_LAST_JOB_KEY);
    state.jobId = null;
    state.job = null;
    renderCandidates(null);
    renderOutputs(null);
  }
}

async function latestJobId() {
  const payload = await fetch("/api/clipper/jobs?limit=1").then(readJson).catch(() => null);
  const jobs = payload?.data?.jobs || payload?.jobs || [];
  return jobs?.[0]?.id || "";
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
    const payload = await fetch("/api/clipper/jobs", {
      method: "POST",
      body: formData,
    }).then(readJson);
    const job = normalizeJob(payload);
    state.jobId = job.id;
    state.job = job;
    localStorage.setItem(CLIPPER_LAST_JOB_KEY, job.id);
    setProgress(job);
    renderCandidates(job);
    renderOutputs(job);
    scheduleRefresh();
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = "Analisar vídeo";
  }
});

els.renderButton.addEventListener("click", async () => {
  if (!state.jobId) return;
  const selectedIds = [...els.candidates.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value)
    .filter(Boolean);
  if (!selectedIds.length) {
    els.error.hidden = false;
    els.error.textContent = "Selecione pelo menos um corte.";
    return;
  }

  els.renderButton.disabled = true;
  els.renderButton.textContent = "Renderizando...";
  try {
    const payload = await fetch(`/api/clipper/jobs/${encodeURIComponent(state.jobId)}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_ids: selectedIds, burn_subtitles: true }),
    }).then(readJson);
    state.job = normalizeJob(payload);
    setProgress(state.job);
    scheduleRefresh();
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    els.renderButton.textContent = "Gerar shorts selecionados";
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

els.outputs.addEventListener("click", (event) => {
  const button = event.target.closest(".youtube-upload-button");
  if (!button) return;
  uploadOutputToYoutube(button.dataset.outputId, button);
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
