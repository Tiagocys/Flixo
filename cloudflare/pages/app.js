const PIPELINE_FALLBACK = [
  {
    key: "queued",
    label: "Fila recebida",
    description: "Recebemos sua solicitação e preparamos a criação.",
  },
  {
    key: "writing_script",
    label: "Roteiro",
    description: "A IA transforma o tema em roteiro curto e objetivo.",
  },
  {
    key: "generating_voice",
    label: "Narração",
    description: "O texto vira uma narração pronta para sincronizar.",
  },
  {
    key: "collecting_assets",
    label: "Mídia",
    description: "Imagens e vídeos são buscados em bancos externos.",
  },
  {
    key: "syncing_captions",
    label: "Legendas",
    description: "A fala é alinhada com as legendas.",
  },
  {
    key: "rendering_video",
    label: "Finalização",
    description: "O vídeo final é montado com áudio e texto.",
  },
  {
    key: "done",
    label: "Vídeo pronto",
    description: "O resultado final fica salvo e disponível para download.",
  },
];

const state = {
  config: null,
  jobs: [],
  mediaResults: [],
  fullVideoSuggestions: [],
  fullVideoSelectedIds: new Set(),
  timelineAssets: [],
  audioResults: [],
  timelineAudioAssets: [],
  activeJobId: null,
  activeTab: "ai",
  playback: {
    clipIndex: 0,
    playing: false,
  },
  refreshTimer: null,
};

const DEFAULT_CLIP_SETTINGS = {
  provider: "byteplus",
  model: "seedance-1-5-pro-251215",
  duration: 4,
  resolution: "480p",
  ratio: "9:16",
  cameraFixed: false,
};

const DEFAULT_FULL_VIDEO_SETTINGS = {
  provider: "moneyprinterturbo",
  tts: "elevenlabs",
  voiceProfile: "bella-narrative",
  language: "pt-BR",
  source: "pexels",
  aspect: "portrait",
  music: false,
  bgm_type: "",
  bgm_volume: 0,
};

const MAX_SEEDANCE_IMAGE_BYTES = 8 * 1024 * 1024;
const TIMELINE_LIMIT_SECONDS = 60;

const els = {};

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
  if (!value) return "agora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status) {
  const map = {
    queued: "Na fila",
    running: "Criando",
    done: "Concluído",
    failed: "Falhou",
    waiting: "Aguardando",
  };
  return map[status] || status || "desconhecido";
}

function statusClass(status) {
  if (status === "done") return "status-success";
  if (status === "failed") return "status-failed";
  if (status === "running") return "status-running";
  return "status-queued";
}

function stepLabel(stepKey) {
  const steps = pickPipeline(state.config);
  return steps.find((step) => step.key === stepKey)?.label || "Preparando";
}

function pickPipeline(config) {
  return Array.isArray(config?.pipelineSteps) && config.pipelineSteps.length
    ? config.pipelineSteps
    : PIPELINE_FALLBACK;
}

function renderPipeline(job) {
  const pipeline = pickPipeline(state.config);
  els.pipeline.innerHTML = "";
  const currentIndex = pipeline.findIndex(
    (step) => step.key === (job?.current_step || "queued")
  );
  pipeline.forEach((step, index) => {
    const node = document.importNode(
      document.getElementById("pipeline-step-template").content,
      true
    );
    const wrapper = node.querySelector(".step");
    const title = node.querySelector("strong");
    const description = node.querySelector("span");
    title.textContent = step.label;
    description.textContent = step.description;
    if (index < currentIndex) wrapper.classList.add("is-done");
    if (index === currentIndex) wrapper.classList.add("is-active");
    els.pipeline.appendChild(node);
  });
}

function renderInfra(config) {
  const entries = [
    ["Conta", config?.storage?.auth ? "Pronta" : "Pendente"],
    ["Histórico", config?.storage?.supabase ? "Ativo" : "Temporário"],
    ["Arquivos", config?.storage?.r2 ? "Ativos" : "Pendente"],
    ["Criação", config?.storage?.backend ? "Ativa" : "Limitada"],
    ["Biblioteca", config?.storage?.pexels ? "Ativa" : "Pendente"],
    ["Ambiente", config?.mode === "local" ? "Local" : "Online"],
  ];
  els.infraGrid.innerHTML = entries
    .map(
      ([label, value]) => `
        <div class="summary-item">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(value)}</span>
        </div>`
    )
    .join("");

  const connectedCount = entries.filter(([, value]) => value === "Pronta" || value === "Ativo" || value === "Ativa").length;
  const total = entries.length;
  els.infraPill.textContent = `${connectedCount}/${total} prontos`;
}

