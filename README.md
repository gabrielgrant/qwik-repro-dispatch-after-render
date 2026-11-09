# Qwik repro: event handlers run too late right after `render()`

Minimal reproduction for a `@qwik.dev/core` regression (first seen in 2.0.0-beta.38, still present in 2.0.0-rc.5).

Right after `await render(host, <App />)` resolves, Qwik event handlers do not run while the browser dispatches the
event. They run later, after native propagation has finished (`ev.eventPhase === 0`). So a child handler that calls
`ev.stopPropagation()` cannot stop its ancestor's `onClick$`, and conditional `preventDefault()` has no effect. This
happens even for `sync$` handlers. While a new container is being set up, it also affects containers that were
already on the page.

The window is short (until Qwik's async container setup finishes, a couple of macrotasks), so a human clicking by
hand will not hit it. Code that interacts with the UI right after `render()` does: browser tests
(vitest-browser-qwik renders every test into the same page), widgets or micro-frontends that mount and then dispatch
events, and so on.

This app is client-only (`qwikVite({ csr: true })`, `index.html` -> `src/main.tsx`). It does not use Qwik Router, so
`@qwik.dev/core` is the only Qwik package and can be swapped to another version on its own.

## Steps

```shell
npm install
npm run dev
```

Open the printed URL. On load, `src/main.tsx` mounts three containers with `render()` and calls `button.click()` in
each one as soon as `render()` resolves. The buttons let you mount more.

- **Expected:** every box shows `wrapper handler: 0 OK` (the child's `stopPropagation()` keeps the click away from the
  wrapper).
- **Actual (2.0.0-beta.38 to 2.0.0-rc.5):** boxes #2 and #3 show `wrapper handler: 1 BUG`. "Mount another container,
  then click container #1" also breaks box #1, which had been mounted long before. Box #1 passes on load only because
  its `render()` had to fetch the component's code first, which gives the async setup time to finish.

To compare with an older core, swap only `@qwik.dev/core`:

```shell
npm i -D -E @qwik.dev/core@2.0.0-beta.37
npm run dev
```

## Versions tested (Chromium 153, `vite` dev server)

| `@qwik.dev/core`          | Result |
| ------------------------- | ------ |
| 2.0.0-beta.36             | OK     |
| 2.0.0-beta.37             | OK     |
| 2.0.0-beta.38             | BUG    |
| 2.0.0-rc.4                | BUG    |
| 2.0.0-rc.5 (npm `latest`) | BUG    |

`UPSTREAM_ISSUE.md` is the matching issue report for QwikDev/qwik, with the root-cause analysis.

This repo started from [QwikDev/qwik-new-for-stackblitz](https://github.com/QwikDev/qwik-new-for-stackblitz); the
Qwik Router files were removed to keep the repro client-only.
