<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useData } from 'vitepress';

const { frontmatter } = useData();
const playing = ref(false);
const player = ref<HTMLVideoElement | null>(null);
watch(() => frontmatter.value.chapter, () => {
  playing.value = false;
});

async function play(): Promise<void> {
  playing.value = true;
  await nextTick();
  player.value?.focus();
}
</script>

<template>
  <section v-if="frontmatter.chapter" class="chapter" :aria-label="`Chapter ${frontmatter.chapter.number} of the tutorial`">
    <p class="chapter-head">
      <span class="chapter-name">Chapter {{ frontmatter.chapter.number }} of the tutorial</span>
      <span class="chapter-length">{{ frontmatter.chapter.seconds }} s, no sound, with subtitles</span>
    </p>
    <button v-if="!playing" type="button" class="chapter-play" @click="play">Play</button>
    <video v-else ref="player" class="chapter-video" controls autoplay playsinline muted crossorigin="anonymous" :poster="frontmatter.chapter.poster" tabindex="0">
      <source :src="frontmatter.chapter.video" type="video/mp4" />
      <track kind="subtitles" srclang="en" label="English" :src="frontmatter.chapter.track" default />
    </video>
    <details class="chapter-transcript">
      <summary>Transcript</summary>
      <p v-for="line in frontmatter.chapter.transcript" :key="line">{{ line }}</p>
    </details>
  </section>
</template>
