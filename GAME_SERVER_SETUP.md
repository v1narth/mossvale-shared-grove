# Mossvale Authoritative Game Server

Mossvale can use a small authoritative WebSocket server for live movement and PvP. Supabase still stores persistent world/player data.

Run locally:

```sh
npm run game-server
```

Local browser testing:

```txt
http://localhost:8786/?gameServer=ws://127.0.0.1:8787
```

Production requires a hosted `wss://` URL. Set it in `index.html`:

```html
<script>
  window.MOSSVALE_GAME_SERVER = {
    url: "wss://YOUR_GAME_SERVER_HOST",
  };
</script>
```

When no game server URL is configured, the browser keeps using Supabase Realtime as the live fallback.