function renderJobDetail(job) {
  if (!job) {
    els.jobMeta.textContent = "Nenhuma criação iniciada ainda.";
    els.jobDetail.className = "job-detail empty";
    els.jobDetail.textContent =
      "Digite um prompt e envie para criar seu primeiro vídeo.";
    return;
  }

  els.jobMeta.textContent = `Atualizado em ${formatDateTime(job.updatedAt || job.updated_at)}`;
  els.jobDetail.className = "job-detail";
  const assetCount = job.assetManifest ? Object.keys(job.assetManifest).length : 0;
  const timelineCount = Array.isArray(job.timeline) ? job.timeline.length : 0;

  const videoUrl = job.videoUrl || job.video_url || "";
  const scriptPreview = job.script || job.prompt;

  els.jobDetail.innerHTML = `
    <div class="job-card">
      <div class="job-card-head">
        <div class="job-card-title">${escapeHtml(job.prompt)}</div>
        <div class="${statusClass(job.status)}">${escapeHtml(statusLabel(job.status))}</div>
      </div>
      <div>${escapeHtml(scriptPreview)}</div>
      <div class="meta-row">
        <span class="meta-pill">Etapa: ${escapeHtml(stepLabel(job.current_step || "queued"))}</span>
        <span class="meta-pill">Progresso: ${escapeHtml(job.progress ?? 0)}%</span>
        <span class="meta-pill">${timelineCount} item(ns) na timeline</span>
        <span class="meta-pill">${assetCount} mídia(s)</span>
        ${videoUrl ? `<span class="meta-pill"><a href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer">Assistir vídeo</a></span>` : ""}
      </div>
      ${job.error ? `<p class="status-failed" style="margin:12px 0 0;">${escapeHtml(job.error)}</p>` : ""}
    </div>
  `;
  renderPipeline(job);
}

function renderHistory(jobs) {
  if (!jobs.length) {
    els.history.innerHTML = '<div class="empty-state">Sem criações recentes.</div>';
    return;
  }

  els.history.innerHTML = jobs
    .map(
      (job) => `
      <article class="history-card">
        <div class="history-card-head">
          <strong>${escapeHtml(job.prompt)}</strong>
          <span class="${statusClass(job.status)}">${escapeHtml(statusLabel(job.status))}</span>
        </div>
        <div>${escapeHtml(stepLabel(job.current_step || "queued"))} · ${escapeHtml(job.progress ?? 0)}%</div>
        ${job.error ? `<p class="history-error">${escapeHtml(job.error)}</p>` : ""}
        <small>${escapeHtml(formatDateTime(job.createdAt || job.created_at))}</small>
      </article>`
    )
    .join("");
}

function clipDuration(job) {
  const duration = Number(job.settings?.duration || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 4;
}

function timelineAssetFromJob(job) {
  return {
    id: `job-${job.id}`,
    title: job.prompt,
    duration: clipDuration(job),
    videoUrl: job.videoUrl,
    source: "IA",
  };
}

function timelineVideoClips(jobs) {
  const aiClips = jobs
    .filter((job) => job.status === "done" && job.videoUrl && job.settings?.provider === "byteplus")
    .slice()
    .reverse()
    .map(timelineAssetFromJob);
  const clips = [...state.timelineAssets, ...aiClips];
  let usedSeconds = 0;
  const visibleClips = [];
  for (const clip of clips) {
    const duration = Math.max(1, Math.round(Number(clip.duration || 4)));
    if (usedSeconds + duration > TIMELINE_LIMIT_SECONDS) break;
    visibleClips.push({ ...clip, duration });
    usedSeconds += duration;
  }
  return visibleClips;
}

function timelineAudioClips() {
  let usedSeconds = 0;
  const visibleClips = [];
  for (const clip of state.timelineAudioAssets) {
    const duration = Math.max(1, Math.round(Number(clip.duration || 4)));
    if (usedSeconds + duration > TIMELINE_LIMIT_SECONDS) break;
    visibleClips.push({ ...clip, duration });
    usedSeconds += duration;
  }
  return visibleClips;
}

function sumDuration(clips) {
  return clips.reduce((total, clip) => total + Math.max(1, Math.round(Number(clip.duration || 4))), 0);
}

function renderTimeline(jobs) {
  const visibleClips = timelineVideoClips(jobs);
  const audioClips = timelineAudioClips();
  const usedSeconds = sumDuration(visibleClips);
  const audioSeconds = sumDuration(audioClips);

  els.timelineMeta.textContent = `${usedSeconds}/${TIMELINE_LIMIT_SECONDS}s vídeo · ${audioSeconds}/${TIMELINE_LIMIT_SECONDS}s áudio`;

  els.timelineBoard.innerHTML = `
    <div class="clip-track">
      ${
        visibleClips.length
          ? visibleClips
              .map(
                (clip, index) => `
                  <a class="timeline-clip" href="${escapeHtml(clip.videoUrl)}" target="_blank" rel="noreferrer" style="--span:${clip.duration}">
                    <strong>${index + 1}</strong>
                    <span>${escapeHtml(clip.title || clip.prompt)}</span>
                    <small>${clip.duration}s · ${escapeHtml(clip.source || "clipe")}</small>
                  </a>`
              )
              .join("")
          : '<div class="timeline-placeholder">Arraste ou adicione vídeos para começar.</div>'
      }
    </div>
    <div class="audio-track">
      <span>Narração</span>
      <div class="audio-lane ${audioClips.length ? "" : "empty-lane"}">
        ${
          audioClips.length
            ? audioClips
                .map(
                  (clip) => `
                    <a class="audio-timeline-clip" href="${escapeHtml(clip.audioUrl)}" target="_blank" rel="noreferrer" style="--span:${clip.duration}">
                      <strong>${escapeHtml(clip.title)}</strong>
                      <small>${clip.duration}s</small>
                    </a>`
                )
                .join("")
            : "Adicione uma narração para começar."
        }
      </div>
    </div>
  `;
  syncTimelinePlayer();
}

function renderMediaResults() {
  if (!state.mediaResults.length) {
    els.mediaResultsMeta.textContent = "Busque no Pexels para criar uma biblioteca da timeline.";
    els.mediaResults.innerHTML = '<div class="empty-state">Nenhum clipe buscado ainda.</div>';
    return;
  }

  els.mediaResultsMeta.textContent = `${state.mediaResults.length} clipe(s) encontrado(s).`;
  els.mediaResults.innerHTML = state.mediaResults
    .map(
      (asset, index) => `
        <article class="media-card">
          <video
            src="${escapeHtml(asset.videoUrl)}"
            poster="${escapeHtml(asset.thumbnailUrl || "")}"
            muted
            playsinline
            preload="metadata"
            controls
          ></video>
          <div class="media-card-copy">
            <strong>${escapeHtml(asset.title)}</strong>
            <span>${escapeHtml(asset.duration)}s · ${escapeHtml(asset.width)}x${escapeHtml(asset.height)}</span>
            <span>Pronto para usar</span>
            <button type="button" class="secondary-button" data-add-media="${index}">Adicionar à timeline</button>
          </div>
        </article>`
    )
    .join("");

  document.querySelectorAll("[data-add-media]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-add-media"));
      const asset = state.mediaResults[index];
      if (!asset) return;
      addMediaToTimeline(asset);
    });
  });
}

function selectedFullMedia() {
  return state.fullVideoSuggestions.filter((asset) =>
    state.fullVideoSelectedIds.has(asset.id)
  );
}

function derivedFullVideoPlan(selectedCount = selectedFullMedia().length) {
  const clipDuration = selectedCount >= 10 ? 3 : selectedCount >= 7 ? 4 : 5;
  const maxNarrationSeconds = Math.max(
    10,
    Math.min(60, selectedCount * clipDuration - 1)
  );
  return { clipDuration, maxNarrationSeconds };
}

function renderFullVideoSuggestions() {
  const selected = selectedFullMedia();
  const { clipDuration, maxNarrationSeconds } = derivedFullVideoPlan(selected.length);
  els.fullSelectionSummary.textContent = selected.length
    ? `${selected.length} mídia(s) selecionada(s). Roteiro sugerido: até ${maxNarrationSeconds}s, com cortes de até ${clipDuration}s.`
    : "Selecione os clipes/imagens que entrarão no vídeo antes de renderizar.";

  if (!state.fullVideoSuggestions.length) {
    els.fullSuggestions.innerHTML =
      '<div class="empty-state">Nenhuma sugestão ainda. Escreva o tema e clique em “Sugerir mídia”.</div>';
    return;
  }

  els.fullSuggestions.innerHTML = state.fullVideoSuggestions
    .map((asset) => {
      const checked = state.fullVideoSelectedIds.has(asset.id) ? "checked" : "";
      const mediaUrl = asset.videoUrl || asset.imageUrl || asset.url || "";
      const preview =
        asset.type === "image"
          ? `<img src="${escapeHtml(asset.thumbnailUrl || mediaUrl)}" alt="" loading="lazy" />`
          : `<video src="${escapeHtml(mediaUrl)}" poster="${escapeHtml(asset.thumbnailUrl || "")}" muted playsinline preload="metadata" controls></video>`;
      return `
        <label class="selectable-media-card">
          <input type="checkbox" data-select-full-media="${escapeHtml(asset.id)}" ${checked} />
          <div class="selectable-media-preview">${preview}</div>
          <div class="media-card-copy">
            <strong>${escapeHtml(asset.title || "Mídia sugerida")}</strong>
            <span>${escapeHtml(asset.provider || "asset")} · ${escapeHtml(asset.type || "video")}</span>
            <span>${asset.duration ? `${escapeHtml(asset.duration)}s` : "imagem com movimento"}</span>
          </div>
        </label>`;
    })
    .join("");

  document.querySelectorAll("[data-select-full-media]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.getAttribute("data-select-full-media");
      if (!id) return;
      if (input.checked) state.fullVideoSelectedIds.add(id);
      else state.fullVideoSelectedIds.delete(id);
      renderFullVideoSuggestions();
    });
  });
}

async function suggestFullVideoMedia() {
  const query = els.fullVideoPrompt.value.trim();
  if (!query) {
    showInlineError("Tema obrigatório", "Digite o tema antes de sugerir mídia.");
    return;
  }

  const mediaType = els.fullMediaMode.value === "images" ? "image" : "video";
  const style = els.fullMediaStyle.value === "animation" ? "animation" : "realistic";
  els.fullSuggestButton.disabled = true;
  els.fullSuggestButton.textContent = "Buscando sugestões...";
  els.fullSelectionSummary.textContent = "Buscando mídias candidatas...";

  try {
    const payload = await fetchJson("/api/media/search", {
      method: "POST",
      body: JSON.stringify({
        provider: "auto",
        query,
        limit: 8,
        mediaType,
        style,
        expandTerms: true,
        persist: false,
      }),
    });
    state.fullVideoSuggestions = Array.isArray(payload.assets)
      ? payload.assets.map((asset) => ({
          ...asset,
          type: asset.type || mediaType,
          url: asset.videoUrl || asset.imageUrl || asset.url || "",
        }))
      : [];
    state.fullVideoSelectedIds = new Set(
      state.fullVideoSuggestions.slice(0, Math.min(6, state.fullVideoSuggestions.length)).map((asset) => asset.id)
    );
    renderFullVideoSuggestions();
  } catch (error) {
    els.fullSelectionSummary.textContent = "Falha ao buscar sugestões.";
    els.fullSuggestions.innerHTML = `
      <div class="job-card">
        <div class="job-card-head">
          <strong>Não foi possível sugerir mídia</strong>
          <span class="status-failed">Erro</span>
        </div>
        <div>${escapeHtml(error instanceof Error ? error.message : String(error))}</div>
      </div>
    `;
  } finally {
    els.fullSuggestButton.disabled = false;
    els.fullSuggestButton.textContent = "Sugerir mídia";
  }
}

function renderAudioResults() {
  if (!state.audioResults.length) {
    els.audioResultsMeta.textContent = "Crie uma narração para enviar à timeline.";
    els.audioResults.innerHTML = '<div class="empty-state">Nenhum áudio gerado ainda.</div>';
    return;
  }

  els.audioResultsMeta.textContent = `${state.audioResults.length} áudios disponíveis`;
  els.audioResults.innerHTML = state.audioResults
    .map(
      (audio, index) => `
        <article class="audio-card">
          <div class="audio-thumb">MP3</div>
          <div class="audio-card-copy">
            <strong>${escapeHtml(audio.title)}</strong>
            <span>${escapeHtml(audio.duration || 1)}s estimados</span>
            <audio src="${escapeHtml(audio.audioUrl)}" controls preload="metadata"></audio>
            <button type="button" class="secondary-button" data-add-audio="${index}">Adicionar à timeline</button>
          </div>
        </article>`
    )
    .join("");

  document.querySelectorAll("[data-add-audio]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-add-audio"));
      const audio = state.audioResults[index];
      if (!audio) return;
      addAudioToTimeline(audio);
    });
  });
}

function syncTimelinePlayer() {
  const clips = timelineVideoClips(state.jobs);
  const audioClips = timelineAudioClips();
  const hasVideo = clips.length > 0;
  els.timelinePlayButton.disabled = !hasVideo;
  els.timelinePlayerTitle.textContent = hasVideo
    ? `${clips.length} clipe(s) na timeline`
    : "Insira um vídeo na timeline para começar.";
  els.timelinePlayerMeta.textContent = hasVideo
    ? `${sumDuration(clips)}s de vídeo · ${sumDuration(audioClips)}s de áudio`
    : "Veja uma prévia antes da exportação final.";

  if (!hasVideo) {
    els.timelineVideo.removeAttribute("src");
    els.timelineVideo.load();
    els.timelinePlayButton.textContent = "Play timeline";
    return;
  }

  const current = clips[Math.min(state.playback.clipIndex, clips.length - 1)];
  if (els.timelineVideo.getAttribute("src") !== current.videoUrl) {
    els.timelineVideo.src = current.videoUrl;
  }
  if (audioClips[0]?.audioUrl && els.timelineAudio.getAttribute("src") !== audioClips[0].audioUrl) {
    els.timelineAudio.src = audioClips[0].audioUrl;
  }
}

async function stopTimelinePlayback() {
  state.playback.playing = false;
  els.timelineVideo.pause();
  els.timelineAudio.pause();
  els.timelinePlayButton.textContent = "Play timeline";
}

async function playTimelineClip(index = 0) {
  const clips = timelineVideoClips(state.jobs);
  if (!clips.length) return;
  if (index >= clips.length) {
    state.playback.clipIndex = 0;
    await stopTimelinePlayback();
    syncTimelinePlayer();
    return;
  }

  state.playback.clipIndex = index;
  state.playback.playing = true;
  const clip = clips[index];
  els.timelineVideo.src = clip.videoUrl;
  els.timelineVideo.currentTime = 0;
  els.timelinePlayerTitle.textContent = clip.title || `Clipe ${index + 1}`;
  els.timelinePlayButton.textContent = "Pausar";

  if (index === 0 && state.timelineAudioAssets[0]?.audioUrl) {
    els.timelineAudio.src = state.timelineAudioAssets[0].audioUrl;
    els.timelineAudio.currentTime = 0;
    await els.timelineAudio.play().catch(() => null);
  }
  await els.timelineVideo.play().catch(() => null);
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText;
    throw new Error(message);
  }
  return payload;
}

function normalizeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    prompt: job.prompt || "",
    settings: job.settings || {},
    status: job.status || "queued",
    current_step: job.current_step || "queued",
    progress: Number.isFinite(Number(job.progress)) ? Number(job.progress) : 0,
    createdAt: job.created_at || job.createdAt,
    updatedAt: job.updated_at || job.updatedAt,
    timeline: job.timeline || [],
    assetManifest: job.asset_manifest || job.assetManifest || {},
    videoUrl: job.video_url || job.videoUrl || "",
    script: job.script || "",
    error: job.error || "",
  };
}

async function loadConfig() {
  try {
    const payload = await fetchJson("/api/config");
    state.config = payload;
  } catch (error) {
    state.config = {
      pipelineSteps: PIPELINE_FALLBACK,
      storage: { supabase: false, r2: false, backend: false },
      mode: "local",
    };
    console.warn(error);
  }
  if (Array.isArray(state.config?.voiceProfiles) && els.ttsVoice) {
    const voiceOptions = state.config.voiceProfiles
      .map(
        (profile) =>
          `<option value="${escapeHtml(profile.id)}" ${
            profile.disabled ? "disabled" : ""
          } title="${escapeHtml(profile.reason || "")}">${escapeHtml(profile.label)}</option>`
      )
      .join("");
    els.ttsVoice.innerHTML = voiceOptions;
    els.fullVideoVoice.innerHTML = voiceOptions;
  }
  renderInfra(state.config);
  renderPipeline(state.jobs[0] || null);
  renderTimeline(state.jobs);
}

async function loadJobs() {
  try {
    const payload = await fetchJson("/api/jobs?limit=8");
    state.jobs = Array.isArray(payload.jobs)
      ? payload.jobs.map(normalizeJob)
      : [];
    renderHistory(state.jobs);
    renderTimeline(state.jobs);
    const activeJob = state.activeJobId
      ? state.jobs.find((job) => job.id === state.activeJobId)
      : state.jobs[0];
    renderJobDetail(activeJob || null);
  } catch (error) {
    els.history.innerHTML =
      '<div class="empty-state">Não foi possível carregar o histórico.</div>';
    console.warn(error);
  }
}

function normalizeMediaAsset(asset) {
  if (!asset) return null;
  return {
    id: asset.id,
    title: asset.title || asset.prompt || "Asset",
    duration: Number(asset.duration || 4),
    videoUrl: asset.videoUrl || (asset.type === "video" ? asset.url : ""),
    audioUrl: asset.audioUrl || (asset.type === "audio" ? asset.url : ""),
    source: asset.provider === "byteplus" ? "IA" : asset.provider || "asset",
    type: asset.type,
    createdAt: asset.createdAt,
  };
}

async function loadAudioAssets() {
  try {
    const payload = await fetchJson("/api/media/assets?type=audio&limit=12");
    state.audioResults = Array.isArray(payload.assets)
      ? payload.assets.map(normalizeMediaAsset).filter(Boolean)
      : [];
    renderAudioResults();
  } catch (error) {
    console.warn(error);
    renderAudioResults();
  }
}

function scheduleRefresh(jobId) {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
  }
  state.refreshTimer = setInterval(async () => {
    if (!state.activeJobId) {
      clearInterval(state.refreshTimer);
      return;
    }
    try {
      const payload = await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}?refresh=1`);
      const job = normalizeJob(payload.job);
      state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)];
      renderJobDetail(job);
      renderHistory(state.jobs.slice(0, 8));
      renderTimeline(state.jobs);
      if (job.status === "done" || job.status === "failed") {
        clearInterval(state.refreshTimer);
      }
    } catch (error) {
      console.warn(error);
    }
  }, 5000);
}

