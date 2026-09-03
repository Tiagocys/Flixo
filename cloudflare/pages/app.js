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
  mediaResultsMode: "history",
  fullVideoSuggestions: [],
  fullVideoSelectedIds: new Set(),
  timelineAssets: [],
  audioResults: [],
  imageResults: [],
  timelineAudioAssets: [],
  activeJobId: null,
  activeTab: "ai",
  locale: null,
  playback: {
    clipIndex: 0,
    playing: false,
  },
  refreshTimer: null,
};

const DEFAULT_CLIP_SETTINGS = {
  provider: "byteplus",
  model: "seedance-1-5-pro-251215",
  qualityPreset: "balanced",
  duration: 4,
  resolution: "480p",
  ratio: "9:16",
  cameraFixed: false,
};

const AI_VIDEO_QUALITY_PRESETS = [
  {
    id: "balanced",
    labelKey: "aiQualityBalancedTitle",
    descriptionKey: "aiQualityBalancedDescription",
    model: "seedance-1-5-pro-251215",
    resolution: "480p",
  },
  {
    id: "fast",
    labelKey: "aiQualityFastTitle",
    descriptionKey: "aiQualityFastDescription",
    model: "dreamina-seedance-2-0-fast-260128",
    resolution: "480p",
  },
  {
    id: "economy",
    labelKey: "aiQualityEconomyTitle",
    descriptionKey: "aiQualityEconomyDescription",
    model: "dreamina-seedance-2-0-mini-260615",
    resolution: "480p",
  },
  {
    id: "quality",
    labelKey: "aiQualityQualityTitle",
    descriptionKey: "aiQualityQualityDescription",
    model: "dreamina-seedance-2-0-260128",
    resolution: "720p",
  },
];

const AI_VIDEO_DURATION_OPTIONS = [
  { value: 4, labelKey: "aiDurationShortTitle", descriptionKey: "aiDurationShortDescription" },
  { value: 8, labelKey: "aiDurationMediumTitle", descriptionKey: "aiDurationMediumDescription" },
  { value: 12, labelKey: "aiDurationLongTitle", descriptionKey: "aiDurationLongDescription" },
];

const AI_VIDEO_RATIO_OPTIONS = [
  { value: "9:16", labelKey: "aiRatioPortraitTitle", descriptionKey: "aiRatioPortraitDescription" },
  { value: "1:1", labelKey: "aiRatioSquareTitle", descriptionKey: "aiRatioSquareDescription" },
  { value: "16:9", labelKey: "aiRatioLandscapeTitle", descriptionKey: "aiRatioLandscapeDescription" },
];

const AI_VIDEO_RESOLUTION_OPTIONS = [
  { value: "480p", labelKey: "aiResolutionEconomyTitle", descriptionKey: "aiResolutionEconomyDescription" },
  { value: "720p", labelKey: "aiResolutionStandardTitle", descriptionKey: "aiResolutionStandardDescription" },
  { value: "1080p", labelKey: "aiResolutionHighTitle", descriptionKey: "aiResolutionHighDescription" },
];

const AI_IMAGE_QUALITY_PRESETS = [
  {
    id: "economy",
    labelKey: "imageQualityEconomyTitle",
    descriptionKey: "imageQualityEconomyDescription",
    model: "seedream-5-0-lite-260128",
  },
  {
    id: "quality",
    labelKey: "imageQualityQualityTitle",
    descriptionKey: "imageQualityQualityDescription",
    model: "seedream-4-5-251128",
  },
];

const AI_IMAGE_SIZE_OPTIONS = [
  { value: "2k", labelKey: "imageSizeSmallTitle", descriptionKey: "imageSizeSmallDescription" },
  { value: "3k", labelKey: "imageSizeMediumTitle", descriptionKey: "imageSizeMediumDescription" },
  { value: "4k", labelKey: "imageSizeLargeTitle", descriptionKey: "imageSizeLargeDescription" },
];
const STATIC_AI_IMAGE_EXAMPLE_URL = "/assets/examples/ai-image-example-seedream.jpg";
const STATIC_AI_IMAGE_EXAMPLE_PROMPT =
  "Uma imagem vertical cinematográfica de um criador de conteúdo trabalhando em um estúdio minimalista, luz natural entrando pela janela, notebook aberto com uma timeline de vídeo abstrata, câmera sobre a mesa, atmosfera moderna, cores claras, fotografia editorial, sem texto, sem logos.";
const STATIC_AI_IMAGE_EXAMPLE_META = ["Alta qualidade", "2k"];

const DEFAULT_FULL_VIDEO_SETTINGS = {
  provider: "moneyprinterturbo",
  tts: "gemini",
  voiceProfile: "kore-firme",
  language: "pt-BR",
  source: "disabled",
  aspect: "portrait",
  music: false,
  bgm_type: "",
  bgm_volume: 0,
};

const MAX_SEEDANCE_IMAGE_BYTES = 8 * 1024 * 1024;
const TIMELINE_LIMIT_SECONDS = 60;
const FULL_SUBTITLE_COLOR_PRESETS = [
  { text: "white", border: "black", label: "Branca com borda preta", textHex: "#ffffff", borderHex: "#000000" },
  { text: "yellow", border: "black", label: "Amarela com borda preta", textHex: "#ffdd57", borderHex: "#000000" },
  { text: "blue", border: "black", label: "Azul com borda preta", textHex: "#38bdf8", borderHex: "#000000" },
  { text: "red", border: "black", label: "Vermelha com borda preta", textHex: "#ef4444", borderHex: "#000000" },
];
const FULL_SUBTITLE_SIZE_OPTIONS = [
  { value: "small", label: "Menor", fontSize: 48 },
  { value: "medium", label: "Média", fontSize: 60 },
  { value: "large", label: "Maior", fontSize: 72 },
];
const FULL_SUBTITLE_STYLE_OPTIONS = [
  { value: "standard", label: "Blocos no rodapé" },
  { value: "word", label: "Palavra por palavra" },
];
const FULL_SUBTITLE_POSITION_OPTIONS = [
  { value: "top", label: "Topo", backendValue: "top" },
  { value: "middle", label: "Centro", backendValue: "center" },
  { value: "bottom", label: "Baixo", backendValue: "bottom" },
];
const FULL_SUBTITLE_PREVIEW_ID = "full-video";
const ACTIVE_CREATION_STATUSES = new Set(["queued", "running", "waiting"]);

const els = {};

