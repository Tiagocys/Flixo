const state = {
  jobId: null,
  job: null,
  timer: null,
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
  error: document.getElementById("podcast-error"),
  candidatesMeta: document.getElementById("podcast-candidates-meta"),
  candidates: document.getElementById("podcast-candidates"),
  renderButton: document.getElementById("podcast-render-button"),
  outputsMeta: document.getElementById("podcast-outputs-meta"),
  outputs: document.getElementById("podcast-outputs"),
  youtubeStatusMeta: document.getElementById("podcast-youtube-status-meta"),
  youtubeConnectButton: document.getElementById("podcast-youtube-connect-button"),
  youtubeUploadAllButton: document.getElementById("podcast-youtube-upload-all-button"),
  youtubePrivacy: document.getElementById("podcast-youtube-privacy"),
  youtubeVideoLanguage: document.getElementById("podcast-youtube-video-language"),
  youtubeAudioLanguage: document.getElementById("podcast-youtube-audio-language"),
  youtubeCaptionLanguage: document.getElementById("podcast-youtube-caption-language"),
  removeSilence: document.getElementById("podcast-remove-silence"),
  artificialCuts: document.getElementById("podcast-artificial-cuts"),
  burnSubtitles: document.getElementById("podcast-burn-subtitles"),
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
  const eta = effectiveEta(job);
  if (Number.isFinite(eta) && eta > 0 && !["ready", "done", "failed", "cancelled"].includes(job?.status)) {
    return `Estimativa total: seus shorts editáveis devem ficar prontos em cerca de ${formatEta(eta)}.`;
  }
  if (["queued", "running", "rendering"].includes(job?.status)) {
    return "Calculando estimativa total para entregar seus shorts editáveis.";
  }
  if (job?.status === "ready") {
    return "Cortes sugeridos prontos. Selecione os trechos que deseja transformar em shorts editáveis.";
  }
  if (job?.status === "done") {
    return "Shorts editáveis prontos.";
  }
  if (isInterruptedJob(job)) {
    return "Processo interrompido. Você pode iniciar um novo teste.";
  }
  if (job?.status === "failed") {
    return "Não foi possível concluir este projeto.";
  }
  return "Nenhuma análise iniciada.";
}

function effectiveEta(job) {
  const backendEta = Number(job?.estimated_remaining_seconds);
  const dynamicEta = dynamicEtaFromProgress(job);
  if (Number.isFinite(backendEta) && backendEta > 0 && Number.isFinite(dynamicEta) && dynamicEta > 0) {
    return Math.max(backendEta, dynamicEta);
  }
  if (Number.isFinite(dynamicEta) && dynamicEta > 0) return dynamicEta;
  if (Number.isFinite(backendEta) && backendEta > 0) return backendEta;
  return 0;
}

function dynamicEtaFromProgress(job) {
  if (!job || !["running", "rendering"].includes(job.status)) return 0;
  const startedAt = Number(job.step_started_at || job.created_at || 0);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return 0;
  const elapsed = Date.now() / 1000 - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 30) return 0;

  const progress = Number(job.progress || 0);
  let phasePercent = 0;
  if (job.current_step === "transcribing") {
    phasePercent = (progress - 35) / 30;
  } else if (job.current_step === "rendering") {
    phasePercent = (progress - 15) / 80;
  } else if (job.current_step === "analyzing") {
    phasePercent = 0.7;
  }
  phasePercent = Math.max(0.05, Math.min(0.97, phasePercent));
  return Math.round(Math.max(60, Math.min(7200, (elapsed * (1 - phasePercent)) / phasePercent)));
}

