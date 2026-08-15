const button = document.getElementById("google-login-button");
const message = document.getElementById("auth-message");

function nextUrl() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function setMessage(text) {
  if (!message) return;
  message.hidden = false;
  message.textContent = text;
}

async function redirectToGoogle() {
  if (!button) return;
  button.disabled = true;
  button.textContent = "Redirecionando...";
  window.location.href = `/api/auth/google/start?next=${encodeURIComponent(nextUrl())}`;
}

button?.addEventListener("click", () => {
  redirectToGoogle().catch((error) => {
    button.disabled = false;
    button.innerHTML = '<span class="google-mark">G</span> Entrar com Google';
    setMessage(error instanceof Error ? error.message : "Falha ao iniciar login.");
  });
});

if (window.FlixoAuth.readSession()) {
  window.FlixoAuth.currentUser().then((user) => {
    if (user) window.location.href = nextUrl();
  });
}
