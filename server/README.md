# MMVC / VCClient server

See the repository [developer guide](../README_dev.md) for installation, tests,
CPU/GPU selection, offline startup, and remote-access security.

```bash
# From the repository root, after creating a Python 3.10 environment:
pip install -r server/requirements.txt
cd server
python MMVCServerSIO.py -p 18888 --host 127.0.0.1
```

Use `--no_download` to start without network downloads. Non-loopback listeners
require `--access-token` or `VCCLIENT_ACCESS_TOKEN`.

Useful local endpoints (all except `/api/hello` and `/api/health` require the token
when one is configured):

| Endpoint | Purpose |
| --- | --- |
| `GET /` | Built frontend |
| `GET /api/health` | Public status, model-loaded flag, server-audio flag, uptime |
| `GET /info`, `GET /performance` | Settings/model slots and conversion timings |
| `POST /soundboard/stop` | Stop and clear queued soundboard/TTS audio |
| `POST /soundboard/delete` | Delete a soundboard clip by filename |
| `GET /tts/voices`, `POST /tts` | List OS voices; synthesize with an optional voice id/name |
| `POST /delete_model` | Delete an unloaded model slot (`slot` form field) |
| `GET /device_setup/status` | Virtual-cable/mic detection and setup hints |

RVC checkpoints use safe tensor loading by default. `VCCLIENT_TRUST_MODEL_PICKLES=1`
is an explicit opt-in for trusted legacy pickle metadata/assets only.