function formatEta(secondsValue) {
  const seconds = Math.max(1, Math.round(Number(secondsValue || 0)));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest ? `${minutes}min ${rest}s` : `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const hourMinutes = minutes % 60;
  return hourMinutes ? `${hours}h ${hourMinutes}min` : `${hours}h`;
}

function setProgress(job) {
  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));
  if (els.progressBar) {
    els.progressBar.style.width = `${progress}%`;
  }
  els.statusPill.textContent = jobStatusLabel(job);
  els.statusMeta.textContent = statusMessage(job);
  if (els.cancelButton) {
    els.cancelButton.hidden = !["queued", "running", "rendering"].includes(job?.status);
    els.cancelButton.disabled = false;
    els.cancelButton.textContent = "Interromper processo";
  }
  if (job?.error && !isInterruptedJob(job)) {
    els.error.hidden = false;
    els.error.textContent = job.error;
  } else {
    els.error.hidden = true;
    els.error.textContent = "";
  }
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
    return;
  }

  els.candidatesMeta.textContent = `${candidates.length} cortes sugeridos. Selecione os melhores.`;
  els.candidates.innerHTML = candidates
    .map((candidate, index) => {
      const checked = index < Math.min(4, candidates.length) ? "checked" : "";
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
            <p><b>Score narrativo:</b> ${escapeHtml(score)}%. A câmera será decidida apenas na renderização.</p>
            <p><b>Hook:</b> ${escapeHtml(candidate.hook || "Sem hook identificado.")}</p>
            <p>${escapeHtml(candidate.summary || candidate.reason || "")}</p>
          </div>
        </label>
      `;
    })
    .join("");
  els.renderButton.disabled = job.status !== "ready" && job.status !== "done";
}

function coverOptionsHtml(output) {
  const options = Array.isArray(output?.cover_options) ? output.cover_options : [];
  if (!options.length) {
    return "";
  }

  const cards = options
    .map((option, index) => {
      const label = option.label || String.fromCharCode(65 + index);
      const url = option.url || option.cover_url || "";
      const selected = index === 0 ? "true" : "false";
      if (!url) {
        return "";
      }
      return `
        <button
          type="button"
          class="cover-option-card"
          data-cover-option="${escapeHtml(output.id)}"
          data-cover-url="${escapeHtml(url)}"
          data-cover-label="Opção ${escapeHtml(label)}"
          data-selected="${selected}"
          aria-pressed="${selected}"
        >
          <img src="${escapeHtml(url)}" alt="Capa sugerida ${escapeHtml(label)}" loading="lazy" />
          <span>${index === 0 ? "Selecionada" : `Opção ${escapeHtml(label)}`}</span>
        </button>
      `;
    })
    .join("");

  if (!cards) {
    return "";
  }

  return `
    <section class="cover-options">
      <div class="cover-options-head">
        <strong>Capas sugeridas</strong>
        <span>Mesmo título, frames diferentes</span>
      </div>
      <div class="cover-options-grid">
        ${cards}
      </div>
    </section>
  `;
}

