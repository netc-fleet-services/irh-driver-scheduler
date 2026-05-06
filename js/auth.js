// Auth wrapper. Owns the login/logout flow and broadcasts session changes.
// Pages subscribe via Auth.onChange(handler).

window.Auth = (function () {
  const listeners = new Set();
  let currentSession = null;

  function notify() {
    listeners.forEach(fn => {
      try { fn(currentSession); } catch (e) { console.error(e); }
    });
  }

  // Initial bootstrap: read existing session (Supabase persists it in localStorage)
  // and subscribe to future changes.
  async function init() {
    if (!window.sb) return;

    const { data: { session } } = await window.sb.auth.getSession();
    currentSession = session;
    notify();

    window.sb.auth.onAuthStateChange((_event, session) => {
      currentSession = session;
      notify();
    });
  }

  function onChange(fn) {
    listeners.add(fn);
    // Fire immediately so subscribers don't miss the current state
    fn(currentSession);
    return () => listeners.delete(fn);
  }

  async function signIn(email, password) {
    const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await window.sb.auth.signOut();
    if (error) throw error;
  }

  function getSession() {
    return currentSession;
  }

  function getUser() {
    return currentSession?.user ?? null;
  }

  return { init, onChange, signIn, signOut, getSession, getUser };
})();
