**Title:** [🐞] v2: right after `render()` resolves, event handlers run after native propagation, so `stopPropagation()` and `preventDefault()` have no effect (regression in 2.0.0-beta.38)

### Which component is affected?

Qwik Runtime

### Describe the bug

Since 2.0.0-beta.38, there is a window right after `await render(host, jsx)` resolves in which Qwik event handlers do not run during the browser's event dispatch. qwikloader calls the element's `_qDispatch` handler, but the handler returns a promise and the real handler runs later, after native propagation has finished (`ev.eventPhase === 0` inside the handler). As a result:

- `ev.stopPropagation()` in a child's handler does not stop the ancestor's `onClick$` (qwikloader sees `ev.cancelBubble === false` and goes on to the ancestor, whose handler is deferred the same way).
- `ev.preventDefault()` comes too late.
- This also applies to `sync$` handlers, which are meant to run synchronously.
- While a new container is being set up, containers that were already on the page are affected too, because the gate checks a document-wide flag.

Once Qwik's async container setup finishes (a couple of macrotasks later), dispatch is synchronous again. So a person clicking by hand will not hit it, but code that interacts right after `render()` does: browser tests (vitest-browser-qwik renders each test into the same page and tests click right away), widgets or micro-frontends that mount and then dispatch events, etc.

What I expect: once `render()` has resolved, handlers of the rendered container (and of containers already on the page) run synchronously during dispatch, as they did in 2.0.0-beta.37.

The first `render()` of a page often looks fine, but only because it has to fetch the component's code, which takes long enough for the setup to finish. Any `render()` that does not need to load code (a second container with the same component, or a second test) shows the bug.

Minimal code (the whole repro app is `index.html` plus these two files, with `qwikVite({ csr: true })`):

```tsx
// src/components/demo.tsx
import { $, component$, sync$, useSignal } from "@qwik.dev/core";

export const Demo = component$((props: { n: number }) => {
  const child = useSignal(0);
  const wrapper = useSignal(0);
  return (
    <fieldset data-demo={props.n}>
      <legend>Container #{props.n}</legend>
      <div class="wrapper" onClick$={() => wrapper.value++}>
        <button
          onClick$={[
            sync$((ev: Event) => ev.stopPropagation()),
            $(() => child.value++),
          ]}
        >
          child button
        </button>
      </div>
      <p>
        child handler: <b>{child.value}</b>, wrapper handler:{" "}
        <b>{wrapper.value}</b>{" "}
        <b>
          {wrapper.value === 0 ? "OK" : "BUG: stopPropagation() came too late"}
        </b>
      </p>
    </fieldset>
  );
});
```

```tsx
// src/main.tsx
import "@qwik.dev/core/qwikloader.js";
import { render } from "@qwik.dev/core";
import { Demo } from "./components/demo";

let count = 0;
async function mountAndClick(clickTarget?: HTMLElement) {
  const host = document.createElement("div");
  document.getElementById("containers")!.append(host);
  await render(host, <Demo n={++count} />);
  (clickTarget ?? host).querySelector("button")!.click();
}

for (let i = 0; i < 3; i++) await mountAndClick();
// The repro also has buttons for "mount another and click it" and
// "mount another, then click container #1".
```

### Reproduction

https://github.com/gabrielgrant/qwik-repro-dispatch-after-render (StackBlitz: https://stackblitz.com/github/gabrielgrant/qwik-repro-dispatch-after-render)

### Steps to reproduce

1. `npm install && npm run dev` (or open the repo on StackBlitz), then open the page.
2. On load, three containers are mounted with `render()` and each button is clicked with `button.click()` as soon as `render()` resolves.

- Expected: every box shows `wrapper handler: 0 OK`.
- Actual on 2.0.0-rc.5: boxes #2 and #3 show `wrapper handler: 1 BUG: stopPropagation() came too late`. Clicking "Mount another container, then click container #1" makes box #1 (mounted long before) show BUG too. Clicking any box by hand later works.

Swapping only `@qwik.dev/core` (the app has no other Qwik package): `npm i -D -E @qwik.dev/core@2.0.0-beta.37 && npm run dev` gives OK everywhere.

Results in Chromium 153 with the `vite` dev server, driven by Playwright:

| `@qwik.dev/core` | boxes #1 / #2 / #3 on load | box #1 clicked right after mounting #4 |
| ---------------- | -------------------------- | -------------------------------------- |
| 2.0.0-beta.36    | OK / OK / OK               | OK                                     |
| 2.0.0-beta.37    | OK / OK / OK               | OK                                     |
| 2.0.0-beta.38    | OK / BUG / BUG             | BUG                                    |
| 2.0.0-rc.4       | OK / BUG / BUG             | BUG                                    |
| 2.0.0-rc.5       | OK / BUG / BUG             | BUG                                    |

The gate described below is present in every published version from beta.38 to rc.5 and on `main` (checked at f1a7e6b). I only ran the versions in the table. I did not check a production build or SSR-resumed containers.

