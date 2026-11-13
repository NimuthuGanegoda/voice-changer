# Contributing

1. Use Python 3.10 and Node 22 (`.nvmrc`). Install `server/requirements-dev.txt`
   for the lightweight server suite and run `npm ci` at the repository root.
2. Keep changes on your working branch. Do not commit generated `dist` folders,
   model weights, uploads, logs, or virtual environments.
3. Before proposing a change run:
   `python -m pytest server/tests -q`, `npm test`, `npm run typecheck`,
   `npm run lint`, and `npm run build:client`.
4. Add a regression test for bug fixes. Filesystem tests must use temporary
   directories; network tests must mock downloads. Never put real tokens or
   user model files in fixtures.
5. Model imports must validate the entire request before replacing a slot and
   must preserve the previous slot on failure. Keep browser-facing URLs relative
   or configurable; do not hardcode localhost in shipped browser code.
6. Document security-visible changes (authentication, origins, checkpoint trust,
   published ports) in `README_dev.md`.

The Docker smoke job in CI builds the local source and checks both unauthorized
and authorized HTTP requests. GPU and real audio-device tests remain manual.
