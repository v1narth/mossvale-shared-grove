# Mossvale on AWS Lightsail Containers

Mossvale's authoritative PvP server can run on an AWS Lightsail container service. Keep the service at `scale 1` until the server has shared state, because player/world state is currently held in memory.

## Requirements

- AWS CLI v2
- Lightsail Control plugin (`lightsailctl`)
- Docker
- A configured AWS profile with Lightsail permissions

Check local auth:

```sh
aws sts get-caller-identity
```

Install `lightsailctl` locally on Apple Silicon:

```sh
mkdir -p .bin
curl -L https://s3.us-west-2.amazonaws.com/lightsailctl/latest/darwin-arm64/lightsailctl -o .bin/lightsailctl
chmod +x .bin/lightsailctl
export PATH="$PWD/.bin:$PATH"
```

## Recommended Service

- Service name: `mossvale-game`
- Region: `eu-central-1`
- Power: `nano`
- Scale: `1`

`nano` should be enough for the current dependency-free Node WebSocket server. Move to `micro` if memory or CPU metrics say it is too tight.

## Create The Service

This creates a billable Lightsail resource.

```sh
aws lightsail create-container-service \
  --service-name mossvale-game \
  --power nano \
  --scale 1 \
  --region eu-central-1
```

## Build And Push The Image

```sh
docker build --platform linux/amd64 -t mossvale-game-server:latest .

aws lightsail push-container-image \
  --service-name mossvale-game \
  --label game-server \
  --image mossvale-game-server:latest \
  --region eu-central-1
```

The push command registers a Lightsail image named like:

```txt
:mossvale-game.game-server.latest
```

## Deploy The Container

```sh
aws lightsail create-container-service-deployment \
  --service-name mossvale-game \
  --region eu-central-1 \
  --containers '{
    "game-server": {
      "image": ":mossvale-game.game-server.latest",
      "environment": {
        "HOST": "0.0.0.0",
        "PORT": "8787"
      },
      "ports": {
        "8787": "HTTP"
      }
    }
  }' \
  --public-endpoint '{
    "containerName": "game-server",
    "containerPort": 8787,
    "healthCheck": {
      "path": "/",
      "successCodes": "200-299",
      "intervalSeconds": 10,
      "timeoutSeconds": 5,
      "healthyThreshold": 2,
      "unhealthyThreshold": 3
    }
  }'
```

## Find The Public URL

```sh
aws lightsail get-container-services \
  --service-name mossvale-game \
  --region eu-central-1 \
  --query 'containerServices[0].url' \
  --output text
```

Use that URL as a WebSocket URL in `index.html` by changing `https://` to `wss://`:

```html
<script>
  window.MOSSVALE_GAME_SERVER = {
    url: "wss://mossvale-game.example.eu-central-1.cs.amazonlightsail.com",
  };
</script>
```

Then bump the `game.js` cache key, commit, push GitHub Pages, and verify:

```sh
curl https://YOUR_LIGHTSAIL_DOMAIN/
```

The health response should look like:

```json
{"ok":true,"players":0}
```
