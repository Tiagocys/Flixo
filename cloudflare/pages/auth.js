const FLIXO_AUTH_KEY = "flixo.auth.session";
const PUBLIC_PATHS = new Set(["/login", "/login.html", "/auth/callback", "/auth/callback.html"]);

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

const originalFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || "";
  const isApi = url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
  if (!isApi) return originalFetch(input, init);

  const headers = new Headers(init.headers || {});
  const token = readSession()?.access_token;
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return originalFetch(input, { ...init, headers });
};

async function currentUser() {
  const response = await originalFetch("/api/auth/me", {
    headers: authHeader(),
  });
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
  const session = readSession();
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
  user: null,
};

requireSession().catch(() => {
  if (!isPublicPath()) redirectToLogin();
});
