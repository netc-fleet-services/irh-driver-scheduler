// App entry point. Orchestrates auth state -> view switching -> scheduler render.

(async function init() {
  const loginView      = document.getElementById("login-view");
  const appView        = document.getElementById("app-view");
  const loginForm      = document.getElementById("login-form");
  const loginEmail     = document.getElementById("login-email");
  const loginPassword  = document.getElementById("login-password");
  const loginError     = document.getElementById("login-error");
  const loginSubmit    = document.getElementById("login-submit");
  const signOutBtn     = document.getElementById("sign-out-btn");
  const userEmailEl    = document.getElementById("user-email");
  const statusEl       = document.getElementById("connection-status");
  const themeToggleBtn = document.getElementById("theme-toggle");

  themeToggleBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
  });

  function setStatus(state, text) {
    statusEl.className = `status status--${state}`;
    statusEl.textContent = text;
  }

  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.hidden = false;
  }

  function clearLoginError() {
    loginError.hidden = true;
    loginError.textContent = "";
  }

  if (!window.sb) {
    setStatus("err", "no client");
    loginView.hidden = false;
    showLoginError(
      "Supabase client failed to initialize. Open js/supabase-config.js and check the URL + publishable key."
    );
    loginSubmit.disabled = true;
    return;
  }

  ShiftModal.mount();
  DayView.mount();
  Stats.mount();
  PrintSchedule.mount();
  Scheduler.mount();
  if (window.Historical?.mount) Historical.mount();
  if (window.SettingsView?.mount) SettingsView.mount();

  // Auth state -> view switching
  let mountedScheduler = false;
  Auth.onChange(async (session) => {
    if (session) {
      loginView.hidden = true;
      appView.hidden = false;
      signOutBtn.hidden = false;
      userEmailEl.textContent = session.user.email;
      setStatus("ok", "connected");

      // Load shared settings before first paint so optimizer reads from
      // the saved values (not just APP_CONFIG defaults).
      if (window.Settings?.load) {
        try { await Settings.load(); } catch (e) { console.warn("Settings load failed", e); }
      }

      if (!mountedScheduler) {
        await Scheduler.render();
        mountedScheduler = true;
      } else {
        await Scheduler.render();
      }
    } else {
      appView.hidden = true;
      loginView.hidden = false;
      signOutBtn.hidden = true;
      userEmailEl.textContent = "";
      setStatus("unknown", "signed out");
      mountedScheduler = false;
    }
  });

  await Auth.init();

  // Login form submit
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearLoginError();
    loginSubmit.disabled = true;
    loginSubmit.textContent = "Signing in…";
    try {
      await Auth.signIn(loginEmail.value.trim(), loginPassword.value);
    } catch (err) {
      showLoginError(err.message || "Sign in failed.");
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = "Sign in";
    }
  });

  signOutBtn.addEventListener("click", async () => {
    try { await Auth.signOut(); } catch (err) { console.error(err); }
  });
})();