async function submitPrompt(prompt, mode = "ai") {
  const settings =
    mode === "full"
      ? buildFullVideoSettings()
      : await buildGenerationSettings();
  if (!settings) return;

  const button = mode === "full" ? els.fullVideoButton : els.submitButton;
  button.disabled = true;
  button.textContent = "Criando...";
  try {
    const payload = await fetchJson("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ prompt, settings }),
    });
    const job = normalizeJob(payload.job);
    state.activeJobId = job.id;
    state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)];
    renderJobDetail(job);
    renderHistory(state.jobs.slice(0, 8));
    renderTimeline(state.jobs);
    scheduleRefresh(job.id);
  } catch (error) {
    els.jobDetail.className = "job-detail";
    els.jobDetail.innerHTML = `
      <div class="job-card">
        <div class="job-card-head">
          <strong>Falha ao iniciar a criação</strong>
          <span class="status-failed">Erro</span>
        </div>
        <div>${escapeHtml(error instanceof Error ? error.message : String(error))}</div>
      </div>
    `;
    els.jobMeta.textContent = "Não foi possível criar o vídeo.";
  } finally {
    button.disabled = false;
    button.textContent = mode === "full" ? "Gerar vídeo completo" : "Gerar clipe";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () =>
      reject(reader.error || new Error("Falha ao ler imagem."))
    );
    reader.readAsDataURL(file);
  });
}