const I18N = {
  "pt-BR": {
    pageTitle: "Flixo",
    pageDescription:
      "Crie clipes por IA, narrações e cortes editáveis para seus vídeos.",
    workspaceEyebrowAi: "Criação com IA",
    workspaceTitleAi: "Crie clipes curtos a partir de um prompt.",
    workspaceDescriptionAi:
      "Descreva uma cena curta e gere um clipe visual com IA. Use imagem opcional quando quiser guiar o resultado.",
    workspaceEyebrowImage: "Imagem com IA",
    workspaceTitleImage: "Crie imagens para posts, capas e ideias visuais.",
    workspaceDescriptionImage:
      "Digite um prompt, escolha a qualidade e gere uma imagem pronta para usar.",
    workspaceEyebrowFull: "Vídeo completo",
    workspaceTitleFull: "Crie vídeos de até 1 minuto a partir de um roteiro.",
    workspaceDescriptionFull:
      "Escreva o tema, escolha as mídias sugeridas e gere um vídeo curto com narração, legenda e acabamento visual.",
    workspaceEyebrowLibrary: "Biblioteca",
    workspaceTitleLibrary: "Busque vídeos únicos por termo.",
    workspaceDescriptionLibrary:
      "Pesquise clipes em banco de mídia para encontrar referências e materiais visuais rapidamente.",
    workspaceEyebrowTts: "Narração",
    workspaceTitleTts: "Transforme texto em narração.",
    workspaceDescriptionTts:
      "Digite uma fala curta e gere áudio para usar nos seus vídeos.",
    tabAi: "Criar vídeo com IA",
    tabImage: "Criar imagem com IA",
    tabFull: "Vídeo completo",
    tabLibrary: "Buscar vídeos por termos",
    tabTts: "Criar narração",
    tabClipper: "Clipper",
    tabImageClip: "Áudio + imagens",
    tabYoutubeDownload: "Baixar YouTube",
    aiExampleKicker: "Modelo de criação",
    aiExampleKickerLatest: "Último vídeo com IA",
    aiExampleTitle: "Homem fazendo um graffiti em uma parede de tijolos",
    aiExampleDescription: "Use um prompt curto para gerar um clipe visual com IA.",
    aiExampleDescriptionLatest: "Este é o vídeo mais recente criado por prompt.",
    imageExampleKicker: "Modelo de imagem",
    imageExampleKickerLatest: "Última imagem criada",
    imageExampleTitle: "Crie imagens por prompt",
    imageExampleDescription: "Gere imagens para posts, capas, anúncios e ideias visuais.",
    imageExampleDescriptionLatest: "Esta é a imagem mais recente criada por prompt.",
    imageExamplePromptLabel: "Prompt usado",
    fullExampleKicker: "Modelo de vídeo completo",
    fullExampleKickerLatest: "Último vídeo completo",
    fullExampleTitle: "Roteiro curto com narração, mídia e legenda",
    fullExampleDescription: "Escolha mídias sugeridas e monte um vídeo de até 1 minuto.",
    fullExampleDescriptionLatest: "Vídeo completo mais recente salvo no histórico.",
    ttsExampleKicker: "Modelo de narração",
    ttsExampleKickerLatest: "Última narração",
    ttsExampleTitle: "Transforme texto em áudio para seus vídeos",
    ttsExampleDescription: "Digite a fala e gere uma narração pronta para usar.",
    ttsExampleDescriptionLatest: "Narração mais recente disponível para escuta.",
    libraryExampleKicker: "Vídeo disponível",
    libraryExampleKickerLatest: "Resultado encontrado",
    libraryExampleTitle: "mulher feia",
    libraryExampleDescription: "Vídeo sem áudio salvo na biblioteca para demonstrar a busca por termos.",
    libraryExampleDescriptionLatest: "Resultado recente da biblioteca Pexels.",
    openExample: "Abrir exemplo",
    openResult: "Abrir resultado",
    generateClip: "Gerar clipe",
    generateSelected: "Gerar com selecionados",
    creating: "Criando...",
    searchVideos: "Buscar vídeos",
    searching: "Buscando...",
    optionalImage: "Imagem opcional",
    aiSeedanceNote: "Ajuste duração, formato e qualidade antes de gerar.",
    aiQualityTitle: "Qualidade do clipe",
    aiQualityDescription: "Escolha o equilíbrio entre velocidade, custo e qualidade visual.",
    aiQualityFastTitle: "Mais rápido",
    aiQualityFastDescription: "Ideal para testar ideias com menor espera.",
    aiQualityEconomyTitle: "Mais econômico",
    aiQualityEconomyDescription: "Bom para criar várias versões e experimentar mais.",
    aiQualityBalancedTitle: "Padrão",
    aiQualityBalancedDescription: "Mantém o resultado atual, com boa estabilidade.",
    aiQualityQualityTitle: "Melhor qualidade",
    aiQualityQualityDescription: "Prioriza acabamento visual, com maior consumo.",
    aiDurationTitle: "Duração",
    aiDurationDescription: "Quanto maior o clipe, maior tende a ser o consumo.",
    aiDurationShortTitle: "Curto",
    aiDurationShortDescription: "4 segundos",
    aiDurationMediumTitle: "Médio",
    aiDurationMediumDescription: "8 segundos",
    aiDurationLongTitle: "Longo",
    aiDurationLongDescription: "12 segundos",
    aiRatioTitle: "Formato",
    aiRatioDescription: "Escolha onde o clipe será melhor publicado.",
    aiRatioPortraitTitle: "Retrato 9:16",
    aiRatioPortraitDescription: "Celular em pé",
    aiRatioSquareTitle: "Quadrado 1:1",
    aiRatioSquareDescription: "Feed e posts quadrados",
    aiRatioLandscapeTitle: "Paisagem 16:9",
    aiRatioLandscapeDescription: "Celular deitado",
    aiResolutionTitle: "Resolução",
    aiResolutionDescription: "Use baixa resolução para testar e alta para versão final.",
    aiResolutionEconomyTitle: "Econômica",
    aiResolutionEconomyDescription: "480p",
    aiResolutionStandardTitle: "Padrão",
    aiResolutionStandardDescription: "720p",
    aiResolutionHighTitle: "Alta",
    aiResolutionHighDescription: "1080p",
    imageQualityTitle: "Qualidade da imagem",
    imageQualityDescription: "Escolha entre testar ideias com menor custo ou gerar uma imagem final mais caprichada.",
    imageQualityEconomyTitle: "Econômica",
    imageQualityEconomyDescription: "Boa para testar ideias e criar várias versões.",
    imageQualityQualityTitle: "Alta qualidade",
    imageQualityQualityDescription: "Prioriza fidelidade, detalhes e texto melhor na imagem.",
    imageSizeTitle: "Tamanho",
    imageSizeDescription: "Tamanhos maiores tendem a consumir mais e demorar mais.",
    imageSizeSmallTitle: "Leve",
    imageSizeSmallDescription: "2K",
    imageSizeMediumTitle: "Padrão",
    imageSizeMediumDescription: "3K",
    imageSizeLargeTitle: "Grande",
    imageSizeLargeDescription: "4K",
    visualCreation: "Criação visual",
    aiFlow: "Prompt -> clipe curto",
  },
  en: {
    pageTitle: "Flixo",
    pageDescription:
      "Create AI clips, narrations, and editable cuts for your videos.",
    workspaceEyebrowAi: "AI creation",
    workspaceTitleAi: "Create short clips from a prompt.",
    workspaceDescriptionAi:
      "Describe a short scene and generate an AI video clip. Add an optional image when you want to guide the result.",
    workspaceEyebrowImage: "AI image",
    workspaceTitleImage: "Create images for posts, covers, and visual ideas.",
    workspaceDescriptionImage:
      "Type a prompt, choose quality, and generate a ready-to-use image.",
    workspaceEyebrowFull: "Full video",
    workspaceTitleFull: "Create videos up to 1 minute from a script.",
    workspaceDescriptionFull:
      "Write a topic, choose suggested media, and generate a short video with narration, captions, and visual polish.",
    workspaceEyebrowLibrary: "Library",
    workspaceTitleLibrary: "Search single videos by keyword.",
    workspaceDescriptionLibrary:
      "Search stock clips to quickly find visual references and media.",
    workspaceEyebrowTts: "Narration",
    workspaceTitleTts: "Turn text into narration.",
    workspaceDescriptionTts:
      "Type a short script and generate audio for your videos.",
    tabAi: "Create AI video",
    tabImage: "Create AI image",
    tabFull: "Full video",
    tabLibrary: "Search videos by keyword",
    tabTts: "Create narration",
    tabClipper: "Clipper",
    tabImageClip: "Audio + images",
    tabYoutubeDownload: "Download YouTube",
    aiExampleKicker: "Creation example",
    aiExampleKickerLatest: "Latest AI video",
    aiExampleTitle: "Man making graffiti on a brick wall",
    aiExampleDescription: "Use a short prompt to generate an AI visual clip.",
    aiExampleDescriptionLatest: "This is the latest video created from a prompt.",
    imageExampleKicker: "Image example",
    imageExampleKickerLatest: "Latest image",
    imageExampleTitle: "Create images from prompts",
    imageExampleDescription: "Generate images for posts, covers, ads, and visual ideas.",
    imageExampleDescriptionLatest: "This is the latest image created from a prompt.",
    imageExamplePromptLabel: "Prompt used",
    fullExampleKicker: "Full video example",
    fullExampleKickerLatest: "Latest full video",
    fullExampleTitle: "Short script with narration, media, and captions",
    fullExampleDescription: "Choose suggested media and create a video up to 1 minute.",
    fullExampleDescriptionLatest: "Latest full video saved in history.",
    ttsExampleKicker: "Narration example",
    ttsExampleKickerLatest: "Latest narration",
    ttsExampleTitle: "Turn text into audio for your videos",
    ttsExampleDescription: "Type the voiceover and generate narration ready to use.",
    ttsExampleDescriptionLatest: "Latest narration available to preview.",
    libraryExampleKicker: "Available video",
    libraryExampleKickerLatest: "Result found",
    libraryExampleTitle: "Expressive woman portrait",
    libraryExampleDescription: "Silent video saved in the library to demonstrate keyword search.",
    libraryExampleDescriptionLatest: "Recent result from the Pexels library.",
    openExample: "Open example",
    openResult: "Open result",
    generateClip: "Generate clip",
    generateSelected: "Generate selected",
    creating: "Creating...",
    searchVideos: "Search videos",
    searching: "Searching...",
    optionalImage: "Optional image",
    aiSeedanceNote: "Adjust duration, format, and quality before generating.",
    aiQualityTitle: "Clip quality",
    aiQualityDescription: "Choose the balance between speed, cost, and visual quality.",
    aiQualityFastTitle: "Fastest",
    aiQualityFastDescription: "Best for testing ideas with less waiting.",
    aiQualityEconomyTitle: "More economical",
    aiQualityEconomyDescription: "Good for creating multiple versions and experimenting more.",
    aiQualityBalancedTitle: "Standard",
    aiQualityBalancedDescription: "Keeps the current result with good stability.",
    aiQualityQualityTitle: "Best quality",
    aiQualityQualityDescription: "Prioritizes visual polish with higher usage.",
    aiDurationTitle: "Duration",
    aiDurationDescription: "Longer clips usually consume more.",
    aiDurationShortTitle: "Short",
    aiDurationShortDescription: "4 seconds",
    aiDurationMediumTitle: "Medium",
    aiDurationMediumDescription: "8 seconds",
    aiDurationLongTitle: "Long",
    aiDurationLongDescription: "12 seconds",
    aiRatioTitle: "Format",
    aiRatioDescription: "Choose where the clip will work best.",
    aiRatioPortraitTitle: "Portrait 9:16",
    aiRatioPortraitDescription: "Vertical phone",
    aiRatioSquareTitle: "Square 1:1",
    aiRatioSquareDescription: "Feed and square posts",
    aiRatioLandscapeTitle: "Landscape 16:9",
    aiRatioLandscapeDescription: "Horizontal phone",
    aiResolutionTitle: "Resolution",
    aiResolutionDescription: "Use low resolution for tests and high for final versions.",
    aiResolutionEconomyTitle: "Economy",
    aiResolutionEconomyDescription: "480p",
    aiResolutionStandardTitle: "Standard",
    aiResolutionStandardDescription: "720p",
    aiResolutionHighTitle: "High",
    aiResolutionHighDescription: "1080p",
    imageQualityTitle: "Image quality",
    imageQualityDescription: "Choose between testing ideas at lower cost or generating a more polished final image.",
    imageQualityEconomyTitle: "Economy",
    imageQualityEconomyDescription: "Good for testing ideas and creating multiple versions.",
    imageQualityQualityTitle: "High quality",
    imageQualityQualityDescription: "Prioritizes fidelity, details, and better text in the image.",
    imageSizeTitle: "Size",
    imageSizeDescription: "Larger sizes usually consume more and take longer.",
    imageSizeSmallTitle: "Light",
    imageSizeSmallDescription: "2K",
    imageSizeMediumTitle: "Standard",
    imageSizeMediumDescription: "3K",
    imageSizeLargeTitle: "Large",
    imageSizeLargeDescription: "4K",
    visualCreation: "Visual creation",
    aiFlow: "Prompt -> short clip",
  },
};

