const message = document.getElementById("auth-callback-message");

function nextUrl() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function setMessage(text) {
  if (message) message.textContent = text;
}

function sessionFromHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Number(params.get("expires_in") || 0),
    expires_at: Math.floor(Date.now() / 1000) + Number(params.get("expires_in") || 0),
    token_type: params.get("token_type") || "bearer",
    provider_token: params.get("provider_token") || undefined,
  };
}

async function finishOAuth() {
  const error = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("error_description");
  if (error) {
    setMessage(error);
    return;
  }

  const session = sessionFromHash();
  if (!session) {
    setMessage("Nao foi possivel concluir o login. Tente novamente.");
    return;
  }

  window.FlixoAuth.writeSession(session);
  const user = await window.FlixoAuth.currentUser();
  if (!user) {
    window.FlixoAuth.clearSession();
    setMessage("Sessao recebida, mas o Supabase nao confirmou o usuario.");
    return;
  }

  setMessage("Login concluido. Redirecionando...");
  window.location.replace(nextUrl());
}

finishOAuth().catch((error) => {
  setMessage(error instanceof Error ? error.message : "Falha ao finalizar login.");
});
