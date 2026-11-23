<script setup lang="ts">
defineProps<{ still: { file: string; html: string } }>();
</script>

<template>
  <figure id="film" class="film">
    <div class="film-frame">
      <p class="film-file">{{ still.file }}</p>
      <div class="film-code" v-html="still.html" />
    </div>
  </figure>
</template>
