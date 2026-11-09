import "@qwik.dev/core/qwikloader.js";
import { render } from "@qwik.dev/core";
import { Demo } from "./components/demo";

let count = 0;

async function mountContainer() {
  const host = document.createElement("div");
  document.getElementById("containers")!.append(host);
  await render(host, <Demo n={++count} />);
  return host;
}

// Interact with the UI as soon as render() has resolved, the way a browser
// test (e.g. vitest-browser-qwik) or any mount-then-interact code does.
async function mountAndClick(clickTarget?: HTMLElement) {
  const host = await mountContainer();
  (clickTarget ?? host).querySelector("button")!.click();
}

document
  .getElementById("mount")!
  .addEventListener("click", () => mountAndClick());
document
  .getElementById("mount-cross")!
  .addEventListener("click", () =>
    mountAndClick(document.querySelector<HTMLElement>('[data-demo="1"]')!),
  );

for (let i = 0; i < 3; i++) await mountAndClick();
