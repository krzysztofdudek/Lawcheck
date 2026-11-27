<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ command: string; copy: string; copied: string; wrap?: boolean }>();
const done = ref(false);

async function write(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.command);
    done.value = true;
    setTimeout(() => (done.value = false), 1500);
  } catch {}
}
</script>

<template>
  <div class="cmd">
    <code :class="{ wrap }" tabindex="0">{{ command }}</code>
    <button type="button" @click="write">{{ done ? copied : copy }}</button>
    <span class="sr" role="status" aria-live="polite">{{ done ? copied : '' }}</span>
  </div>
</template>

<style scoped>
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