function showInlineError(title, message) {
  els.jobDetail.className = "job-detail";
  els.jobDetail.innerHTML = `
    <div class="job-card">
      <div class="job-card-head">
        <strong>${escapeHtml(title)}</strong>
        <span class="status-failed">Erro</span>
      </div>
      <div>${escapeHtml(message)}</div>
    </div>
  `;
  els.jobMeta.textContent = "Configuração incompleta.";
}

async function buildGenerationSettings() {
  const settings = { ...DEFAULT_CLIP_SETTINGS };

  const image = els.seedanceImage.files?.[0] || null;
  if (!image) return settings;
  if (!image.type.startsWith("image/")) {
    showInlineError("Imagem inválida", "Envie uma imagem PNG, JPG ou WebP.");
    return null;
  }
  if (image.size > MAX_SEEDANCE_IMAGE_BYTES) {
    showInlineError(
      "Imagem muito grande",
      "Use uma imagem de até 8 MB para o primeiro MVP."
    );
    return null;
  }

  settings.imageDataUrl = await readFileAsDataUrl(image);
  return settings;
}

function buildFullVideoSettings() {
  const mediaMode = els.fullMediaMode.value;
  const mediaStyle = els.fullMediaStyle.value;
  const selectedMedia = selectedFullMedia();
  if (!selectedMedia.length) {
    showInlineError(
      "Selecione a mídia",
      "Clique em “Sugerir mídia” e marque os clipes/imagens que devem entrar no vídeo."
    );
    return null;
  }
  const { clipDuration, maxNarrationSeconds } = derivedFullVideoPlan(selectedMedia.length);
  return {
    ...DEFAULT_FULL_VIDEO_SETTINGS,
    voiceProfile: els.fullVideoVoice.value,
    source: "local",
    mediaMode,
    mediaStyle,
    aspect: els.fullVideoAspect.value,
    selectedMedia: selectedMedia.map((asset) => ({
      id: asset.id,
      provider: asset.provider,
      type: asset.type,
      title: asset.title,
      duration: asset.duration,
      videoUrl: asset.videoUrl,
      imageUrl: asset.imageUrl,
      url: asset.videoUrl || asset.imageUrl || asset.url,
    })),
    maxNarrationSeconds,
    videoClipDuration: clipDuration,
    subtitleEnabled: els.fullSubtitleEnabled.value !== "false",
    subtitlePosition: els.fullSubtitlePosition.value,
    subtitleFontSize: Number(els.fullSubtitleSize.value || 60),
    subtitleStrokeWidth: Number(els.fullSubtitleStroke.value || 2),
    subtitleStrokeColor: els.fullSubtitleStrokeColor.value || "#000000",
  };
}

