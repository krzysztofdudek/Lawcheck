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
  </div>
</template>
