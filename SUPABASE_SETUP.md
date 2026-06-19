# Mossvale Supabase Setup

Mossvale requires a real Supabase project for shared world sync. Players share one grove through Supabase Realtime and store shared world state plus each browser player's last position in Postgres.

1. Create a Supabase project.
2. In the Supabase SQL editor, run `supabase/schema.sql`. It is safe to run again after updates.
3. In Project Settings > API Keys, copy your Project URL and publishable key.
4. Put those public values in `index.html`:

```html
<script>
  window.MOSSVALE_SUPABASE = {
    url: "https://YOUR_PROJECT.supabase.co",
    publishableKey: "sb_publishable_...",
    worldId: "main",
  };
</script>
```

Never put a Supabase secret key or service role key in this static app.
