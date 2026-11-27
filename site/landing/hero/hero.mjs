const ROBOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M12 3v3"/><circle cx="12" cy="2.6" r="1.2" fill="currentColor"/><rect x="4.5" y="6.5" width="15" height="11" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.3" cy="12" r="1.5" fill="currentColor"/><circle cx="14.7" cy="12" r="1.5" fill="currentColor"/><path d="M8 20.5h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export const INSTALL = 'npm install --global lawcheck@alpha';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const show = (t, at, dur = 0.3) => `style="opacity:${ease((t - at) / dur).toFixed(3)};transform:translateY(${((1 - ease((t - at) / dur)) * 10).toFixed(1)}px)"`;

function yamlLine(line) {
  const m = /^(\s*)([\w-]+)(:)(.*)$/.exec(line);
  return m ? `${m[1]}<span class="y">${esc(m[2])}</span><span class="p">:</span><span class="s">${esc(m[4])}</span>` : esc(line);
}
const TOKEN = /("(?:[^"\\]|\\.)*")|\b(import|from|export|function|const|return|if|new)\b|\b(number|Date|Math)\b|([A-Za-z_$][\w$]*)(?=\s*\()|([{}()[\];,.:<>=|&!?+\-*/%]+)/g;
function tsLine(line) {
  let out = '';
  let last = 0;
  line.replace(TOKEN, (m, str, kw, ty, fn, pun, at) => {
    out += esc(line.slice(last, at));
    out += `<span class="${str ? 's' : kw ? 'k' : ty ? 't' : fn ? 'fn' : 'p'}">${esc(m)}</span>`;
    last = at + m.length;
    return m;
  });
  return out + esc(line.slice(last));
}

const FLOW = ['edit', 'check', 'fix', 'pull request'];
const TAG = 'Lawcheck checks your coding agent\'s edits against the architecture rules you write down.';

