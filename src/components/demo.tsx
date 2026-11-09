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
        child handler: <b class="child">{child.value}</b>, wrapper handler:{" "}
        <b class="wrapper-count">{wrapper.value}</b>{" "}
        <b class="verdict">
          {wrapper.value === 0 ? "OK" : "BUG: stopPropagation() came too late"}
        </b>
      </p>
    </fieldset>
  );
});
