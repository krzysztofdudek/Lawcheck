<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ command: string; copy: string; copied: string }>();
const done = ref(false);

async function write(): Promise<void> {
  await navigator.clipboard.writeText(props.command);
  done.value = true;
  setTimeout(() => (done.value = false), 2000);
}
</script>

<template>
  <div class="command">
    <pre tabindex="0"><code>{{ command }}</code></pre>
    <button type="button" class="command-copy" @click="write">{{ copy }}</button>
    <span class="visually-hidden" role="status">{{ done ? copied : '' }}</span>
  </div>
</template>
