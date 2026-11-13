# Developer guide

## Prerequisites

- Python **3.10** (recommended and used by CI/release builds).
- Node.js **22.15+** and npm **10+** (`.nvmrc` selects Node 22).
- Linux/WSL2, Windows, or macOS. Linux audio device mode needs PortAudio and libsndfile:
  `sudo apt-get install libportaudio2 libsndfile1`.
- Docker Engine with BuildKit for the container path. NVIDIA Container Toolkit is
  required only for `USE_GPU=on`.

Do not clone a different upstream repository when developing this checkout.

## Python server

```bash
python3.10 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r server/requirements.txt
cd server
python MMVCServerSIO.py -p 18888 --host 127.0.0.1
```

The default environment uses ONNX Runtime (DirectML on Windows, CUDA package on
Linux, CPU package on macOS). NVIDIA CUDA also requires a compatible driver.
CPU execution works without a GPU. The first normal startup downloads weights
and sample catalogs into `server/pretrain` and `server/model_dir`.

For an offline startup with already-downloaded assets:

```bash
python MMVCServerSIO.py --no_download
```

Legacy Fairseq HuBERT/ContentVec and so-vits-svc checkpoints need the alternative
environment (do not install it over the default one):

```bash
pip install -r server/requirements-legacy.txt
export VCCLIENT_TRUST_LEGACY_CHECKPOINTS=1  # only for checkpoints you trust
```

Fairseq 0.12.2 requires the pinned NumPy 1.23.5 and Python 3.10. Prefer ONNX
embedders for new models. Legacy checkpoint metadata is loaded through a scoped
allowlist, not a process-wide `torch.load` monkeypatch.

User-supplied RVC `.pth`/`.pt` checkpoints are loaded with `weights_only=True` by
default. If a trusted legacy checkpoint needs unsafe pickle metadata, set
`VCCLIENT_TRUST_MODEL_PICKLES=1` explicitly; the same opt-in covers pickle-based
index/auxiliary assets. Never enable it for untrusted uploads.

## Client workspace

Run these commands from the repository root. The root lockfile is authoritative;
the demo links to the local `client/lib`, not the published npm package.

```bash
npm ci
npm run typecheck          # emits the local library's declarations before checking the demo
npm run lint
npm test
npm run build:client
```

For frontend development, start the Python server on port 18888, then:

```bash
VC_DEV_HTTPS=false npm run start:client
```

Open the printed webpack URL. API and Socket.IO requests are proxied to
`VC_BACKEND_URL` (default `http://127.0.0.1:18888`). HTTPS is enabled by default
for local microphone access; set `VC_DEV_HTTPS=false` when an outer proxy already
provides HTTPS. React is a peer dependency of the client library.

## Tests

```bash
pip install -r server/requirements-dev.txt
python -m pytest server/tests -q       # API, paths, rollback, downloads, settings, realtime
npm run test:server                    # same suite; set PYTHON=/path/to/python to override
npm test                              # Jest client tests + Node extension tests
npm run typecheck && npm run lint
```

The lightweight Python suite skips runtime-backed manager tests when PyTorch is
not installed. CI also performs a clean full-runtime import, runs the regression
suite against the full dependencies, and builds/runs the Docker image from the
checkout. Docker and GPU/audio-device behavior must be tested on a host with those
facilities; the unit suite does not emulate a microphone or CUDA.

## Docker

```bash
npm run build:docker:vcclient         # builds voice-changer:local from local source
./start_docker.sh                     # CPU, loopback-only published port
USE_GPU=on ./start_docker.sh          # NVIDIA GPU
```

The launcher prints a generated token if `VCCLIENT_ACCESS_TOKEN` is unset. Enter
it in **Advanced Settings → Server connection**. Models and weights persist in
`docker_folder/`. To expose the container beyond loopback, deliberately set
`BIND_HOST`, keep the token secret, add the public origin with `--allowed-origins`,
and put a TLS reverse proxy in front. Never expose an unauthenticated listener.

## Remote access security

`127.0.0.1`/`localhost` remains the default. Binding to any other address requires
a token of at least 16 characters. REST accepts `Authorization: Bearer <token>`;
Socket.IO accepts the same token in its connect auth payload. The demo stores the
entered token in memory and obtains an HttpOnly cookie for same-origin requests.
Origin checks are CSRF protection, not authentication.

## Release artifacts

`client/demo/dist`, `client/lib/dist`, and worklet bundles are generated and are
not tracked. The Windows workflow builds the local library before the demo and
then packages the server. Run `npm run build:client` before PyInstaller locally.
