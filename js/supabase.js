// Creates the Supabase client from window.SUPABASE_CONFIG (loaded from
// supabase-config.js). Exposes window.sb for the rest of the app.

(function () {
  const cfg = window.SUPABASE_CONFIG;
  const isPlaceholder = (v) =>
    !v || /YOUR-PROJECT|REPLACE_ME|PASTE_YOUR/i.test(v);

  if (!cfg || isPlaceholder(cfg.url) || isPlaceholder(cfg.publishableKey)) {
    console.error(
      "Missing or placeholder Supabase config. Open js/supabase-config.js and " +
      "fill in your real URL + publishable key from Supabase Dashboard -> Settings -> API."
    );
    return;
  }

  // The Supabase JS CDN exposes a global `supabase` object with createClient.
  // Rename to `sb` for our own use so we don't collide with that global.
  window.sb = supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.publishableKey,
    {
      auth: {
        persistSession:    true,
        autoRefreshToken:  true,
        detectSessionInUrl: true,
      },
    }
  );
})();
