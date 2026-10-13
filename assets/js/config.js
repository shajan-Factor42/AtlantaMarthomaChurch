// Member portal settings.
// Paste the values from Supabase → Project Settings → API.
// The "anon public" key is safe to publish: Row Level Security in supabase/schema.sql
// controls what each signed-in member can see.
// While these are empty the portal runs in PREVIEW mode with sample data.
window.MTCA_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
