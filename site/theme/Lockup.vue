<script setup lang="ts">
import mark from '../../brand/mark.svg?url';

const style = { '--lc-mark': `url("${mark}")` };
</script>

<template>
  <span class="lc-lockup">
    <span class="lc-mark" aria-hidden="true" :style="style" />
    <span class="lc-word">Lawcheck</span>
  </span>
</template>

<style>
.lc-lockup {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--lc-font-sans);
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
  color: var(--lc-text);
}

.lc-mark {
  flex: none;
  width: 21px;
  height: 28px;
  background: var(--lc-brand);
  -webkit-mask: var(--lc-mark) center / contain no-repeat;
  mask: var(--lc-mark) center / contain no-repeat;
}
</style>
