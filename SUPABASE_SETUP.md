# Mossvale Supabase Setup

Mossvale runs locally without Supabase. When these values are configured, deployed players share one grove through Supabase Realtime and store shared world state in Postgres.

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

For quick local testing without editing files, run this once in the browser console:

```js
localStorage.setItem("mossvale_supabase_config", JSON.stringify({
  url: "https://YOUR_PROJECT.supabase.co",
  publishableKey: "sb_publishable_...",
  worldId: "main"
}));
location.reload();
```

Never put a Supabase secret key or service role key in this static app.