### System Info

```shell
  System:
    OS: Linux 6.18 Ubuntu 24.04.5 LTS 24.04.5 LTS (Noble Numbat)
    CPU: (4) x64 Intel(R) Xeon(R) Processor @ 2.10GHz
    Memory: 12.77 GB / 15.71 GB
    Container: Yes
    Shell: 5.2.21 - /bin/bash
  Binaries:
    Node: 22.23.4 - /opt/node22/bin/node
    npm: 10.9.9 - /opt/node22/bin/npm
  Browsers:
    Chrome: 153.0.8010.12
  npmPackages:
    @qwik.dev/core: 2.0.0-rc.5 => 2.0.0-rc.5
    typescript: 5.9.3 => 5.9.3
    vite: 8.2.4 => 8.2.4
```

### Additional Information

**Root cause (from reading the dist code and `main`).** Starting with beta.38, most likely from #8575 ("yield startup DOM and state processing during resume"), `runEventHandlerQRL` waits for container data before running a handler ([run-qrl.ts](https://github.com/QwikDev/qwik/blob/f1a7e6b693074231d89b873cb878ca9d9cc7c1e6/packages/qwik/src/core/client/run-qrl.ts#L35-L45)):

```ts
if (!ctx) {
  const container = getDomContainer(element);
  return whenContainerDataReady(container, () =>
    runEventHandlerQRL(
      handler,
      event,
      element,
      newInvokeContextFromDOM(event, element, container),
    ),
  );
}
```

`whenContainerDataReady` only calls back synchronously if the container is done and a document-wide flag is set; otherwise it returns a Promise ([process-state-data.ts](https://github.com/QwikDev/qwik/blob/f1a7e6b693074231d89b873cb878ca9d9cc7c1e6/packages/qwik/src/core/client/process-state-data.ts#L59-L75)):

```ts
if (isContainerReady(domContainer) && domContainer.document.qVNodeDataReady) {
  return callback();
}
return new Promise<T>((resolve, reject) => { onContainerDataReady(domContainer, () => { ... }) });
```

Every new `DomContainer`, including the one `render()` creates, starts that processing ([dom-container.ts](https://github.com/QwikDev/qwik/blob/f1a7e6b693074231d89b873cb878ca9d9cc7c1e6/packages/qwik/src/core/client/dom-container.ts#L198-L204)). With #8799 (also beta.38) the walk re-runs for each container added after the first, and enqueuing it clears the document-wide flag before scheduling the work as a yielding job on a `MessageChannel` macrotask ([process-vnode-data.ts](https://github.com/QwikDev/qwik/blob/f1a7e6b693074231d89b873cb878ca9d9cc7c1e6/packages/qwik/src/core/client/process-vnode-data.ts#L152-L166)):

```ts
qDocument.qVNodeDataReady = false;
state.$queue$.push(iterator);
scheduleProcessVNodeData(qDocument, state);
```

After the vnode walk, the container's state processing is scheduled as another macrotask. Meanwhile `render()` only awaits `container.$renderPromise$` ([dom-render.ts](https://github.com/QwikDev/qwik/blob/f1a7e6b693074231d89b873cb878ca9d9cc7c1e6/packages/qwik/src/core/client/dom-render.ts#L28-L60)). When no component code has to be loaded, that promise settles before those macrotasks run, so `render()` resolves while the new container is still in `ProcessingVNode` (`$containerDataProcessState$ === 1`) and `document.qVNodeDataReady === false`. I logged this in a variant of the repro: after the first `render()` the state is 3 and the flag is `true`; after every later one the state is 1 and the flag is `false`. Rendering a different, not yet loaded component into box #2 made box #2 pass and box #3 fail, so it is about timing, not about being the first container.

qwikloader itself did not change in a way that matters here. Its `dispatch()` calls `_qDispatch` handlers synchronously and, when one returns a promise, just queues it and moves on to the next element, because `ev.cancelBubble` is still false.

A client container made by `render()` has no `qwik/vnode` or `qwik/state` script to process, so the gate does not seem to be needed for it. Possible fixes, which I have not tried: have `render()` mark its container ready (or await `whenContainerDataReady`) before resolving, and avoid clearing the document-wide `qVNodeDataReady` for containers that have nothing to process.

**Workaround.** Wait for the internal readiness helper after `render()`. This makes every box OK in the repro:

```ts
import { render, _getDomContainer, _whenContainerDataReady } from "@qwik.dev/core";

await render(host, <App />);
await _whenContainerDataReady(_getDomContainer(host), () => {});
```

A single `await new Promise((r) => setTimeout(r))` after `render()` is not enough (box #2 and #3 still fail in the repro).

**Related issues.** I did not find a duplicate. Related: #9330 (a pending async handler delays later handlers of other elements, also through qwikloader's deferred task queue), #9331, and #9121 (test helpers resolve before async work has finished). The origin appears to be #8575 together with #8799.