function setActiveTab(tab) {
  state.activeTab = ["full", "library", "tts"].includes(tab) ? tab : "ai";
  document.querySelectorAll(".workspace-tab").forEach((button) => {
    const isActive = button.getAttribute("data-tab") === state.activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  els.form.hidden = state.activeTab !== "ai";
  els.fullVideoForm.hidden = state.activeTab !== "full";
  els.mediaSearchForm.hidden = state.activeTab !== "library";
  els.ttsForm.hidden = state.activeTab !== "tts";
  localStorage.setItem("mpt:active-tab", state.activeTab);
}

function addMediaToTimeline(asset) {
  const duration = Math.max(1, Math.round(Number(asset.duration || 4)));
  const usedSeconds = state.timelineAssets.reduce(
    (total, item) => total + Math.max(1, Math.round(Number(item.duration || 4))),
    0
  );
  if (usedSeconds + duration > TIMELINE_LIMIT_SECONDS) {
    els.mediaResultsMeta.textContent = `A timeline já passaria de ${TIMELINE_LIMIT_SECONDS}s. Remova clipes em uma próxima etapa do editor.`;
    return;
  }

  state.timelineAssets.push({
    id: `${asset.id}-${Date.now()}`,
    title: asset.title,
    duration,
    videoUrl: asset.videoUrl,
    source: "Pexels",
  });
  renderTimeline(state.jobs);
}

function addAudioToTimeline(audio) {
  const duration = Math.max(1, Math.round(Number(audio.duration || 4)));
  const usedSeconds = state.timelineAudioAssets.reduce(
    (total, item) => total + Math.max(1, Math.round(Number(item.duration || 4))),
    0
  );
  if (usedSeconds + duration > TIMELINE_LIMIT_SECONDS) {
    els.audioResultsMeta.textContent = `A faixa de áudio já passaria de ${TIMELINE_LIMIT_SECONDS}s.`;
    return;
  }

  state.timelineAudioAssets.push({
    id: `${audio.id}-${Date.now()}`,
    title: audio.title,
    duration,
    audioUrl: audio.audioUrl,
    source: "Narração",
  });
  renderTimeline(state.jobs);
}

async function createTtsAudio() {
  const text = els.ttsText.value.trim();
  if (!text) return;

  els.ttsButton.disabled = true;
  els.ttsButton.textContent = "Gerando áudio...";
  els.audioResultsMeta.textContent = "Gerando narração.";
  try {
    const payload = await fetchJson("/api/audio/tts", {
      method: "POST",
      body: JSON.stringify({
        text,
        voiceProfile: els.ttsVoice.value,
      }),
    });
    const audio = normalizeMediaAsset({
      ...payload.audio,
      type: "audio",
      url: payload.audio?.audioUrl,
    });
    if (audio) {
      state.audioResults = [audio, ...state.audioResults.filter((item) => item.id !== audio.id)];
    }
    renderAudioResults();
  } catch (error) {
    els.audioResultsMeta.textContent = "Falha ao gerar narração.";
    els.audioResults.innerHTML = `
      <div class="job-card">
        <div class="job-card-head">
          <strong>Não foi possível gerar o áudio</strong>
          <span class="status-failed">Erro</span>
        </div>
        <div>${escapeHtml(error instanceof Error ? error.message : String(error))}</div>
      </div>
    `;
  } finally {
    els.ttsButton.disabled = false;
    els.ttsButton.textContent = "Gerar áudio";
  }
}

async function searchMedia() {
  const query = els.mediaQuery.value.trim();
  if (!query) return;

  els.mediaSearchButton.disabled = true;
  els.mediaSearchButton.textContent = "Buscando...";
  els.mediaResultsMeta.textContent = "Buscando clipes para sua biblioteca.";
  try {
    const payload = await fetchJson("/api/media/search", {
      method: "POST",
      body: JSON.stringify({
        provider: "pexels",
        query,
        limit: Number(els.mediaLimit.value || 6),
        persist: true,
      }),
    });
    state.mediaResults = Array.isArray(payload.assets) ? payload.assets : [];
    renderMediaResults();
  } catch (error) {
    els.mediaResultsMeta.textContent = "Falha na busca.";
    els.mediaResults.innerHTML = `
      <div class="job-card">
        <div class="job-card-head">
          <strong>Não foi possível buscar clipes</strong>
          <span class="status-failed">Erro</span>
        </div>
        <div>${escapeHtml(error instanceof Error ? error.message : String(error))}</div>
      </div>
    `;
  } finally {
    els.mediaSearchButton.disabled = false;
    els.mediaSearchButton.textContent = "Buscar vídeos";
  }
}

function bindEvents() {
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = els.prompt.value.trim();
    if (!prompt) return;
    await submitPrompt(prompt, "ai");
  });

  els.fullVideoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = els.fullVideoPrompt.value.trim();
    if (!prompt) return;
    await submitPrompt(prompt, "full");
  });

  els.fullSuggestButton.addEventListener("click", async () => {
    await suggestFullVideoMedia();
  });

  [els.fullMediaMode, els.fullMediaStyle, els.fullVideoAspect].forEach((input) => {
    input.addEventListener("change", () => {
      state.fullVideoSuggestions = [];
      state.fullVideoSelectedIds = new Set();
      renderFullVideoSuggestions();
    });
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      const search = chip.getAttribute("data-search");
      if (search) {
        setActiveTab("library");
        els.mediaQuery.value = search;
        els.mediaQuery.focus();
        return;
      }
      els.prompt.value = chip.getAttribute("data-prompt") || chip.textContent.trim();
      setActiveTab("ai");
      els.prompt.focus();
    });
  });

  document.querySelectorAll(".workspace-tab").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.getAttribute("data-tab")));
  });

  document.querySelectorAll("[data-mode-tab]").forEach((link) => {
    link.addEventListener("click", () => setActiveTab(link.getAttribute("data-mode-tab")));
  });

  els.mediaSearchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await searchMedia();
  });

  els.ttsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createTtsAudio();
  });

  els.timelinePlayButton.addEventListener("click", async () => {
    if (state.playback.playing) {
      await stopTimelinePlayback();
      return;
    }
    await playTimelineClip(state.playback.clipIndex || 0);
  });

  els.timelineVideo.addEventListener("ended", async () => {
    if (!state.playback.playing) return;
    await playTimelineClip(state.playback.clipIndex + 1);
  });
}

