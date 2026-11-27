<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import CopyCommand from './CopyCommand.vue';
import Hero from './hero/Hero.vue';
import { data } from './facts.data.ts';

const c = data.copy;
const panes = data.law.panes;
const lit = ref(panes.first);
const litLaw = (at: number) => panes.links[lit.value]?.law.includes(at) ?? false;
const litRule = (at: number) => panes.links[lit.value]?.rule.includes(at) ?? false;
const agent = ref(data.tryIt.agents[0]!.id);
const shown = () => data.tryIt.agents.find((entry) => entry.id === agent.value)!;

function step(event: KeyboardEvent, at: number): void {
  const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (move === 0) return;
  const all = data.tryIt.agents;
  const next = all[(at + move + all.length) % all.length]!;
  agent.value = next.id;
  (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-agent="${next.id}"]`)?.focus();
}

const sections = ref<HTMLElement | null>(null);
let watcher: IntersectionObserver | undefined;
onMounted(() => {
  const all = sections.value?.querySelectorAll('section') ?? [];
  watcher = new IntersectionObserver((entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('seen')), { threshold: 0.25 });
  all.forEach((section) => watcher!.observe(section));
});
onBeforeUnmount(() => watcher?.disconnect());
</script>

<template>
  <a class="skip" href="#main">{{ c.skip }}</a>
  <Hero :docs="data.links.docs" :github="data.links.github" />

  <main id="main" tabindex="-1">
    <p class="hero-note">{{ c.heroNote }}</p>

    <div ref="sections" class="page">
      <div class="trunk" aria-hidden="true" />

      <section id="what">
        <span class="branch" aria-hidden="true" />
        <h1 class="lead" v-html="data.lead" />
        <div class="facts">
          <div v-for="fact in data.facts" :key="fact.label" class="fact"><b>{{ fact.label }}</b><span v-html="fact.text" /></div>
        </div>
      </section>

      <section id="why" aria-labelledby="why-heading">
        <span class="branch" aria-hidden="true" />
        <p class="kicker" v-html="data.why.kicker" />
        <h2 id="why-heading">{{ data.why.heading }}</h2>
        <div class="compare-wrap" tabindex="0" role="region" aria-labelledby="why-heading">
          <table class="compare">
            <thead>
              <tr><th /><th v-for="(cell, at) in data.why.head" :key="cell" scope="col" :class="{ us: at === data.why.head.length - 1 }" v-html="cell" /></tr>
            </thead>
            <tbody>
              <tr v-for="row in data.why.rows" :key="row.label">
                <th scope="row">{{ row.label }}</th>
                <td v-for="(cell, at) in row.cells" :key="at" :class="[cell.pro ? 'yes' : 'no', { us: at === row.cells.length - 1 }]" v-html="cell.html" />
              </tr>
            </tbody>
          </table>
        </div>
        <p class="note" v-html="data.why.note" />
      </section>

      <section id="law" aria-labelledby="law-heading">
        <span class="branch" aria-hidden="true" />
        <p class="kicker" v-html="data.law.kicker" />
        <h2 id="law-heading">{{ data.law.heading }}</h2>
        <div class="panes">
          <div class="pane">
            <div class="t"><b>{{ data.law.titles.law.title }}</b>{{ data.law.titles.law.file }}</div>
            <pre class="law-lines" tabindex="0"><span v-for="(line, at) in panes.law" :key="at" class="l" :class="{ lit: litLaw(at) }" v-html="line || ' '" /></pre>
          </div>
          <div class="pane">
            <div class="t"><b>{{ data.law.titles.rule.title }}</b>{{ data.law.titles.rule.file }}</div>
            <pre tabindex="0"><span v-for="(line, at) in panes.rule" :key="at" class="l" :class="{ lit: litRule(at) }" v-html="line || ' '" /></pre>
          </div>
          <div class="pane">
            <div class="t"><b>{{ data.law.titles.finding.title }}</b>{{ data.law.titles.finding.file }}</div>
            <pre tabindex="0" @mouseleave="lit = panes.first"><span
              v-for="(line, at) in panes.finding"
              :key="at"
              class="l"
              :class="{ hot: line.link, lit: line.link && line.link === lit }"
              :tabindex="line.link ? 0 : undefined"
              @mouseenter="line.link && (lit = line.link)"
              @focus="line.link && (lit = line.link)"
              @click="line.link && (lit = line.link)"
              v-html="line.html || ' '" /></pre>
          </div>
        </div>
        <p class="hint">{{ data.law.hint }}</p>
      </section>

      <section id="try" aria-labelledby="try-heading">
        <span class="branch" aria-hidden="true" />
        <p class="kicker" v-html="data.tryIt.kicker" />
        <h2 id="try-heading">{{ data.tryIt.heading }}</h2>
        <ol class="steps">
          <li>
            <span class="n">1</span>
            <div>
              <div class="what">{{ data.tryIt.install.label }}</div>
              <CopyCommand v-for="line in data.tryIt.install.commands" :key="line" :command="line" :copy="c.copy" :copied="c.copied" />
            </div>
          </li>
          <li>
            <span class="n">2</span>
            <div>
              <div class="what">{{ data.tryIt.plugin }}</div>
              <div class="tabs" role="tablist" :aria-label="data.tryIt.plugin">
                <button
                  v-for="(entry, at) in data.tryIt.agents"
                  :id="`agent-${entry.id}`"
                  :key="entry.id"
                  type="button"
                  role="tab"
                  :data-agent="entry.id"
                  :aria-selected="agent === entry.id"
                  aria-controls="agent-commands"
                  :tabindex="agent === entry.id ? 0 : -1"
                  @click="agent = entry.id"
                  @keydown="step($event, at)">
                  {{ entry.label }}
                </button>
              </div>
              <div id="agent-commands" role="tabpanel" :aria-labelledby="`agent-${agent}`">
                <CopyCommand v-for="line in shown().commands" :key="line" :command="line" :copy="c.copy" :copied="c.copied" :wrap="agent === 'other'" />
                <p class="small" v-html="shown().note" />
              </div>
            </div>
          </li>
          <li>
            <span class="n">3</span>
            <div>
              <div class="what">{{ data.tryIt.law.label }}</div>
              <CopyCommand v-for="line in data.tryIt.law.commands" :key="line" :command="line" :copy="c.copy" :copied="c.copied" />
              <p class="small" v-html="data.tryIt.law.note" />
            </div>
          </li>
          <li>
            <span class="n">4</span>
            <div>
              <div class="what">{{ data.tryIt.check.label }}</div>
              <CopyCommand v-for="line in data.tryIt.check.commands" :key="line" :command="line" :copy="c.copy" :copied="c.copied" />
              <p class="small" v-html="data.tryIt.check.note" />
            </div>
          </li>
        </ol>
        <p class="small"><span v-html="data.tryIt.needs" /> <span v-html="data.tryIt.hooks" /></p>
      </section>

      <section id="ci" aria-labelledby="ci-heading">
        <span class="branch" aria-hidden="true" />
        <p class="kicker" v-html="data.ci.kicker" />
        <h2 id="ci-heading">{{ data.ci.heading }}</h2>
        <div class="ci">
          <div>
            <CopyCommand :command="data.ci.command" :copy="c.copy" :copied="c.copied" />
            <p class="small" v-html="data.ci.note" />
          </div>
          <div class="pr">
            <div class="row">
              <span class="x" aria-hidden="true">✕</span>
              <div><b>{{ data.ci.check }}</b><div class="m"><template v-for="(line, at) in data.ci.output" :key="at"><br v-if="at > 0"><span v-html="line" /></template></div></div>
            </div>
          </div>
        </div>
      </section>

      <section id="holds" aria-labelledby="holds-heading">
        <span class="branch" aria-hidden="true" />
        <p class="kicker">{{ data.holds.kicker }}</p>
        <h2 id="holds-heading">{{ data.holds.heading }}</h2>
        <div class="cards">
          <a v-for="card in data.holds.cards" :key="card.title" class="card" :href="card.href"><b>{{ card.title }}</b><span v-html="card.text" /></a>
        </div>
      </section>

      <section id="measured" aria-labelledby="measured-heading">
        <span class="branch" aria-hidden="true" />
        <p id="measured-heading" class="kicker" v-html="data.measured.kicker" />
        <div class="measured">
          <p v-html="data.measured.why" />
          <p v-html="data.measured.before" />
          <div class="big">{{ data.measured.count }}</div>
          <p class="after" v-html="data.measured.after" />
          <p v-html="data.measured.arms" />
          <p class="limits-under" v-html="data.measured.limits" />
        </div>
      </section>

      <section v-if="data.tutorial.chapters.length > 0" id="tutorial" aria-labelledby="tutorial-heading">
        <span class="branch" aria-hidden="true" />
        <p class="kicker">{{ data.tutorial.kicker }}</p>
        <h2 id="tutorial-heading">{{ data.tutorial.heading }}</h2>
        <div class="chapters">
          <a v-for="chapter in data.tutorial.chapters" :id="`tutorial-${chapter.page}`" :key="chapter.page" class="chapter" :href="chapter.docs"><img alt="" loading="lazy" :src="chapter.poster" width="1920" height="1080"><span>{{ chapter.title }}</span><small>{{ chapter.label }}</small></a>
        </div>
      </section>

      <section id="limits" aria-labelledby="limits-heading">
        <span class="branch" aria-hidden="true" />
        <p class="kicker" v-html="data.limits.kicker" />
        <h2 id="limits-heading">{{ data.limits.heading }}</h2>
        <ul class="plain">
          <li v-for="item in data.limits.items" :key="item" v-html="item" />
        </ul>
      </section>
    </div>
  </main>

  <footer class="foot">
    <p>Lawcheck <span class="version">{{ data.head.version }}</span> · {{ data.footer.license }} · <a :href="data.footer.docs.href">{{ data.footer.docs.text }}</a> · <a :href="data.links.github">{{ data.footer.github }}</a> · <a :href="data.links.npm">{{ data.footer.npm }}</a> · {{ data.footer.author }}</p>
    <p v-if="data.head.ahead">{{ data.footer.ahead }}</p>
  </footer>
</template>
