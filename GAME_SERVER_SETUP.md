# Mossvale Authoritative Game Server

Mossvale can use a small authoritative WebSocket server for live movement and PvP. Supabase still stores persistent world/player data.

Run locally:

```sh
npm run game-server
```

Local browser testing:

```txt
npm run dev
```

The 3D Vite app automatically uses `ws://127.0.0.1:8787` when opened on
`localhost` or `127.0.0.1`. Use `?gameServer=off` to force the Supabase
presence fallback, or `?gameServer=ws://host:port` to test another server.
Use the local URL printed by Vite, usually `http://127.0.0.1:5173/`.

Deploy the static client to GitHub Pages:

1. Deploy the AWS game server first and copy its `wss://` URL.
2. In GitHub, open Settings > Secrets and variables > Actions > Variables.
3. Add `MOSSVALE_GAME_SERVER_URL` with the AWS `wss://` URL.
4. Optional: add `MOSSVALE_WORLD_ID` if you want a world id other than `main`.
5. Optional: add `PAGES_BASE_PATH` as `/` when using a custom domain. The default is `/mossvale-shared-grove/`.
6. In Settings > Pages, set Source to GitHub Actions.
7. Push to `main` or run the "Deploy GitHub Pages" workflow manually.

Keep one AWS container running until the game server has shared state across machines. The current server is intentionally in-memory so every connected player must land on the same process for fair PvP.

Friend test checklist:

1. Deploy the AWS game server and verify its health URL returns `{"ok":true,"players":0}`.
2. Confirm GitHub variable `MOSSVALE_GAME_SERVER_URL` is the hosted `wss://` URL.
3. Deploy GitHub Pages from Actions.
4. Open the hosted page from two browsers or devices and confirm both players appear.

AWS server deployment:

```txt
See LIGHTSAIL_SETUP.md
```

For the current 3D client, production needs `MOSSVALE_GAME_SERVER_URL` configured. Localhost still uses `ws://127.0.0.1:8787` automatically.
