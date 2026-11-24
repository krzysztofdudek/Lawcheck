<script setup lang="ts">
import Lockup from '../theme/Lockup.vue';
import CopyCommand from './CopyCommand.vue';
import Film from './Film.vue';
import { data } from './facts.data.ts';

const c = data.copy;
const released = c.footer.released.replace('{version}', data.head.version).replace('{date}', data.head.date);
const ahead = c.footer.ahead.replace('{version}', data.head.version);
</script>

<template>
  <a class="skip" href="#main">{{ c.skip }}</a>
  <header class="bar">
    <nav class="bar-inner" aria-label="Lawcheck">
      <a class="home" href="/"><Lockup /></a>
      <a :href="c.nav.docs.href">{{ c.nav.docs.text }}</a>
      <a :href="data.links.github">{{ c.nav.github }}</a>
      <a class="version" :href="data.links.changelog">{{ data.head.version }}</a>
    </nav>
  </header>

  <main id="main" tabindex="-1">
      <section class="wrap hero">
        <div class="hero-text">
          <h1>{{ c.h1 }}</h1>
          <p class="lead" v-html="data.hero.promise" />
          <p class="who" v-html="data.hero.who" />
        </div>
        <Film class="hero-film" :still="data.hero.still" />
        <div class="hero-install">
          <CopyCommand :command="data.hero.install" :copy="c.install.copy" :copied="c.install.copied" />
          <a class="button quick" :href="c.install.quickStart.href">{{ c.install.quickStart.text }}</a>
          <ul class="facts">
            <li v-html="data.hero.support" />
            <li v-html="data.hero.alpha" />
            <li v-html="data.hero.sends" />
          </ul>
        </div>
      </section>

      <section class="wrap problem" aria-labelledby="problem">
        <h2 id="problem">{{ c.problem }}</h2>
        <p v-html="data.problem" />
        <p v-html="data.advice" />
      </section>

      <section class="wrap" aria-labelledby="law">
        <h2 id="law">{{ data.law.heading }}</h2>
        <div class="pair">
          <div>
            <p v-html="data.law.intro" />
            <div class="code" v-html="data.law.law" />
          </div>
          <div>
            <p v-html="data.law.findingIntro" />
            <div class="code terminal" v-html="data.law.finding" />
          </div>
        </div>
      </section>

      <section class="wrap" aria-labelledby="where">
        <h2 id="where">{{ data.where.heading }}</h2>
        <ul class="cards">
          <li v-for="item in data.where.items" :key="item" v-html="item" />
        </ul>
        <p v-html="data.where.other" />
      </section>

      <section class="wrap" aria-labelledby="holds">
        <h2 id="holds">{{ data.holds.heading }}</h2>
        <ul class="plain">
          <li v-for="item in data.holds.items" :key="item" v-html="item" />
        </ul>
        <p><a :href="data.holds.link.href">{{ data.holds.link.text }}</a></p>
      </section>

      <section class="wrap" aria-labelledby="tools">
        <h2 id="tools">{{ data.tools.heading }}</h2>
        <div class="table" tabindex="0" role="region" aria-labelledby="tools">
          <table>
            <thead>
              <tr><th v-for="cell in data.tools.head" :key="cell" scope="col" v-html="cell" /></tr>
            </thead>
            <tbody v-for="group in data.tools.groups" :key="group.label">
              <tr><th colspan="2" scope="colgroup" class="group" v-html="group.label" /></tr>
              <tr v-for="row in group.rows" :key="row[0]">
                <td v-html="row[0]" />
                <td v-html="row[1]" />
              </tr>
            </tbody>
          </table>
        </div>
        <p><a :href="c.comparison.href">{{ c.comparison.text }}</a></p>
      </section>

      <section class="wrap" aria-labelledby="limits">
        <h2 id="limits">{{ data.limits.heading }}</h2>
        <ul class="plain">
          <li v-for="item in data.limits.items" :key="item" v-html="item" />
        </ul>
      </section>

      <section class="wrap next" aria-labelledby="try">
        <h2 id="try">{{ data.tryIt.heading }}</h2>
        <CopyCommand :command="data.tryIt.install" :copy="c.install.copy" :copied="c.install.copied" />
        <p v-html="data.tryIt.plugin" />
        <CopyCommand :command="data.tryIt.pluginCommands" :copy="c.install.copy" :copied="c.install.copied" />
        <p v-html="data.tryIt.codex" />
        <p v-html="data.tryIt.quickStart" />
        <p class="links">
          <a class="button" :href="c.next.button.href">{{ c.next.button.text }}</a>
          <a :href="data.links.github">{{ c.next.github }}</a>
          <a :href="data.links.npm">{{ c.next.npm }}</a>
        </p>
      </section>
  </main>

  <footer class="foot">
    <div class="wrap foot-inner">
      <a class="home" href="/"><Lockup /></a>
      <p>{{ released }}</p>
      <p v-if="data.head.ahead">{{ ahead }}</p>
      <ul class="foot-links">
        <li><a :href="c.footer.docs.href">{{ c.footer.docs.text }}</a></li>
        <li><a :href="c.footer.changelog.href">{{ c.footer.changelog.text }}</a></li>
        <li><a :href="data.links.security">{{ c.footer.security }}</a></li>
        <li><a :href="data.links.github">{{ c.footer.github }}</a></li>
        <li><a :href="data.links.npm">{{ c.footer.npm }}</a></li>
        <li><a :href="data.links.author">{{ c.footer.author }}</a></li>
      </ul>
    </div>
  </footer>
</template>