function scenesOf(mark) {
  return [
    { len: 2.6, flow: null, caption: '', mid: true, draw: (t) => `
    <div class="who">
      <div ${show(t, 0)}>${mark.replace('<svg', '<svg class="mark"')}</div>
      <div class="what" style="font-size:clamp(26px,3.3vw,48px);font-weight:800;line-height:1.15" ${show(t, 0.1)}>${TAG}</div>
      <div class="agents" ${show(t, 0.7)}><b>Works with</b><span>Claude Code</span><span>Codex</span><span>Copilot CLI</span></div>
    </div>` },
    { len: 5.0, flow: null, caption: 'In my pilot, the agent imported the HTTP layer into the business logic in 8 of 20 sessions, and every test passed.', draw: (t) => `
    <div class="num bad" style="max-width:820px;margin:0 auto;width:100%" ${show(t, 0.1)}>
      <div class="lbl" style="margin:0 0 6px;font-weight:700;color:var(--lc-fail)">A small pilot: the same prompt, 20 sessions, no rule written down</div>
      <div class="big">8 of 20</div>
      <div class="lbl">imported the HTTP layer into the business logic. All 10 tests still passed.</div>
      <div class="mono src" ${show(t, 0.8)}><span class="k">import</span> { formatMoney } <span class="k">from</span> <span class="s">"../api/format.ts"</span>;</div>
    </div>
    <div class="lbl" style="text-align:center;font-size:clamp(14px,1.25vw,19px);color:var(--lc-text-muted)" ${show(t, 1.8)}>A pilot of real Claude Code sessions on 2026-11-23: one prompt, one repository, one model.</div>` },
    { len: 5.0, flow: null, caption: 'Say the business logic must not import the HTTP layer, in every language of your repository.', mid: true, draw: (t) => `
    <div class="folders">
      <div class="group core" ${show(t, 0)}><div class="name">business logic</div><div class="path">src/core</div><div class="langs"><span>loyalty.ts</span><span>pricing.py</span></div></div>
      <div class="ban" ${show(t, 0.6)}><div class="arrow">──────▶</div><div class="must">✕</div></div>
      <div class="group api" ${show(t, 0)}><div class="name">HTTP</div><div class="path">src/api</div><div class="langs"><span>format.ts</span><span>money.py</span></div></div>
    </div>
    <div class="lbl" style="text-align:center;font-size:clamp(18px,1.8vw,27px);font-weight:800;color:var(--lc-fail)" ${show(t, 1.0)}>The business logic must not import HTTP.</div>` },
    { len: 8.6, flow: null, caption: (t) => (t < 3.4 ? 'You can state the rule in CLAUDE.md, in your linter, or in the law.' : 'Lawcheck\'s plugin checks while your agent works. Lawcheck checks again in CI.'), draw: (t) => {
      const broke = t >= 3.4;
      return `
    <div class="three-col">
      <div class="card" ${show(t, 0)}>
        <div class="h fname">CLAUDE.md</div>
        <div class="txt">The business logic in src/core must not import the HTTP layer in src/api.</div>
        ${broke ? `<div class="outcome quiet" ${show(t, 3.5, 0.3)}><span class="dot"></span>The agent reads it. Claude Code does not check the code against it.</div>` : ''}
      </div>
      <div class="card" ${show(t, 0.3)}>
        <div class="h fname">Your linter</div>
        <div class="txt">eslint-plugin-boundaries for TypeScript, import-linter for Python: one tool per language.</div>
        ${broke ? `<div class="outcome quiet" ${show(t, 3.8, 0.3)}><span class="dot"></span>Checks in CI. Inside the agent's turn, only with a hook you write.</div>` : ''}
      </div>
      <div class="card law" ${show(t, 0.6)}>
        <div class="h fname">.lawcheck/law.yaml</div>
        <div class="mono" style="font-size:clamp(13px,1.15vw,17px)">${['core:', '  paths: ["src/core/**"]', '  may_use: [core]', '  rules: [no-clock]'].map((l) => `<div>${yamlLine(l)}</div>`).join('')}</div>
        <div class="txt" style="margin-top:6px">One law reads imports and other uses in 12 languages.</div>
        ${broke ? `<div class="outcome loud" ${show(t, 4.1, 0.3)}><span class="dot"></span>Checks while the agent writes code, again before it finishes, and in CI.</div>` : ''}
      </div>
    </div>`;
    } },
    { len: 9.0, flow: (t) => (t < 1.0 ? [0] : [1]), bad: true, flash: 1.0, caption: 'After each edit, Lawcheck tells your agent what broke the rules.', draw: (t) => {
      const one = t >= 1.0;
      const two = t >= 3.2;
      const row = (no, code, on) => `<div class="ln ${on ? 'err' : ''}"><span class="no">${no}</span><span class="src">${tsLine(code)}</span></div>`;
      const err = (at, real, gloss) => `<div class="err-row" ${show(t, at, 0.25)}><span class="gloss">${gloss}</span><span class="real2">${real}</span></div>`;
      return `
    <div class="card" ${show(t, 0)}>
      <div class="h">Your coding agent wrote <span class="f">src/core/loyalty.ts</span></div>
      <div class="code mono">${row(1, 'import { formatMoney } from "../api/format.ts";', one)}<div class="ln gap"><span class="no"></span><span class="src">…</span></div>${row(9, '  const today = new Date();', two)}</div>
    </div>
    ${one ? `<div class="verdict" ${show(t, 1.0, 0.2)}>
      <div class="by">${mark} Lawcheck, after the edit</div>
      ${err(1.0, 'src/core/loyalty.ts:1  <b>error[forbidden-use]</b>  core may not use api (src/api/format.ts); its may_use is [core]', 'imports the HTTP layer')}
      ${two ? err(3.2, 'src/core/loyalty.ts:9  <b>error[no-clock]</b>  reads the clock', 'calls new Date()') : ''}
    </div>` : ''}
    ${t >= 5.2 ? `<div class="langrow" ${show(t, 5.2)}>${['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'Kotlin', 'C#', 'C', 'C++', 'PHP', 'Ruby'].map((x) => `<span>${x}</span>`).join('')}</div>` : ''}`;
    } },
    { len: 5.0, flow: [2], caption: 'The agent fixes the code. The check passes.', draw: (t) => `
    <div class="card" ${show(t, 0)}>
      <div class="h">Before</div>
      <div class="mono" style="font-size:clamp(14px,1.5vw,22px)"><div class="del-line">${tsLine('import { formatMoney } from "../api/format.ts";')}</div><div class="del-line" style="margin-top:6px">${tsLine('  const today = new Date();')}</div></div>
      <div class="h" style="margin-top:14px">After</div>
      <div class="mono" style="font-size:clamp(14px,1.5vw,22px)"><div class="ins-line">${tsLine('import { formatMoney } from "./money.ts";')}</div><div class="ins-line" style="margin-top:6px">${tsLine('  const today = now;')}</div></div>
    </div>
    ${t > 1.0 ? `<div class="verdict ok" ${show(t, 1.0, 0.2)}><div class="by">${mark} Lawcheck, after the edit <span class="chip green">runs on your machine, no AI, free</span></div><div class="head pass">lawcheck: PASS</div></div>` : ''}` },
    { len: 5.4, flow: [], caption: 'Rules written in prose: an AI model you pick reads them, only when you ask, on your own account.', draw: (t) => {
      const bot = (name, p) => `<span class="bot-chip ${p >= 1 ? 'done' : ''}">${p >= 1 ? '<span class="pass" style="width:24px;text-align:center;font-weight:800">✓</span>' : `<span style="display:flex;transform:translateY(${(Math.sin(t * 6 + name.length) * 1.5).toFixed(1)}px)">${ROBOT}</span>`}${p >= 1 ? `${name} follows the rule` : `the model reads ${name}`}${p >= 1 ? '' : `<span class="bar"><i style="width:${(p * 100).toFixed(0)}%"></i></span>`}</span>`;
      return `
    <div class="card" ${show(t, 0)}><div class="h">A rule written in prose</div><div style="font-size:clamp(17px,1.6vw,24px);line-height:1.4">Every error message a caller can see says what happened and what the caller can do next.</div></div>
    <div class="card" ${show(t, 0.4)}>
      <div class="mono"><div class="cmd">lawcheck check --review</div></div>
      ${t > 0.9 ? `<div class="bots" style="margin-top:12px" ${show(t, 0.9)}>${bot('loyalty.ts', clamp((t - 0.9) / 2.4))}${bot('money.ts', clamp((t - 1.2) / 2.4))}</div>` : ''}
    </div>`;
    } },
    { len: 5.4, flow: [3], caption: 'On every pull request, the same check runs in CI.', draw: (t) => {
      const ok = t >= 2.6;
      return `
    <div class="card" ${show(t, 0)}>
      <div class="h">Pull request · Add a loyalty discount</div>
      <div class="prrow"><span class="mark-c ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'}</span><div><div class="pt">lawcheck ${ok ? 'passed' : 'failed'}</div><div class="mono pd">${ok ? '<span class="pass">lawcheck: PASS  3 changed files (against origin/main)</span>' : 'src/core/loyalty.ts:1  <span class="fail">error[forbidden-use]</span>  core may not use api (src/api/format.ts); its may_use is [core]'}</div></div></div>
      ${ok ? `<div class="lbl" style="margin-top:12px;font-size:clamp(15px,1.3vw,19px)" ${show(t, 2.6)}>After the fix, the same pull request passes.</div>` : ''}
    </div>`;
    } },
    { len: 9.0, flow: null, caption: '', mid: true, draw: (t) => `
    <div class="end">
      <div class="what" style="font-size:clamp(24px,2.9vw,42px);font-weight:800;max-width:1000px;line-height:1.2" ${show(t, 0)}>Write a rule once. Stop having to remember it.</div>
      <div class="lbl" style="font-size:clamp(16px,1.5vw,22px);color:var(--lc-brand);font-weight:700" ${show(t, 0.2)}>One law. 12 languages. In your agent's turn and in CI.</div>
      <div class="enforce" ${show(t, 0.3)}><span><b>While it writes</b> file and line to the agent</span><span><b>Before the agent finishes</b> sent back to fix it, up to 3 times</span><span><b>Pull request</b> fails in CI</span></div>
      <ol class="steps3">
        <li ${show(t, 0.5)}><span class="n">1</span><span>Install the tool</span><code>${INSTALL}</code></li>
        <li ${show(t, 0.9)}><span class="n">2</span><span>Add the plugin to your agent, then start a new session</span><code>claude plugin marketplace add krzysztofdudek/Lawcheck</code><code>claude plugin install lawcheck@lawcheck-marketplace</code></li>
        <li ${show(t, 1.3)}><span class="n">3</span><span>Create the law, and let your agent describe your folders</span><code>lawcheck init</code><code>/lawcheck:setup</code></li>
        <li ${show(t, 1.6)}><span class="n">4</span><span>Check</span><code>lawcheck check --base main</code></li>
      </ol>
      <div class="lbl" style="font-size:clamp(14px,1.2vw,18px);color:var(--lc-text-muted)" ${show(t, 1.7)}>Codex and Copilot CLI install the same plugin with their own two commands.</div>
    </div>` },
  ];
}

// mark is brand/mark.svg with aria-hidden="true": the hero repeats it beside text that names it.
export function hero(mark, { docs, github }) {
  const scenes = scenesOf(mark);
  const starts = [];
  let total = 0;
  for (const scene of scenes) {
    starts.push(total);
    total += scene.len;
  }
  const length = total;

  function frame(time) {
    const t = ((time % length) + length) % length;
    let i = 0;
    starts.forEach((s, k) => {
      if (t >= s) i = k;
    });
    const local = t - starts[i];
    const sc = scenes[i];
    const fadeOut = i === scenes.length - 1 ? clamp((sc.len - local) / 0.5) : i === scenes.length - 2 ? clamp((sc.len - local) / 0.35) : 1;
    const lit = sc.flow === null ? null : typeof sc.flow === 'function' ? sc.flow(local) : sc.flow;
    const cap = typeof sc.caption === 'function' ? sc.caption(local + 0.3) : sc.caption;
    const f = sc.flash === undefined ? -1 : local + 0.3 - sc.flash;
    return {
      flow: FLOW.map((name, k) => `${k ? '<i>→</i>' : ''}<span class="${lit && lit.includes(k) ? `on ${sc.bad && k === 1 ? 'bad' : ''}` : ''}">${name}</span>`).join(''),
      flowShown: lit !== null,
      caption: cap ? `<span>${cap}</span>` : '',
      scene: sc.draw(local + 0.3),
      mid: Boolean(sc.mid),
      opacity: fadeOut.toFixed(3),
      flash: f >= 0 && f < 0.5 ? (f < 0.06 ? (f / 0.06) * 0.22 : 0.22 * (1 - (f - 0.06) / 0.44)).toFixed(3) : '0',
    };
  }

  function markup(time = 0) {
    const first = frame(time);
    return `<header class="site">
    <a class="brand" href="/">${mark}Lawcheck</a>
    <span class="grow"></span>
    <div class="install"><code data-hero="cmd" tabindex="0">${INSTALL}</code><button type="button" data-hero="copy">Copy</button></div>
    <nav class="links" aria-label="Lawcheck"><a href="${docs}">Docs</a><a href="${github}">GitHub</a><button class="ctl" type="button" data-hero="pause" aria-label="Pause the animation" title="Pause the animation">❚❚</button></nav>
  </header>
  <div class="stage">
    <div class="flow" data-hero="flow" aria-hidden="true" style="visibility:${first.flowShown ? 'visible' : 'hidden'}">${first.flow}</div>
    <p class="caption" data-hero="caption" aria-live="polite" style="opacity:${first.opacity}">${first.caption}</p>
    <div class="${first.mid ? 'scene mid' : 'scene'}" data-hero="scene" style="opacity:${first.opacity}">${first.scene}</div>
  </div>
  <div class="flash" data-hero="flash"></div>`;
  }

  return { length, scenes, starts, frame, markup };
}

export function startHero(root, model, search) {
  const part = (name) => root.querySelector(`[data-hero="${name}"]`);
  const last = {};
  const put = (name, html) => {
    if (last[name] !== html) {
      last[name] = html;
      part(name).innerHTML = html;
    }
  };
  function render(time) {
    const f = model.frame(time);
    put('flow', f.flow);
    part('flow').style.visibility = f.flowShown ? 'visible' : 'hidden';
    put('caption', f.caption);
    part('caption').style.opacity = f.opacity;
    put('scene', f.scene);
    part('scene').className = f.mid ? 'scene mid' : 'scene';
    part('scene').style.opacity = f.opacity;
    part('flash').style.opacity = f.flash;
  }

  let start = performance.now();
  let paused = false;
  let pausedAt = 0;
  let seeking = false;
  let stopped = false;
  function tick(now) {
    if (seeking || paused || stopped) return;
    render((now - start) / 1000);
    requestAnimationFrame(tick);
  }
  function button(playing) {
    const label = playing ? 'Pause the animation' : 'Play the animation';
    part('pause').textContent = playing ? '❚❚' : '▶';
    part('pause').setAttribute('aria-label', label);
    part('pause').title = label;
  }
  part('pause').addEventListener('click', () => {
    if (paused || seeking) {
      paused = false;
      seeking = false;
      root.classList.remove('seeking');
      start = performance.now() - pausedAt * 1000;
      button(true);
      requestAnimationFrame(tick);
    } else {
      paused = true;
      pausedAt = (performance.now() - start) / 1000;
      button(false);
    }
  });
  part('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(part('cmd').textContent);
      part('copy').textContent = 'Copied';
      setTimeout(() => (part('copy').textContent = 'Copy'), 1600);
    } catch {}
  });

  const seek = (t) => {
    seeking = true;
    root.classList.add('seeking');
    pausedAt = Math.min(t, model.length - 0.001);
    render(pausedAt);
  };
  const tallest = () => {
    root.classList.add('measure');
    let most = 0;
    model.scenes.forEach((scene, at) => {
      render(model.starts[at] + scene.len - 0.6);
      most = Math.max(most, root.scrollHeight);
    });
    root.classList.remove('measure');
    render(pausedAt);
    return most;
  };
  window.heroSeek = seek;
  window.heroLength = model.length;
  window.heroTallest = tallest;

  if (search.has('embed')) {
    root.classList.add('embed');
    part('caption').removeAttribute('aria-live');
  }
  const seekTo = search.get('t');
  if (seekTo !== null) seek(Number(seekTo));
  else if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    paused = true;
    pausedAt = model.length - 0.5;
    button(false);
    render(pausedAt);
  } else requestAnimationFrame(tick);

  return () => {
    stopped = true;
  };
}