function $(selector) {
  return document.querySelector(selector);
}

function detectLocale() {
  const stored = localStorage.getItem("flixo:locale");
  if (stored === "pt-BR" || stored === "en") return stored;
  const locale = String(navigator.language || "").toLowerCase();
  return locale === "pt-br" ? "pt-BR" : "en";
}

function t(key) {
  const locale = state.locale || "pt-BR";
  return I18N[locale]?.[key] || I18N["pt-BR"][key] || key;
}

function applyI18n() {
  const locale = state.locale || detectLocale();
  document.documentElement.lang = locale;
  document.title = t("pageTitle");
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute("content", t("pageDescription"));
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.getAttribute("data-i18n-aria-label")));
  });
  updateWorkspaceIntro();
}

function updateWorkspaceIntro() {
  if (!els.workspaceEyebrow || !els.workspaceTitle || !els.workspaceDescription) return;
  const suffix = state.activeTab === "full"
    ? "Full"
    : state.activeTab === "image"
      ? "Image"
      : state.activeTab === "library"
      ? "Library"
      : state.activeTab === "tts"
        ? "Tts"
        : "Ai";
  els.workspaceEyebrow.textContent = t(`workspaceEyebrow${suffix}`);
  els.workspaceTitle.textContent = t(`workspaceTitle${suffix}`);
  els.workspaceDescription.textContent = t(`workspaceDescription${suffix}`);
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

function hasActiveCreationJob() {
  return state.jobs.some((job) => ACTIVE_CREATION_STATUSES.has(job.status));
}

function syncCreationButtonState() {
  const active = hasActiveCreationJob();
  if (els.submitButton) {
    els.submitButton.disabled = active;
    els.submitButton.textContent = active ? t("creating") : t("generateClip");
  }
  if (els.fullVideoButton) {
    const hasSelectedMedia = selectedFullMedia().length > 0;
    els.fullVideoButton.hidden = !hasSelectedMedia;
    els.fullVideoButton.disabled = active || !hasSelectedMedia;
    els.fullVideoButton.textContent = active ? t("creating") : t("generateSelected");
  }
}

function selectedAiVideoQualityPreset() {
  const selectedId =
    document.querySelector("input[name='seedance-quality']:checked")?.value ||
    DEFAULT_CLIP_SETTINGS.qualityPreset;
  return (
    AI_VIDEO_QUALITY_PRESETS.find((preset) => preset.id === selectedId) ||
    AI_VIDEO_QUALITY_PRESETS[0]
  );
}

function selectedAiImageQualityPreset() {
  const selectedId =
    document.querySelector("input[name='image-quality']:checked")?.value ||
    AI_IMAGE_QUALITY_PRESETS[0].id;
  return (
    AI_IMAGE_QUALITY_PRESETS.find((preset) => preset.id === selectedId) ||
    AI_IMAGE_QUALITY_PRESETS[0]
  );
}

function selectedAiOption(name, fallback) {
  return document.querySelector(`input[name='${name}']:checked`)?.value || fallback;
}

function renderAiOptionGroup({ titleKey, descriptionKey, name, options, defaultValue }) {
  return `
    <section class="creation-mode-panel ai-parameter-panel" aria-labelledby="${escapeHtml(name)}-title">
      <div class="creation-mode-head">
        <strong id="${escapeHtml(name)}-title">${escapeHtml(t(titleKey))}</strong>
        <span>${escapeHtml(t(descriptionKey))}</span>
      </div>
      <div class="creation-mode-options ai-parameter-options" role="radiogroup" aria-label="${escapeHtml(t(titleKey))}">
        ${options.map((option) => `
          <label class="creation-mode-card ai-parameter-card">
            <input
              type="radio"
              name="${escapeHtml(name)}"
              value="${escapeHtml(option.value)}"
              ${String(option.value) === String(defaultValue) ? "checked" : ""}
            />
            <span>
              <strong>${escapeHtml(t(option.labelKey))}</strong>
              <small>${escapeHtml(t(option.descriptionKey))}</small>
            </span>
          </label>
        `).join("")}
      </div>
    </section>
  `;
}

function renderAiVideoQualityOptions() {
  if (!els.seedanceQualityOptions) return;
  els.seedanceQualityOptions.innerHTML = `
    <section class="creation-mode-panel ai-quality-panel" aria-labelledby="ai-quality-title">
      <div class="creation-mode-head">
        <strong id="ai-quality-title">${escapeHtml(t("aiQualityTitle"))}</strong>
        <span>${escapeHtml(t("aiQualityDescription"))}</span>
      </div>
      <div class="creation-mode-options" role="radiogroup" aria-label="${escapeHtml(t("aiQualityTitle"))}">
        ${AI_VIDEO_QUALITY_PRESETS.map((preset) => `
          <label class="creation-mode-card">
            <input
              type="radio"
              name="seedance-quality"
              value="${escapeHtml(preset.id)}"
              ${preset.id === DEFAULT_CLIP_SETTINGS.qualityPreset ? "checked" : ""}
            />
            <span>
              <strong>${escapeHtml(t(preset.labelKey))}</strong>
              <small>${escapeHtml(t(preset.descriptionKey))}</small>
            </span>
          </label>
        `).join("")}
      </div>
    </section>
    ${renderAiOptionGroup({
      titleKey: "aiDurationTitle",
      descriptionKey: "aiDurationDescription",
      name: "seedance-duration",
      options: AI_VIDEO_DURATION_OPTIONS,
      defaultValue: DEFAULT_CLIP_SETTINGS.duration,
    })}
    ${renderAiOptionGroup({
      titleKey: "aiRatioTitle",
      descriptionKey: "aiRatioDescription",
      name: "seedance-ratio",
      options: AI_VIDEO_RATIO_OPTIONS,
      defaultValue: DEFAULT_CLIP_SETTINGS.ratio,
    })}
    ${renderAiOptionGroup({
      titleKey: "aiResolutionTitle",
      descriptionKey: "aiResolutionDescription",
      name: "seedance-resolution",
      options: AI_VIDEO_RESOLUTION_OPTIONS,
      defaultValue: DEFAULT_CLIP_SETTINGS.resolution,
    })}
  `;
}

function renderAiImageOptions() {
  if (!els.imageQualityOptions || !els.imageSizeOptions) return;
  els.imageQualityOptions.innerHTML = renderAiOptionGroup({
    titleKey: "imageQualityTitle",
    descriptionKey: "imageQualityDescription",
    name: "image-quality",
    options: AI_IMAGE_QUALITY_PRESETS,
    defaultValue: AI_IMAGE_QUALITY_PRESETS[0].id,
  });
  els.imageSizeOptions.innerHTML = renderAiOptionGroup({
    titleKey: "imageSizeTitle",
    descriptionKey: "imageSizeDescription",
    name: "image-size",
    options: AI_IMAGE_SIZE_OPTIONS,
    defaultValue: "2k",
  });
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

function voiceProfileById(id) {
  const profiles = Array.isArray(state.config?.voiceProfiles)
    ? state.config.voiceProfiles
    : [];
  return profiles.find((profile) => profile.id === id) || profiles[0] || null;
}

function voiceNameForProfile(id) {
  const profile = voiceProfileById(id);
  return profile?.voiceName ? `gemini:${profile.voiceName}-Auto` : "gemini:Kore-Auto";
}

function selectedFullSubtitleColor() {
  const selected = document.querySelector(
    `[data-full-subtitle-color-option="${FULL_SUBTITLE_PREVIEW_ID}"][data-selected="true"]`
  );
  return (
    FULL_SUBTITLE_COLOR_PRESETS.find(
      (preset) =>
        preset.text === selected?.dataset.subtitleTextColor &&
        preset.border === selected?.dataset.subtitleBorderColor
    ) || FULL_SUBTITLE_COLOR_PRESETS[0]
  );
}

function selectedFullSubtitleSize() {
  const selected = document.querySelector(
    `[data-full-subtitle-size-option="${FULL_SUBTITLE_PREVIEW_ID}"][data-selected="true"]`
  );
  return (
    FULL_SUBTITLE_SIZE_OPTIONS.find((option) => option.value === selected?.dataset.subtitleSize) ||
    FULL_SUBTITLE_SIZE_OPTIONS[1]
  );
}

function selectedFullSubtitleStyle() {
  const selected = document.querySelector(
    `[data-full-subtitle-style-option="${FULL_SUBTITLE_PREVIEW_ID}"][data-selected="true"]`
  );
  return (
    FULL_SUBTITLE_STYLE_OPTIONS.find((option) => option.value === selected?.dataset.subtitleStyle) ||
    FULL_SUBTITLE_STYLE_OPTIONS[0]
  );
}

function selectedFullSubtitlePosition() {
  const selected = document.querySelector(
    `[data-full-subtitle-position-option="${FULL_SUBTITLE_PREVIEW_ID}"][data-selected="true"]`
  );
  return (
    FULL_SUBTITLE_POSITION_OPTIONS.find((option) => option.value === selected?.dataset.subtitlePosition) ||
    FULL_SUBTITLE_POSITION_OPTIONS[2]
  );
}

function languageForPrompt(prompt) {
  const text = String(prompt || "").toLowerCase();
  const englishSignals = (
    text.match(/\b(i|you|the|and|with|how|what|why|when|where|who|want|know|babies|made|make|create|video|about|from|in|on|of|to|are|is)\b/g) || []
  ).length;
  const portugueseSignals = (
    text.match(/\b(eu|voce|você|o|a|os|as|e|com|como|que|quero|saber|sao|são|feitas|crianças|criancas|criar|video|vídeo|sobre|de|da|do|para)\b/g) || []
  ).length;
  if (englishSignals > portugueseSignals) return "en-US";
  if (portugueseSignals > englishSignals) return "pt-BR";
  return state.locale === "pt-BR" ? "pt-BR" : "en-US";
}

function syncFullSubtitleInputs() {
  if (!els.fullSubtitlePreview) return;
  const hasSelectedMedia = selectedFullMedia().length > 0;
  els.fullSubtitlePreview.hidden = !hasSelectedMedia;
  if (!hasSelectedMedia) return;

  const color = selectedFullSubtitleColor();
  const size = selectedFullSubtitleSize();
  const style = selectedFullSubtitleStyle();
  const position = selectedFullSubtitlePosition();

  els.fullSubtitlePreview.dataset.subtitleStyle = style.value;
  els.fullSubtitlePreview.dataset.subtitleSize = size.value;
  els.fullSubtitlePreview.dataset.subtitlePosition = position.value;
  for (const label of els.fullSubtitlePreview.querySelectorAll(".subtitle-color-frame strong")) {
    label.textContent = style.value === "word" ? "melhores" : "você cria vídeos melhores";
  }
  if (els.fullSubtitleTextColor) els.fullSubtitleTextColor.value = color.textHex;

  const enabled = !els.fullSubtitleEnabled || els.fullSubtitleEnabled.value !== "false";
  els.fullSubtitlePreview.dataset.subtitleEnabled = enabled ? "true" : "false";
  if (els.fullSubtitlePreviewOptions) {
    els.fullSubtitlePreviewOptions.hidden = !enabled;
  }
}

function selectFullSubtitleColor(textColor, borderColor) {
  document.querySelectorAll(`[data-full-subtitle-color-option="${FULL_SUBTITLE_PREVIEW_ID}"]`).forEach((button) => {
    const selected =
      button.dataset.subtitleTextColor === textColor &&
      button.dataset.subtitleBorderColor === borderColor;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  syncFullSubtitleInputs();
}

function selectFullSubtitleSize(size) {
  document.querySelectorAll(`[data-full-subtitle-size-option="${FULL_SUBTITLE_PREVIEW_ID}"]`).forEach((button) => {
    const selected = button.dataset.subtitleSize === size;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  syncFullSubtitleInputs();
}

function selectFullSubtitleStyle(style) {
  const normalized = style === "word" ? "word" : "standard";
  document.querySelectorAll(`[data-full-subtitle-style-option="${FULL_SUBTITLE_PREVIEW_ID}"]`).forEach((button) => {
    const selected = button.dataset.subtitleStyle === normalized;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  syncFullSubtitleInputs();
}

function selectFullSubtitlePosition(position) {
  document.querySelectorAll(`[data-full-subtitle-position-option="${FULL_SUBTITLE_PREVIEW_ID}"]`).forEach((button) => {
    const selected = button.dataset.subtitlePosition === position;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  syncFullSubtitleInputs();
}

function jobMediaCount(job) {
  const manifest = job?.assetManifest || {};
  if (Array.isArray(manifest.materials)) return manifest.materials.length;
  if (Array.isArray(job?.materials)) return job.materials.length;
  if (Array.isArray(job?.settings?.selectedMedia)) return job.settings.selectedMedia.length;
  if (manifest && typeof manifest === "object") {
    const keys = Object.keys(manifest).filter((key) => {
      const value = manifest[key];
      return value && key !== "combined_videos" && key !== "final_video";
    });
    if (keys.length) return keys.length;
  }
  return job?.videoUrl || job?.video_key ? 1 : 0;
}

function renderJobDetail(job) {
  if (!job) {
    els.jobMeta.textContent = "Nenhuma criação iniciada ainda.";
    els.jobDetail.className = "job-detail empty";
    els.jobDetail.innerHTML = `
      <div class="job-empty-state">
        <strong>Pronto para criar</strong>
        <span>Escolha uma aba, descreva o vídeo e gere sua primeira criação.</span>
      </div>
    `;
    return;
  }

  const isActive = ACTIVE_CREATION_STATUSES.has(job.status);
  els.jobMeta.textContent = isActive
    ? "Seu vídeo está sendo criado."
    : `Atualizado em ${formatDateTime(job.updatedAt || job.updated_at)}`;
  els.jobDetail.className = "job-detail";

  if (isActive) {
    els.jobDetail.innerHTML = `
      <div class="job-loader-card">
        <div class="job-loader-spinner" aria-hidden="true"></div>
        <div>
          <strong>Criando seu vídeo</strong>
          <span>Estamos preparando roteiro, mídia, narração e renderização. Você pode voltar quando terminar.</span>
        </div>
      </div>
    `;
    renderPipeline(job);
    return;
  }

  const videoUrl = job.videoUrl || job.video_url || "";
  const videoPreview = videoUrl
    ? `
      <a class="job-video-preview" href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer" aria-label="Abrir vídeo da última criação">
        <video src="${escapeHtml(videoUrl)}" muted playsinline preload="metadata"></video>
        <span>Abrir vídeo</span>
      </a>`
    : "";

  els.jobDetail.innerHTML = `
    <div class="job-card">
      <div class="job-card-head">
        <div class="job-card-title">${escapeHtml(job.prompt)}</div>
        <div class="${statusClass(job.status)}">${escapeHtml(statusLabel(job.status))}</div>
      </div>
      ${videoPreview}
      ${job.error ? `<p class="status-failed" style="margin:12px 0 0;">${escapeHtml(job.error)}</p>` : ""}
    </div>
  `;
  renderPipeline(job);
}

function renderHistory(jobs) {
  const historyJobs = jobs.filter((job) => job.status !== "failed");
  if (!historyJobs.length) {
    els.history.innerHTML = '<div class="empty-state">Nenhum vídeo criado ainda.</div>';
    return;
  }

  els.history.innerHTML = historyJobs
    .map(
      (job) => {
        const videoUrl = job.videoUrl || job.video_url || "";
        const isActive = ACTIVE_CREATION_STATUSES.has(job.status);
        const preview = videoUrl
          ? `<a class="history-video-preview" href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer" aria-label="Abrir vídeo">
              <video src="${escapeHtml(videoUrl)}" muted playsinline preload="metadata"></video>
            </a>`
          : `<div class="history-video-preview is-placeholder">
              <span>${isActive ? "Criando" : "Vídeo"}</span>
            </div>`;
        return `
      <article class="history-card">
        ${preview}
        <div class="history-card-head">
          <strong>${escapeHtml(job.prompt)}</strong>
          <span class="${statusClass(job.status)}">${escapeHtml(statusLabel(job.status))}</span>
        </div>
        <div>${isActive ? "Criação em andamento" : "Vídeo salvo no histórico"}</div>
        ${videoUrl ? `<a class="history-open-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer">Abrir vídeo</a>` : ""}
        ${job.error ? `<p class="history-error">${escapeHtml(job.error)}</p>` : ""}
        <small>${escapeHtml(formatDateTime(job.createdAt || job.created_at))}</small>
      </article>`;
      }
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
    els.mediaResultsMeta.textContent = "Busque vídeos por termo no Pexels.";
    els.mediaResults.innerHTML = '<div class="empty-state">Nenhum vídeo salvo ainda.</div>';
    renderWorkspaceExamples();
    return;
  }

  const isHistory = state.mediaResultsMode === "history";
  els.mediaResultsMeta.textContent = isHistory
    ? `${state.mediaResults.length} vídeo(s) salvo(s) na biblioteca.`
    : `${state.mediaResults.length} resultado(s) encontrado(s).`;
  els.mediaResults.innerHTML = state.mediaResults
    .map(
      (asset) => {
        const dimensions = asset.width && asset.height
          ? ` · ${escapeHtml(asset.width)}x${escapeHtml(asset.height)}`
          : "";
        const sourceLabel = isHistory
          ? "Salvo na biblioteca"
          : `Encontrado no ${asset.source === "pexels" ? "Pexels" : escapeHtml(asset.source)}`;
        return `
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
            <span>${escapeHtml(asset.duration)}s${dimensions}</span>
            <span>${sourceLabel}</span>
            <a class="secondary-button" href="${escapeHtml(asset.videoUrl)}" target="_blank" rel="noreferrer">Abrir vídeo</a>
          </div>
        </article>`;
      }
    )
    .join("");
  renderWorkspaceExamples();
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
  syncCreationButtonState();
  els.fullSelectionSummary.textContent = selected.length
    ? `${selected.length} mídia(s) selecionada(s). Roteiro sugerido: até ${maxNarrationSeconds}s, com cortes de até ${clipDuration}s.`
    : "Selecione os clipes/imagens que entrarão no vídeo antes de renderizar.";

  if (!state.fullVideoSuggestions.length) {
    syncCreationButtonState();
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

function renderTtsVoiceChoices() {
  if (!els.ttsVoiceGrid) return;
  const profiles = Array.isArray(state.config?.voiceProfiles)
    ? state.config.voiceProfiles
    : [];
  if (!profiles.length) {
    els.ttsVoiceGrid.innerHTML = '<div class="empty-state">Nenhuma voz disponível.</div>';
    return;
  }

  const selected = els.ttsVoice.value || profiles[0].id;
  els.ttsVoiceGrid.innerHTML = profiles
    .map(
      (profile) => `
        <article class="tts-voice-card ${profile.id === selected ? "is-selected" : ""}" data-voice-card="${escapeHtml(profile.id)}">
          <div>
            <strong>${escapeHtml(profile.label)}</strong>
            <span>${escapeHtml(profile.style || "Narração")}</span>
          </div>
          <p>${escapeHtml(profile.sample || "Ouça um exemplo desta voz.")}</p>
          <div class="tts-voice-actions">
            <button type="button" class="secondary-button" data-preview-voice="${escapeHtml(profile.id)}">Ouvir exemplo</button>
            <audio preload="none"></audio>
          </div>
        </article>`
    )
    .join("");

  document.querySelectorAll("[data-voice-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("[data-preview-voice]")) return;
      const id = card.getAttribute("data-voice-card");
      if (!id) return;
      els.ttsVoice.value = id;
      renderTtsVoiceChoices();
    });
  });

  document.querySelectorAll("[data-preview-voice]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await previewTtsVoice(button);
    });
  });
}

async function previewTtsVoice(button) {
  const voiceProfile = button.getAttribute("data-preview-voice");
  const profile = voiceProfileById(voiceProfile);
  if (!profile) return;

  const card = button.closest(".tts-voice-card");
  const audio = card?.querySelector("audio");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Gerando...";
  try {
    const payload = await fetchJson("/api/audio/tts", {
      method: "POST",
      body: JSON.stringify({
        text: profile.sample || "Este é um exemplo de voz para sua narração.",
        voiceProfile,
        preview: true,
      }),
    });
    if (audio && payload.audio?.audioUrl) {
      audio.src = payload.audio.audioUrl;
      audio.controls = true;
      await audio.play().catch(() => null);
    }
  } catch (error) {
    button.textContent = "Falhou";
    setTimeout(() => {
      button.textContent = originalText || "Ouvir exemplo";
    }, 1800);
    return;
  } finally {
    button.disabled = false;
  }
  button.textContent = originalText || "Ouvir exemplo";
}

function renderAudioResults() {
  if (!state.audioResults.length) {
    els.audioResultsMeta.textContent = "Crie uma narração para enviar à timeline.";
    els.audioResults.innerHTML = '<div class="empty-state">Nenhum áudio gerado ainda.</div>';
    renderWorkspaceExamples();
    return;
  }

  els.audioResultsMeta.textContent = `${state.audioResults.length} áudios disponíveis`;
  els.audioResults.innerHTML = state.audioResults
    .map(
      (audio, index) => `
        <article class="audio-card">
          <div class="audio-thumb">Áudio</div>
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
  renderWorkspaceExamples();
}

function renderImageResults() {
  if (!els.imageResults || !els.imageResultsMeta) return;
  if (!state.imageResults.length) {
    els.imageResultsMeta.textContent = "As últimas imagens geradas aparecem aqui.";
    els.imageResults.innerHTML = '<div class="empty-state">Nenhuma imagem criada ainda.</div>';
    renderWorkspaceExamples();
    return;
  }

  els.imageResultsMeta.textContent = `${state.imageResults.length} imagens disponíveis`;
  els.imageResults.innerHTML = state.imageResults
    .map(
      (image) => `
        <article class="media-card image-result-card">
          <div class="media-thumb image-result-thumb">
            <img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(image.title)}" loading="lazy" />
          </div>
          <div class="media-card-copy">
            <strong>${escapeHtml(image.title)}</strong>
            <span>${escapeHtml(image.source)} · ${escapeHtml(image.metadata?.size || "imagem")}</span>
            <a class="secondary-button" href="${escapeHtml(image.imageUrl)}" target="_blank" rel="noreferrer">Abrir imagem</a>
          </div>
        </article>`
    )
    .join("");
  renderWorkspaceExamples();
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
    materials: job.materials || job.asset_manifest?.materials || job.assetManifest?.materials || [],
    videoUrl: job.video_url || job.videoUrl || "",
    script: job.script || "",
    error: job.error || "",
  };
}

function latestJobBy(predicate) {
  return state.jobs.find((job) => predicate(job));
}

function preferredFullVideoJob() {
  const preferredPrompt = state.locale === "pt-BR"
    ? "Quero saber como são feitas as crianças."
    : "I want to know how babies are made.";
  return latestJobBy(
    (job) =>
      job.videoUrl &&
      job.settings?.provider === "moneyprinterturbo" &&
      job.prompt === preferredPrompt
  );
}

function libraryDemoAsset() {
  return {
    id: "library-demo-pexels-29131103",
    title: t("libraryExampleTitle"),
    duration: 25,
    width: 540,
    height: 960,
    source: "pexels",
    videoUrl: "/api/assets?key=pexels%2Fmulher-feia-29131103-12584459.mp4",
  };
}

function isPreferredLibraryDemo(asset) {
  const key = `${asset?.assetKey || ""} ${asset?.videoUrl || ""}`;
  return key.includes("mulher-feia-29131103-12584459.mp4");
}

function mediaPreviewMarkup(url, label = "Preview") {
  if (!url) return "";
  return `
    <video
      src="${escapeHtml(url)}"
      muted
      playsinline
      preload="metadata"
      controls
      aria-label="${escapeHtml(label)}"
    ></video>
  `;
}

function audioPreviewMarkup(url, label = "Ouvir exemplo") {
  if (!url) return "";
  return `<audio src="${escapeHtml(url)}" controls preload="metadata" aria-label="${escapeHtml(label)}"></audio>`;
}

function imagePreviewMarkup(url, label = "Imagem criada com IA") {
  if (!url) return "";
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" />`;
}

function renderExampleCard(element, options) {
  if (!element) return;
  const previewClass = options.previewClass || "";
  const preview = options.preview || `<span>${escapeHtml(options.previewLabel || "Exemplo")}</span>`;
  element.innerHTML = `
    <div class="tab-example-preview ${escapeHtml(previewClass)}" aria-hidden="${options.preview ? "false" : "true"}">
      ${preview}
    </div>
    <div class="tab-example-copy">
      <span class="tab-example-kicker">${escapeHtml(options.kicker)}</span>
      <strong>${escapeHtml(options.title)}</strong>
      <p>${escapeHtml(options.description)}</p>
      ${Array.isArray(options.meta) && options.meta.length ? `<div class="tab-example-meta">${options.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      ${options.promptText ? `<div class="tab-example-prompt"><span>${escapeHtml(options.promptLabel || "Prompt")}</span><p>${escapeHtml(options.promptText)}</p></div>` : ""}
      ${options.actionUrl ? `<a href="${escapeHtml(options.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(options.actionLabel || t("openExample"))}</a>` : ""}
    </div>
  `;
}

function renderWorkspaceExamples() {
  const aiJob =
    latestJobBy((job) => job.videoUrl && job.settings?.provider === "byteplus") ||
    latestJobBy((job) => job.videoUrl);
  renderExampleCard(els.aiExampleCard, {
    kicker: aiJob ? t("aiExampleKickerLatest") : t("aiExampleKicker"),
    title: aiJob?.prompt || t("aiExampleTitle"),
    description: aiJob
      ? t("aiExampleDescriptionLatest")
      : t("aiExampleDescription"),
    previewClass: "tab-example-preview-ai",
    preview: mediaPreviewMarkup(aiJob?.videoUrl, "Último vídeo criado com IA"),
    previewLabel: "IA",
    actionUrl: aiJob?.videoUrl,
  });

  const image = state.imageResults[0];
  renderExampleCard(els.imageExampleCard, {
    kicker: image ? t("imageExampleKickerLatest") : t("imageExampleKicker"),
    title: image?.title || t("imageExampleTitle"),
    description: image
      ? t("imageExampleDescriptionLatest")
      : t("imageExampleDescription"),
    previewClass: "tab-example-preview-image",
    preview: imagePreviewMarkup(
      image?.imageUrl || STATIC_AI_IMAGE_EXAMPLE_URL,
      image ? "Última imagem criada com IA" : "Exemplo de imagem com IA"
    ),
    previewLabel: "IMG",
    actionUrl: image?.imageUrl || STATIC_AI_IMAGE_EXAMPLE_URL,
    actionLabel: t("openResult"),
    meta: image ? [] : STATIC_AI_IMAGE_EXAMPLE_META,
    promptLabel: t("imageExamplePromptLabel"),
    promptText: image ? "" : STATIC_AI_IMAGE_EXAMPLE_PROMPT,
  });

  const fullJob = preferredFullVideoJob() || latestJobBy(
    (job) => job.videoUrl && job.settings?.provider === "moneyprinterturbo"
  );
  renderExampleCard(els.fullExampleCard, {
    kicker: fullJob ? t("fullExampleKickerLatest") : t("fullExampleKicker"),
    title: fullJob?.prompt || t("fullExampleTitle"),
    description: fullJob
      ? t("fullExampleDescriptionLatest")
      : t("fullExampleDescription"),
    previewClass: "tab-example-preview-full",
    preview: mediaPreviewMarkup(fullJob?.videoUrl, "Último vídeo completo"),
    previewLabel: "MP4",
    actionUrl: fullJob?.videoUrl,
  });

  const audio = state.audioResults[0];
  renderExampleCard(els.ttsExampleCard, {
    kicker: audio ? t("ttsExampleKickerLatest") : t("ttsExampleKicker"),
    title: audio?.title || t("ttsExampleTitle"),
    description: audio
      ? t("ttsExampleDescriptionLatest")
      : t("ttsExampleDescription"),
    previewClass: "tab-example-preview-tts",
    preview: audioPreviewMarkup(audio?.audioUrl, "Última narração gerada"),
    previewLabel: "Voz",
    actionUrl: audio?.audioUrl,
  });

  const preferredMedia = state.mediaResults.find(isPreferredLibraryDemo);
  const hasMediaResult = Boolean(preferredMedia || state.mediaResults.length > 0);
  const media = preferredMedia || state.mediaResults[0] || libraryDemoAsset();
  renderExampleCard(els.libraryExampleCard, {
    kicker: hasMediaResult ? t("libraryExampleKickerLatest") : t("libraryExampleKicker"),
    title: media.title,
    description: hasMediaResult
      ? t("libraryExampleDescriptionLatest")
      : t("libraryExampleDescription"),
    previewClass: "tab-example-preview-library",
    preview: mediaPreviewMarkup(media.videoUrl, "Vídeo da biblioteca"),
    previewLabel: "Pexels",
    actionUrl: media.videoUrl,
    actionLabel: t("openResult"),
  });
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
    renderTtsVoiceChoices();
  }
  renderInfra(state.config);
  renderPipeline(state.jobs[0] || null);
  renderTimeline(state.jobs);
}

async function loadJobs() {
  try {
    const payload = await fetchJson("/api/jobs?limit=50");
    state.jobs = Array.isArray(payload.jobs)
      ? payload.jobs.map(normalizeJob)
      : [];
    const activeJob = state.activeJobId
      ? state.jobs.find((job) => job.id === state.activeJobId)
      : state.jobs.find((job) => ACTIVE_CREATION_STATUSES.has(job.status)) || state.jobs[0];
    if (activeJob && ACTIVE_CREATION_STATUSES.has(activeJob.status)) {
      state.activeJobId = activeJob.id;
      await refreshJob(activeJob.id);
      scheduleRefresh(activeJob.id);
      return;
    }
    renderHistory(state.jobs);
    renderTimeline(state.jobs);
    syncCreationButtonState();
    renderJobDetail(activeJob || null);
    renderWorkspaceExamples();
  } catch (error) {
    els.history.innerHTML =
      '<div class="empty-state">Não foi possível carregar o histórico.</div>';
    renderWorkspaceExamples();
    console.warn(error);
  }
}

async function refreshJob(jobId) {
  const payload = await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}?refresh=1`);
  const job = normalizeJob(payload.job);
  state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)];
  if (job.status === "done" || job.status === "failed") {
    state.activeJobId = null;
  } else {
    state.activeJobId = job.id;
  }
  renderJobDetail(job);
  renderHistory(state.jobs);
  renderTimeline(state.jobs);
  syncCreationButtonState();
  renderWorkspaceExamples();
  return job;
}

function normalizeMediaAsset(asset) {
  if (!asset) return null;
  const metadata = asset.metadata || {};
  return {
    id: asset.id,
    title: asset.title || asset.prompt || "Asset",
    duration: asset.type === "image" ? null : Number(asset.duration || 4),
    videoUrl: asset.videoUrl || (asset.type === "video" ? asset.url : ""),
    audioUrl: asset.audioUrl || (asset.type === "audio" ? asset.url : ""),
    imageUrl: asset.imageUrl || (asset.type === "image" ? asset.url : ""),
    source: asset.provider === "byteplus" ? "IA" : asset.provider || "asset",
    type: asset.type,
    width: asset.width || metadata.width || "",
    height: asset.height || metadata.height || "",
    thumbnailUrl: asset.thumbnailUrl || metadata.thumbnail_url || metadata.thumbnailUrl || "",
    metadata,
    createdAt: asset.createdAt,
  };
}

async function loadMediaAssets() {
  try {
    const payload = await fetchJson("/api/media/assets?type=video&limit=12");
    state.mediaResultsMode = "history";
    state.mediaResults = Array.isArray(payload.assets)
      ? payload.assets.map(normalizeMediaAsset).filter((asset) => asset?.videoUrl)
      : [];
    renderMediaResults();
  } catch (error) {
    console.warn(error);
    renderMediaResults();
  }
}

async function loadImageAssets() {
  if (!els.imageResults) return;
  try {
    const payload = await fetchJson("/api/media/assets?type=image&limit=12");
    state.imageResults = Array.isArray(payload.assets)
      ? payload.assets.map(normalizeMediaAsset).filter((asset) => asset?.imageUrl)
      : [];
    renderImageResults();
  } catch (error) {
    console.warn(error);
    renderImageResults();
  }
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
      const job = await refreshJob(jobId);
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
      ? buildFullVideoSettings(prompt)
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
    renderHistory(state.jobs);
    renderTimeline(state.jobs);
    syncCreationButtonState();
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
    syncCreationButtonState();
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
  const preset = selectedAiVideoQualityPreset();
  const settings = {
    ...DEFAULT_CLIP_SETTINGS,
    model: preset.model,
    qualityPreset: preset.id,
    duration: Number(selectedAiOption("seedance-duration", DEFAULT_CLIP_SETTINGS.duration)),
    ratio: selectedAiOption("seedance-ratio", DEFAULT_CLIP_SETTINGS.ratio),
    resolution: selectedAiOption("seedance-resolution", preset.resolution || DEFAULT_CLIP_SETTINGS.resolution),
  };

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

async function buildImageGenerationSettings() {
  const preset = selectedAiImageQualityPreset();
  const settings = {
    provider: "byteplus",
    model: preset.model,
    qualityPreset: preset.id,
    size: selectedAiOption("image-size", "2k"),
    outputFormat: "jpeg",
  };

  const image = els.imageReference?.files?.[0] || null;
  if (!image) return settings;
  if (!image.type.startsWith("image/")) {
    showInlineError("Imagem inválida", "Envie uma imagem PNG, JPG ou WebP.");
    return null;
  }
  if (image.size > MAX_SEEDANCE_IMAGE_BYTES) {
    showInlineError(
      "Imagem muito grande",
      "Use uma imagem de até 8 MB para este primeiro MVP."
    );
    return null;
  }

  settings.imageDataUrl = await readFileAsDataUrl(image);
  return settings;
}

async function createAiImage() {
  const prompt = els.imagePrompt.value.trim();
  if (!prompt) return;

  const settings = await buildImageGenerationSettings();
  if (!settings) return;

  els.imageButton.disabled = true;
  els.imageButton.textContent = "Gerando...";
  els.imageResultsMeta.textContent = "Gerando imagem com IA.";
  try {
    const payload = await fetchJson("/api/images/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, settings }),
    });
    const image = normalizeMediaAsset({
      ...payload.image,
      type: "image",
      url: payload.image?.imageUrl || payload.image?.url,
    });
    if (image) {
      state.imageResults = [image, ...state.imageResults.filter((item) => item.id !== image.id)];
    }
    renderImageResults();
  } catch (error) {
    els.imageResultsMeta.textContent = "Falha ao gerar imagem.";
    els.imageResults.innerHTML = `
      <div class="job-card">
        <div class="job-card-head">
          <strong>Não foi possível gerar a imagem</strong>
          <span class="status-failed">Erro</span>
        </div>
        <div>${escapeHtml(error instanceof Error ? error.message : String(error))}</div>
      </div>
    `;
  } finally {
    els.imageButton.disabled = false;
    els.imageButton.textContent = "Gerar imagem";
  }
}

function buildFullVideoSettings(prompt = "") {
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
  const subtitleColor = selectedFullSubtitleColor();
  const subtitleSize = selectedFullSubtitleSize();
  const subtitleStyle = selectedFullSubtitleStyle();
  const subtitlePosition = selectedFullSubtitlePosition();
  return {
    ...DEFAULT_FULL_VIDEO_SETTINGS,
    voiceProfile: els.fullVideoVoice.value,
    voice: voiceNameForProfile(els.fullVideoVoice.value),
    language: languageForPrompt(prompt || els.fullVideoPrompt.value),
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
    subtitleStyle: subtitleStyle.value,
    subtitlePosition: subtitlePosition.backendValue,
    subtitleFontSize: Number(subtitleSize.fontSize || 60),
    subtitleTextColor: subtitleColor.textHex,
    subtitleStrokeWidth: 2,
    subtitleStrokeColor: subtitleColor.borderHex,
  };
}

function setActiveTab(tab) {
  state.activeTab = "ai";
  document.querySelectorAll(".workspace-tab").forEach((button) => {
    const isActive = button.getAttribute("data-tab") === state.activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  els.form.hidden = state.activeTab !== "ai";
  if (els.imageForm) {
    els.imageForm.hidden = state.activeTab !== "image";
  }
  if (els.fullVideoForm) {
    els.fullVideoForm.hidden = true;
    els.fullVideoForm.setAttribute("aria-hidden", "true");
  }
  if (els.mediaSearchForm) {
    els.mediaSearchForm.hidden = true;
    els.mediaSearchForm.setAttribute("aria-hidden", "true");
  }
  els.ttsForm.hidden = state.activeTab !== "tts";
  if (els.timelinePanel) {
    els.timelinePanel.hidden = true;
  }
  if (els.mediaPanel) {
    els.mediaPanel.hidden = true;
  }
  if (els.audioPanel) {
    els.audioPanel.hidden = state.activeTab !== "tts";
  }
  if (els.quickPrompts) {
    els.quickPrompts.hidden = true;
  }
  updateWorkspaceIntro();
  renderWorkspaceExamples();
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
  els.mediaSearchButton.textContent = t("searching");
  els.mediaResultsMeta.textContent = "Buscando clipes para sua biblioteca.";
  try {
    const payload = await fetchJson("/api/media/search", {
      method: "POST",
      body: JSON.stringify({
        provider: "pexels",
        query,
        limit: 6,
        persist: true,
      }),
    });
    state.mediaResultsMode = "search";
    state.mediaResults = Array.isArray(payload.assets)
      ? payload.assets.map(normalizeMediaAsset).filter((asset) => asset?.videoUrl)
      : [];
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
    els.mediaSearchButton.textContent = t("searchVideos");
  }
}

function bindEvents() {
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = els.prompt.value.trim();
    if (!prompt) return;
    await submitPrompt(prompt, "ai");
  });

  if (els.imageForm) {
    els.imageForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await createAiImage();
    });
  }

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

  els.fullSubtitleEnabled.addEventListener("change", () => {
    syncFullSubtitleInputs();
  });

  document.querySelectorAll("[data-full-subtitle-color-option]").forEach((button) => {
    button.addEventListener("click", () => {
      selectFullSubtitleColor(button.dataset.subtitleTextColor, button.dataset.subtitleBorderColor);
    });
  });

  document.querySelectorAll("[data-full-subtitle-size-option]").forEach((button) => {
    button.addEventListener("click", () => {
      selectFullSubtitleSize(button.dataset.subtitleSize);
    });
  });

  document.querySelectorAll("[data-full-subtitle-style-option]").forEach((button) => {
    button.addEventListener("click", () => {
      selectFullSubtitleStyle(button.dataset.subtitleStyle);
    });
  });

  document.querySelectorAll("[data-full-subtitle-position-option]").forEach((button) => {
    button.addEventListener("click", () => {
      selectFullSubtitlePosition(button.dataset.subtitlePosition);
    });
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      const search = chip.getAttribute("data-search");
      if (search) {
        setActiveTab("library");
        els.mediaQuery.value = search;
        els.mediaQuery.focus();
        await searchMedia();
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

  els.ttsVoice.addEventListener("change", () => {
    renderTtsVoiceChoices();
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
  if (
    location.pathname === "/" ||
    location.pathname.endsWith("/index.html") ||
    location.pathname.endsWith("/studio.html")
  ) {
    location.replace("/clipper.html");
    return;
  }
  state.locale = detectLocale();
  els.form = $("#prompt-form");
  els.imageForm = $("#image-form");
  els.fullVideoForm = $("#full-video-form");
  els.mediaSearchForm = $("#media-search-form");
  els.ttsForm = $("#tts-form");
  els.prompt = $("#prompt");
  els.imagePrompt = $("#image-prompt");
  els.imageReference = $("#image-reference");
  els.imageQualityOptions = $("#image-quality-options");
  els.imageSizeOptions = $("#image-size-options");
  els.imageButton = $("#image-button");
  els.imageResults = $("#image-results");
  els.imageResultsMeta = $("#image-results-meta");
  els.imageExampleCard = $("#image-example-card");
  els.fullVideoPrompt = $("#full-video-prompt");
  els.fullVideoVoice = $("#full-video-voice");
  els.fullMediaMode = $("#full-media-mode");
  els.fullMediaStyle = $("#full-media-style");
  els.fullVideoAspect = $("#full-video-aspect");
  els.fullSubtitleEnabled = $("#full-subtitle-enabled");
  els.fullSubtitlePreview = $("#full-subtitle-preview");
  els.fullSubtitlePreviewOptions = $("#full-subtitle-preview-options");
  els.fullSubtitleTextColor = $("#full-subtitle-text-color");
  els.fullSuggestButton = $("#full-suggest-button");
  els.fullSelectionSummary = $("#full-selection-summary");
  els.fullSuggestions = $("#full-suggestions");
  els.fullVideoButton = $("#full-video-button");
  els.ttsText = $("#tts-text");
  els.ttsVoice = $("#tts-voice");
  els.ttsVoiceGrid = $("#tts-voice-grid");
  els.seedanceQualityOptions = $("#seedance-quality-options");
  els.aiExampleCard = $("#ai-example-card");
  els.fullExampleCard = $("#full-example-card");
  els.ttsExampleCard = $("#tts-example-card");
  els.libraryExampleCard = $("#library-example-card");
  els.ttsButton = $("#tts-button");
  els.seedanceSettings = $("#seedance-settings");
  els.seedanceImage = $("#seedance-image");
  els.submitButton = $("#submit-button");
  els.mediaQuery = $("#media-query");
  els.mediaSearchButton = $("#media-search-button");
  els.pipeline = $("#pipeline");
  els.infraGrid = $("#infra-grid");
  els.infraPill = $("#infra-pill");
  els.jobMeta = $("#job-meta");
  els.jobDetail = $("#job-detail");
  els.timelineMeta = $("#timeline-meta");
  els.timelinePanel = $(".panel-timeline");
  els.mediaPanel = $(".panel-media");
  els.audioPanel = $(".panel-audio");
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
  els.quickPrompts = $(".quick-prompts");
  els.workspaceEyebrow = $("[data-workspace-eyebrow]");
  els.workspaceTitle = $("[data-workspace-title]");
  els.workspaceDescription = $("[data-workspace-description]");

  applyI18n();
  renderAiVideoQualityOptions();
  renderAiImageOptions();
  bindEvents();
  await loadConfig();
  await loadJobs();
  await loadImageAssets();
  await loadAudioAssets();

  const lastPrompt = localStorage.getItem("mpt:last-prompt");
  if (lastPrompt && !els.prompt.value.trim()) {
    els.prompt.value = lastPrompt;
  }
  const lastFullPrompt = localStorage.getItem("mpt:last-full-prompt");
  if (lastFullPrompt && !els.fullVideoPrompt.value.trim()) {
    els.fullVideoPrompt.value = lastFullPrompt;
  }
  const lastImagePrompt = localStorage.getItem("mpt:last-image-prompt");
  if (lastImagePrompt && els.imagePrompt && !els.imagePrompt.value.trim()) {
    els.imagePrompt.value = lastImagePrompt;
  }
  syncFullSubtitleInputs();
  const urlTab = new URLSearchParams(window.location.search).get("tab");
  setActiveTab(urlTab || localStorage.getItem("mpt:active-tab") || "ai");
  renderFullVideoSuggestions();
  renderImageResults();
  renderAudioResults();
  els.prompt.addEventListener("input", () => {
    localStorage.setItem("mpt:last-prompt", els.prompt.value);
  });
  els.fullVideoPrompt.addEventListener("input", () => {
    localStorage.setItem("mpt:last-full-prompt", els.fullVideoPrompt.value);
  });
  if (els.imagePrompt) {
    els.imagePrompt.addEventListener("input", () => {
      localStorage.setItem("mpt:last-image-prompt", els.imagePrompt.value);
    });
  }
}

init().catch((error) => {
  console.error(error);
});
