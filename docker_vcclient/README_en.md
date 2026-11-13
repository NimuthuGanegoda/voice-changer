# VCClient for Docker

Build and run from the repository root. The image copies **this checkout** and
builds the local client library/frontend; it never clones upstream master.

```bash
npm run build:docker:vcclient       # voice-changer:local
./start_docker.sh                   # CPU, published only on 127.0.0.1:18888
```

The launcher prints a generated access token unless `VCCLIENT_ACCESS_TOKEN` is
already set. Open http://127.0.0.1:18888 and enter it under **Advanced Settings →
Server connection**. Weights/models are downloaded on first use and persisted in
`docker_folder/pretrain` and `docker_folder/model_dir`; you can also pre-populate
those directories. Use `--no_download` via a custom `docker run` for offline use.

Options:

```bash
USE_GPU=on ./start_docker.sh        # requires NVIDIA Container Toolkit
EX_PORT=19999 ./start_docker.sh
DOCKER_IMAGE=voice-changer:v1 ./start_docker.sh
VCCLIENT_ACCESS_TOKEN='your-long-random-token' ./start_docker.sh
```

The container listens on `0.0.0.0` internally so Docker port publishing works,
but the default published port is loopback-only and token-protected. To expose
it deliberately, set `BIND_HOST`, use a TLS reverse proxy, keep the token secret,
and allow the public browser origin. Do not publish an unauthenticated server.
