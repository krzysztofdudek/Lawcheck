<script setup lang="ts">
import { nextTick, ref } from 'vue';

interface Chapter {
  page: string;
  number: number;
  title: string;
  docs: string;
  seconds: number;
  video: string;
  track: string;
  poster: string;
  transcript: string[];
}

defineProps<{
  copy: { heading: string; chapter: string; length: string; play: string; read: string; transcript: string };
  chapters: Chapter[];
}>();

const playing = ref<string | null>(null);
const players = ref<HTMLVideoElement[]>([]);

async function play(page: string): Promise<void> {
  playing.value = page;
  await nextTick();
  const player = players.value.find((video) => video.dataset.page === page);
  if (!player) return;
  for (const track of Array.from(player.textTracks)) track.mode = 'showing';
  player.focus();
}
</script>

<template>
  <section id="tutorial" class="wrap tutorial" aria-labelledby="tutorial-heading">
    <h2 id="tutorial-heading">{{ copy.heading }}</h2>
    <ol class="chapters">
      <li v-for="chapter in chapters" :id="`tutorial-${chapter.page}`" :key="chapter.page" class="chapter">
        <div class="chapter-bar">
          <div class="chapter-text">
            <p class="chapter-number">{{ copy.chapter.replace('{n}', String(chapter.number)) }}</p>
            <h3>{{ chapter.title }}</h3>
            <p class="chapter-length">{{ copy.length.replace('{seconds}', String(chapter.seconds)) }}</p>
          </div>
          <p class="links chapter-actions">
            <button v-if="playing !== chapter.page" type="button" class="button chapter-play" @click="play(chapter.page)">
              {{ copy.play }}<span class="visually-hidden"> {{ copy.chapter.replace('{n}', String(chapter.number)).toLowerCase() }}, {{ chapter.title }}</span>
            </button>
            <a :href="chapter.docs">{{ copy.read }}<span class="visually-hidden">: {{ chapter.title }}</span></a>
          </p>
        </div>
        <video v-if="playing === chapter.page" ref="players" class="chapter-video" :data-page="chapter.page" :poster="chapter.poster" controls autoplay playsinline tabindex="0">
          <source :src="chapter.video" type="video/mp4" />
          <track kind="subtitles" srclang="en" label="English" :src="chapter.track" default />
        </video>
        <details class="chapter-transcript">
          <summary>{{ copy.transcript }}<span class="visually-hidden">: {{ chapter.title }}</span></summary>
          <p v-for="line in chapter.transcript" :key="line">{{ line }}</p>
        </details>
      </li>
    </ol>
  </section>
</template>
