// COMMITTED to git so GitHub Pages can serve a working build.
//
// This is OK because the publishable (anon) key is designed to ship in static
// sites — RLS policies in Supabase enforce all access control. Treat anything
// in this file as world-readable.
//
// NEVER add a service-role key here. Service-role bypasses RLS and would let
// anyone with the page source delete every row.

window.SUPABASE_CONFIG = {
  url:             "https://ulzschwnejxghxgluuif.supabase.co",
  publishableKey:  "sb_publishable_aXgQTPjUxESWmdH_k_dNFA_UJIYTqBo",
};
