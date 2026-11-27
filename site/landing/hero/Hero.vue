<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import markFile from '../../../brand/mark.svg?raw';
import { hero, startHero } from './hero.mjs';
import './hero.css';

const props = defineProps<{ docs: string; github: string }>();
const mark = markFile.trim().replace('<svg xmlns="http://www.w3.org/2000/svg" ', '<svg aria-hidden="true" ');
const model = hero(mark, { docs: props.docs, github: props.github });
const markup = model.markup();
const root = ref<HTMLElement | null>(null);
let stop = (): void => {};

onMounted(() => {
  stop = startHero(root.value!, model, new URLSearchParams(location.search));
});
onBeforeUnmount(() => stop());
</script>

<template>
  <section ref="root" class="hero" aria-label="What Lawcheck does" v-html="markup" />
</template>