function renderOutputs(job) {
  const outputs = Array.isArray(job?.outputs) ? job.outputs : [];
  if (!outputs.length) {
    els.outputsMeta.textContent = "Renderize cortes para ver os MP4s finais.";
    els.outputs.innerHTML = '<div class="empty-state">Nenhum short de podcast renderizado ainda.</div>';
    els.youtubeUploadAllButton.disabled = true;
    return;
  }
  els.outputsMeta.textContent = `${outputs.length} short(s) de podcast renderizados.`;
  els.youtubeUploadAllButton.disabled = !state.youtubeAuthorized;
  const candidatesById = new Map((job?.candidates || []).map((candidate) => [candidate.id, candidate]));
  els.outputs.innerHTML = outputs
    .map(
      (output, index) => {
        const candidate = candidatesById.get(output.id) || {};
        const title = output.title || candidate.title || `Podcast short ${index + 1}`;
        const description = outputDescription(output, candidate, title);
        const tags = outputTags(title, description);
        const camera = output?.visual_focus || {};
        const hasDynamicCamera = Array.isArray(camera.segments) && camera.segments.length > 1;
        const cameraLabel =
          hasDynamicCamera
            ? "Câmera dinâmica: zoom + 1:1"
            : camera.mode === "speaker_zoom"
            ? "Zoom/reframe no rosto falante"
            : "Quadro 1:1 centralizado";
        const videoUrl = cacheBustedUrl(output.video_url, output.subtitle_edited_at);
        const burnSubtitles = output.burn_subtitles !== false;
        return `
        <article class="clipper-output-card">
          <video src="${escapeHtml(videoUrl)}" controls playsinline preload="metadata"></video>
          <div class="clipper-output-copy">
            <div class="output-heading">
              <span>Podcast short ${index + 1}</span>
              <strong>${escapeHtml(title)}</strong>
            </div>
            ${coverOptionsHtml(output)}
            <dl class="output-metadata">
              <div>
                <dt><label for="podcast-youtube-title-${escapeHtml(output.id)}">Título do vídeo</label></dt>
                <dd>
                  <input
                    id="podcast-youtube-title-${escapeHtml(output.id)}"
                    class="output-edit-input"
                    data-youtube-title="${escapeHtml(output.id)}"
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
                <dd>${burnSubtitles ? "Embutida no MP4 + SRT disponível" : "MP4 limpo + SRT separado para YouTube"}</dd>
              </div>
              <div>
                <dt>Resumo</dt>
                <dd>${escapeHtml(output.summary || output.reason || "")}</dd>
              </div>
            </dl>
            <div class="subtitle-editor" data-subtitle-panel="${escapeHtml(output.id)}" hidden>
              <label for="podcast-subtitle-${escapeHtml(output.id)}">Editar legenda SRT</label>
              <textarea
                id="podcast-subtitle-${escapeHtml(output.id)}"
                class="output-edit-textarea"
                data-subtitle-editor="${escapeHtml(output.id)}"
                rows="9"
                spellcheck="true"
              ></textarea>
              <div class="helper">
                Ajuste apenas o texto quando possível. Preserve números e timestamps do SRT.
              </div>
            </div>
            <div class="clip-editor" data-edit-panel="${escapeHtml(output.id)}" hidden>
              <div class="clip-editor-preview">
                <video
                  src="${escapeHtml(videoUrl)}"
                  controls
                  playsinline
                  preload="metadata"
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
              <div class="quick-edit-actions">
                <button type="button" class="secondary-button" data-edit-cut-end="${escapeHtml(output.id)}" data-cut-seconds="1">Tirar 1s do final</button>
                <button type="button" class="secondary-button" data-edit-cut-end="${escapeHtml(output.id)}" data-cut-seconds="2">Tirar 2s do final</button>
                <button type="button" class="secondary-button" data-edit-cut-end="${escapeHtml(output.id)}" data-cut-seconds="3">Tirar 3s do final</button>
              </div>
              <div class="helper">
                A exportação cria uma nova versão e mantém este clipe original intacto.
              </div>
            </div>
            <div class="output-actions">
              <a class="secondary-button" href="${escapeHtml(output.video_url)}" target="_blank" rel="noreferrer">Abrir MP4</a>
              <a class="secondary-button" href="${escapeHtml(output.subtitle_url)}" target="_blank" rel="noreferrer">Abrir SRT</a>
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
                Exportar versão editada
              </button>
              <button type="button" class="secondary-button" data-subtitle-toggle="${escapeHtml(output.id)}">Editar legenda</button>
              <button type="button" class="secondary-button" data-subtitle-save="${escapeHtml(output.id)}" hidden>
                Salvar e atualizar MP4
              </button>
              <button
                type="button"
                class="secondary-button"
                data-subtitle-mode="${escapeHtml(output.id)}"
                data-burn-subtitles="${burnSubtitles ? "false" : "true"}"
              >
                ${burnSubtitles ? "Gerar MP4 limpo + SRT" : "Embutir legenda no MP4"}
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

function appendClipOptions(outputs, currentId) {
  return outputs
    .filter((output) => output?.id && output.id !== currentId)
    .map((output, index) => {
      const title = output.title || `Podcast short ${index + 1}`;
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
  const tags = ["#Shorts", "#Podcast"];
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
    ["podcast", "#Podcast"],
    ["youtube", "#YouTube"],
    ["carro", "#Carros"],
    ["historia", "#Historia"],
    ["curiosidade", "#Curiosidades"],
    ["negocio", "#Negocios"],
    ["motivacao", "#Motivacao"],
  ];
  return known.filter(([term]) => text.includes(term)).map(([, tag]) => tag);
}

function outputYoutubeOverride(outputId) {
  const title = els.outputs.querySelector(`[data-youtube-title="${CSS.escape(outputId)}"]`)?.value?.trim() || "";
  const description =
    els.outputs.querySelector(`[data-youtube-description="${CSS.escape(outputId)}"]`)?.value?.trim() || "";
  const tagsValue = els.outputs.querySelector(`[data-youtube-tags="${CSS.escape(outputId)}"]`)?.value || "";
  const coverUrl =
    els.outputs.querySelector(`[data-cover-option="${CSS.escape(outputId)}"][data-selected="true"]`)?.dataset
      ?.coverUrl || "";
  return {
    title,
    description,
    tags: parseTags(tagsValue),
    cover_url: coverUrl,
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
    els.youtubeStatusMeta.textContent = `YouTube conectado: ${channelNames}. Revise título, descrição e hashtags antes de enviar.`;
  } else if (authorized && channelError) {
    els.youtubeStatusMeta.textContent =
      "YouTube conectado, mas é preciso reconectar para permitir leitura do canal autorizado.";
  } else {
    els.youtubeStatusMeta.textContent = authorized
      ? "YouTube conectado. Revise título, descrição e hashtags antes de enviar."
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

async function cancelCurrentJob() {
  if (!state.jobId || !els.cancelButton) return;
  els.cancelButton.disabled = true;
  els.cancelButton.textContent = "Interrompendo...";
  const payload = await fetch(`/api/podcast/jobs/${encodeURIComponent(state.jobId)}/cancel`, {
    method: "POST",
  }).then(readJson);
  const job = normalizeJob(payload);
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
  button.disabled = true;
  const originalText = button.textContent;
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
    button.textContent = "Enviado";
    if (upload?.url) {
      button.insertAdjacentHTML(
        "afterend",
        ` <a class="secondary-button" href="${escapeHtml(upload.url)}" target="_blank" rel="noreferrer">Abrir YouTube</a>`,
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
    const payload = await fetch("/api/youtube/upload-podcast-job", {
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
    localStorage.removeItem(PODCAST_LAST_JOB_KEY);
    els.outputsMeta.textContent = `${uploads.length} short(s) enviados ao YouTube. Projeto local limpo.`;
    els.outputs.innerHTML = uploads
      .map(
        (upload, index) => `
          <article class="clipper-output-card youtube-clean-result">
            <div class="clipper-output-copy">
              <div class="output-heading">
                <span>Publicado ${index + 1}</span>
                <strong>${escapeHtml(upload.title || `Podcast short ${index + 1}`)}</strong>
              </div>
              <a class="secondary-button" href="${escapeHtml(upload.url)}" target="_blank" rel="noreferrer">Abrir YouTube</a>
            </div>
          </article>
        `,
      )
      .join("");
    renderCandidates(null);
    setProgress({ status: "done", current_step: "done", progress: 100 });
    setYoutubeStatus(state.youtubeConfigured, state.youtubeAuthorized);
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    els.youtubeUploadAllButton.disabled = !state.youtubeAuthorized;
  } finally {
    els.youtubeUploadAllButton.textContent = originalText;
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
  state.job = job;
  setProgress(job);
  renderCandidates(job);
  renderOutputs(job);
  if (["ready", "done", "failed", "cancelled"].includes(job?.status)) {
    clearTimeout(state.timer);
    state.timer = null;
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
  renderCandidates(null);
  renderOutputs(null);
  setProgress({ status: "queued", current_step: "queued", progress: 0 });
}

async function restoreLastJob() {
  const queryJobId = new URLSearchParams(window.location.search).get("job");
  const jobId = queryJobId || localStorage.getItem(PODCAST_LAST_JOB_KEY) || (await latestPodcastJobId());
  if (!jobId) return;
  state.jobId = jobId;
  try {
    const payload = await fetch(`/api/podcast/jobs/${encodeURIComponent(jobId)}`).then(readJson);
    const job = normalizeJob(payload);
    if (!queryJobId && isInterruptedJob(job)) {
      localStorage.removeItem(PODCAST_LAST_JOB_KEY);
      state.jobId = null;
      state.job = null;
      renderCandidates(null);
      renderOutputs(null);
      setProgress({ status: "queued", current_step: "queued", progress: 0 });
      return;
    }
    localStorage.setItem(PODCAST_LAST_JOB_KEY, job.id);
    state.job = job;
    setProgress(job);
    renderCandidates(job);
    renderOutputs(job);
    if (!["ready", "done", "failed", "cancelled"].includes(job?.status)) {
      scheduleRefresh(job);
    }
  } catch (_error) {
    localStorage.removeItem(PODCAST_LAST_JOB_KEY);
    state.jobId = null;
    state.job = null;
    renderCandidates(null);
    renderOutputs(null);
  }
}

async function latestPodcastJobId() {
  const payload = await fetch("/api/podcast/jobs?limit=10").then(readJson).catch(() => null);
  const jobs = payload?.data?.jobs || payload?.jobs || [];
  return jobs.find((job) => !isInterruptedJob(job) && job?.status !== "failed")?.id || "";
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

function selectCoverOption(outputId, coverUrl) {
  if (!outputId || !coverUrl) return;
  const buttons = els.outputs.querySelectorAll(`[data-cover-option="${CSS.escape(outputId)}"]`);
  for (const button of buttons) {
    const selected = button.dataset.coverUrl === coverUrl;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    const label = button.querySelector("span");
    if (label) {
      label.textContent = selected ? "Selecionada" : button.dataset.coverLabel || "Opção";
    }
  }
}

async function loadSubtitle(outputId) {
  const payload = await fetch(
    `/api/podcast/jobs/${encodeURIComponent(state.jobId)}/outputs/${encodeURIComponent(outputId)}/subtitle`,
  ).then(readJson);
  return payload?.data?.subtitle || payload?.subtitle || "";
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
  const preview = els.outputs.querySelector(`[data-edit-preview="${CSS.escape(outputId)}"]`);
  if (!preview) return;
  preview.currentTime = Math.max(0, Math.min(Number(time || 0), clipDuration(outputId)));
  syncPreviewPlayhead(outputId);
}

els.outputs.addEventListener("click", async (event) => {
  const coverOption = event.target.closest("[data-cover-option]");
  if (coverOption) {
    selectCoverOption(coverOption.dataset.coverOption, coverOption.dataset.coverUrl);
    return;
  }

  const youtubeButton = event.target.closest(".youtube-upload-button");
  if (youtubeButton) {
    uploadOutputToYoutube(youtubeButton.dataset.outputId, youtubeButton);
    return;
  }

  const editToggle = event.target.closest("[data-edit-toggle]");
  const editSave = event.target.closest("[data-edit-save]");
  const editCutEnd = event.target.closest("[data-edit-cut-end]");
  if (editToggle || editSave || editCutEnd) {
    const outputId = String(
      editToggle?.dataset.editToggle || editSave?.dataset.editSave || editCutEnd?.dataset.editCutEnd || "",
    );
    if (!outputId) return;
    const panel = els.outputs.querySelector(`[data-edit-panel="${CSS.escape(outputId)}"]`);
    const saveButton = els.outputs.querySelector(`[data-edit-save="${CSS.escape(outputId)}"]`);
    if (editCutEnd) {
      setTrimEnd(outputId, Number(editCutEnd.dataset.cutSeconds || 0));
      return;
    }
    if (editToggle) {
      const opening = panel?.hidden;
      if (panel) panel.hidden = !opening;
      if (saveButton) saveButton.hidden = !opening;
      if (opening) syncClipRangeTimeline(outputId);
      return;
    }
    editSave.disabled = true;
    editSave.textContent = "Exportando...";
    try {
      const output = await exportEditedOutput(outputId);
      appendOutput(output);
      renderOutputs(state.job);
      els.outputsMeta.textContent = "Versão editada criada. Revise a nova saída antes de enviar.";
    } catch (error) {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      editSave.disabled = false;
      editSave.textContent = "Exportar versão editada";
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
  const textarea = els.outputs.querySelector(`[data-subtitle-editor="${CSS.escape(outputId)}"]`);
  const saveButton = els.outputs.querySelector(`[data-subtitle-save="${CSS.escape(outputId)}"]`);
  if (!outputId) return;

  if (mode) {
    const burnSubtitles = mode.dataset.burnSubtitles === "true";
    mode.disabled = true;
    mode.textContent = burnSubtitles ? "Embutindo..." : "Gerando MP4 limpo...";
    try {
      const updatedOutput = await setSubtitleMode(outputId, burnSubtitles);
      if (updatedOutput) replaceOutput(updatedOutput);
      renderOutputs(state.job);
    } catch (error) {
      els.error.hidden = false;
      els.error.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      mode.disabled = false;
    }
    return;
  }

  if (!panel || !textarea || !saveButton) return;

  if (toggle) {
    const opening = panel.hidden;
    panel.hidden = !opening;
    saveButton.hidden = !opening;
    if (opening && !textarea.value.trim()) {
      toggle.disabled = true;
      toggle.textContent = "Carregando...";
      try {
        textarea.value = await loadSubtitle(outputId);
      } catch (error) {
        els.error.hidden = false;
        els.error.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        toggle.disabled = false;
        toggle.textContent = "Editar legenda";
      }
    }
    return;
  }

  save.disabled = true;
  save.textContent = "Atualizando MP4...";
  try {
    const updatedOutput = await saveSubtitle(outputId, textarea.value);
    if (updatedOutput) replaceOutput(updatedOutput);
    renderOutputs(state.job);
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    save.disabled = false;
    save.textContent = "Salvar e atualizar MP4";
  }
});

els.outputs.addEventListener("input", (event) => {
  const startInput = event.target.closest("[data-edit-start]");
  const endInput = event.target.closest("[data-edit-end]");
  const outputId = startInput?.dataset.editStart || endInput?.dataset.editEnd || "";
  if (!outputId) return;
  syncClipRangeTimeline(outputId);
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
    localStorage.setItem(PODCAST_LAST_JOB_KEY, job.id);
    setProgress(job);
    renderCandidates(job);
    renderOutputs(job);
    scheduleRefresh();
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = "Analisar podcast";
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
    const payload = await fetch(`/api/podcast/jobs/${encodeURIComponent(state.jobId)}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selected_ids: selectedIds,
        burn_subtitles: els.burnSubtitles.checked,
        remove_silence: els.removeSilence.checked,
        artificial_cuts: els.artificialCuts.checked,
      }),
    }).then(readJson);
    state.job = normalizeJob(payload);
    setProgress(state.job);
    scheduleRefresh();
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    els.renderButton.textContent = "Renderizar selecionados";
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

els.cancelButton?.addEventListener("click", () => {
  cancelCurrentJob().catch((error) => {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    if (els.cancelButton) {
      els.cancelButton.disabled = false;
      els.cancelButton.textContent = "Interromper processo";
    }
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