async function init() {
  els.form = $("#prompt-form");
  els.fullVideoForm = $("#full-video-form");
  els.mediaSearchForm = $("#media-search-form");
  els.ttsForm = $("#tts-form");
  els.prompt = $("#prompt");
  els.fullVideoPrompt = $("#full-video-prompt");
  els.fullVideoVoice = $("#full-video-voice");
  els.fullMediaMode = $("#full-media-mode");
  els.fullMediaStyle = $("#full-media-style");
  els.fullVideoAspect = $("#full-video-aspect");
  els.fullSubtitleEnabled = $("#full-subtitle-enabled");
  els.fullSubtitlePosition = $("#full-subtitle-position");
  els.fullSubtitleSize = $("#full-subtitle-size");
  els.fullSubtitleStroke = $("#full-subtitle-stroke");
  els.fullSubtitleStrokeColor = $("#full-subtitle-stroke-color");
  els.fullSuggestButton = $("#full-suggest-button");
  els.fullSelectionSummary = $("#full-selection-summary");
  els.fullSuggestions = $("#full-suggestions");
  els.fullVideoButton = $("#full-video-button");
  els.ttsText = $("#tts-text");
  els.ttsVoice = $("#tts-voice");
  els.ttsButton = $("#tts-button");
  els.seedanceSettings = $("#seedance-settings");
  els.seedanceImage = $("#seedance-image");
  els.submitButton = $("#submit-button");
  els.mediaQuery = $("#media-query");
  els.mediaLimit = $("#media-limit");
  els.mediaSearchButton = $("#media-search-button");
  els.pipeline = $("#pipeline");
  els.infraGrid = $("#infra-grid");
  els.infraPill = $("#infra-pill");
  els.jobMeta = $("#job-meta");
  els.jobDetail = $("#job-detail");
  els.timelineMeta = $("#timeline-meta");
  els.timelineBoard = $("#timeline-board");
  els.timelinePlayer = $("#timeline-player");
  els.timelineVideo = $("#timeline-video");
  els.timelineAudio = $("#timeline-audio");
  els.timelinePlayerTitle = $("#timeline-player-title");
  els.timelinePlayerMeta = $("#timeline-player-meta");
  els.timelinePlayButton = $("#timeline-play-button");
  els.mediaResultsMeta = $("#media-results-meta");
  els.mediaResults = $("#media-results");
  els.audioResultsMeta = $("#audio-results-meta");
  els.audioResults = $("#audio-results");
  els.history = $("#history");

  bindEvents();
  await loadConfig();
  await loadJobs();
  await loadAudioAssets();

  const lastPrompt = localStorage.getItem("mpt:last-prompt");
  if (lastPrompt && !els.prompt.value.trim()) {
    els.prompt.value = lastPrompt;
  }
  const lastFullPrompt = localStorage.getItem("mpt:last-full-prompt");
  if (lastFullPrompt && !els.fullVideoPrompt.value.trim()) {
    els.fullVideoPrompt.value = lastFullPrompt;
  }
  setActiveTab(localStorage.getItem("mpt:active-tab") || "ai");
  renderFullVideoSuggestions();
  renderMediaResults();
  renderAudioResults();
  els.prompt.addEventListener("input", () => {
    localStorage.setItem("mpt:last-prompt", els.prompt.value);
  });
  els.fullVideoPrompt.addEventListener("input", () => {
    localStorage.setItem("mpt:last-full-prompt", els.fullVideoPrompt.value);
  });
}

init().catch((error) => {
  console.error(error);
});
