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

Deploy to Fly.io:

```sh
flyctl auth login
flyctl apps create mossvale-game
flyctl deploy
flyctl scale count 1 --app mossvale-game --yes
```

Production requires a hosted `wss://` URL. Set it in `index.html`:

```html
<script>
  window.MOSSVALE_GAME_SERVER = {
    url: "wss://mossvale-game.fly.dev",
  };
</script>
```

Keep one Fly machine running until the game server has shared state across machines. The current server is intentionally in-memory so every connected player must land on the same process for fair PvP.

Preferred AWS deployment:

```txt
See LIGHTSAIL_SETUP.md
```

When no game server URL is configured, the browser keeps using Supabase Realtime as the live fallback.
