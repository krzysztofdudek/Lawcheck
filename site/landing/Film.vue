<script setup lang="ts">
import { onMounted, ref } from 'vue';

defineProps<{ still: { file: string; html: string }; loop: { webm: string; mp4: string; label: string } | null }>();

const player = ref<HTMLVideoElement | null>(null);

onMounted(() => {
  if (player.value && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    player.value.pause();
    player.value.controls = true;
  }
});
</script>

<template>
  <figure id="film" class="film">
    <video v-if="loop" ref="player" class="film-loop" :aria-label="loop.label" autoplay muted loop playsinline>
      <source :src="loop.webm" type="video/webm" />
      <source :src="loop.mp4" type="video/mp4" />
    </video>
    <div v-else class="film-frame">
      <p class="film-file">{{ still.file }}</p>
      <div class="film-code" v-html="still.html" />
    </div>
  </figure>
</template>
