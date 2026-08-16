const FLIXO_AUTH_KEY = "flixo.auth.session";
const PUBLIC_PATHS = new Set(["/login", "/login.html", "/auth/callback", "/auth/callback.html"]);
const AUTH_REFRESH_MARGIN_SECONDS = 60;
let refreshPromise = null;

function authPathname() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function isPublicPath() {
  return PUBLIC_PATHS.has(authPathname());
}

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(FLIXO_AUTH_KEY) || "null");
    if (!session?.access_token) return null;
    return session;
  } catch {
    return null;
  }
}

function writeSession(session) {
  localStorage.setItem(FLIXO_AUTH_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(FLIXO_AUTH_KEY);
}

function authHeader() {
  const token = readSession()?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sessionExpiresSoon(session) {
  const expiresAt = Number(session?.expires_at || 0);
  if (!expiresAt) return false;
  return expiresAt <= Math.floor(Date.now() / 1000) + AUTH_REFRESH_MARGIN_SECONDS;
}

function mergeSession(currentSession, refreshedSession) {
  const expiresIn = Number(refreshedSession?.expires_in || 0);
  return {
    ...currentSession,
    ...refreshedSession,
    refresh_token: refreshedSession?.refresh_token || currentSession?.refresh_token,
    expires_at:
      Number(refreshedSession?.expires_at || 0) ||
      (expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : currentSession?.expires_at),
  };
}

async function refreshSession() {
  const session = readSession();
  if (!session?.refresh_token) return null;
  if (!refreshPromise) {
    refreshPromise = originalFetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const refreshed = await response.json().catch(() => null);
        if (!refreshed?.access_token) return null;
        const nextSession = mergeSession(session, refreshed);
        writeSession(nextSession);
        return nextSession;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function ensureFreshSession() {
  const session = readSession();
  if (!session) return null;
  if (!sessionExpiresSoon(session)) return session;
  return (await refreshSession()) || session;
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || "";
  const isApi = url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
  if (!isApi) return originalFetch(input, init);

  const headers = new Headers(init.headers || {});
  const session = await ensureFreshSession();
  const token = session?.access_token;
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await originalFetch(input, { ...init, headers });
  const isAuthEndpoint = url.includes("/api/auth/");
  if (response.status !== 401 || isAuthEndpoint) {
    return response;
  }

  if (!readSession()?.refresh_token) {
    clearSession();
    if (!isPublicPath()) redirectToLogin();
    return response;
  }

  const refreshedSession = await refreshSession();
  if (!refreshedSession?.access_token) {
    clearSession();
    if (!isPublicPath()) redirectToLogin();
    return response;
  }

  const retryHeaders = new Headers(init.headers || {});
  retryHeaders.set("Authorization", `Bearer ${refreshedSession.access_token}`);
  return originalFetch(input, { ...init, headers: retryHeaders });
};

async function currentUser() {
  await ensureFreshSession();
  const response = await originalFetch("/api/auth/me", {
    headers: authHeader(),
  });
  if (response.status === 401 && readSession()?.refresh_token) {
    const refreshedSession = await refreshSession();
    if (refreshedSession?.access_token) {
      const retryResponse = await originalFetch("/api/auth/me", {
        headers: authHeader(),
      });
      if (retryResponse.ok) {
        const payload = await retryResponse.json().catch(() => ({}));
        return payload?.user || null;
      }
    }
  }
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload?.user || null;
}

function redirectToLogin() {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/login.html?next=${encodeURIComponent(next)}`;
}

function renderAccountBar(user) {
  if (document.querySelector(".auth-bar")) return;
  const bar = document.createElement("div");
  bar.className = "auth-bar";
  bar.innerHTML = `
    <span>Conta: <strong>${escapeHtml(user?.email || "usuario")}</strong></span>
    <button type="button" class="auth-logout-button">Sair</button>
  `;
  document.body.prepend(bar);
  bar.querySelector("button")?.addEventListener("click", async () => {
    await originalFetch("/api/auth/logout", {
      method: "POST",
      headers: authHeader(),
    }).catch(() => null);
    clearSession();
    redirectToLogin();
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function requireSession() {
  if (isPublicPath()) return;
  const session = await ensureFreshSession();
  if (!session) {
    redirectToLogin();
    return;
  }
  const user = await currentUser();
  if (!user) {
    clearSession();
    redirectToLogin();
    return;
  }
  window.FlixoAuth.user = user;
  renderAccountBar(user);
}

window.FlixoAuth = {
  storageKey: FLIXO_AUTH_KEY,
  readSession,
  writeSession,
  clearSession,
  currentUser,
  authHeader,
  refreshSession,
  user: null,
};

requireSession().catch(() => {
  if (!isPublicPath()) redirectToLogin();
});
