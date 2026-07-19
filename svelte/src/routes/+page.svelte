<script lang="ts">
  import { onMount } from "svelte";

  onMount(() => {
    void import("../cljs-out/main.js");
  });
</script>

<div id="app"></div>
