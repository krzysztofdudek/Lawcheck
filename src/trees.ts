import { Worker } from 'node:worker_threads';
import type { FlatTree } from './flat.js';
import { cores } from './limits.js';
import { alive, poolBusy, poolIdle } from './progress.js';

// What a parse of the pool gives when the pool has ended: the caller then parses the file itself, in its turn and under the step that names the file.
export const ALONE = Symbol('alone');

// How long one file may take in the pool. A parse past it ends the pool, and the file is parsed again under its own step, where the limit of a step names it.
const PARSE_MS = 5_000;

interface Job {
  id: number;
  path: string;
  content: string;
  language?: string;
  settle: (tree: FlatTree | null | typeof ALONE) => void;
  timer?: NodeJS.Timeout;
}

// The threads that parse the trees of a run, at most as many as the machine gives cores. The memory guard of the tool reads the memory of the whole process, so it cannot tell which of several files parsed at once takes too much: while the pool works it asks the pool to end instead (src/progress.ts), and so does a parse that takes too long or a thread that fails. Every file then goes through the tool's own parse, one at a time, where a file that takes too much memory or time is named as before.
export class ParsePool {
  ended = false;
  started = false;
  private readonly idle: Worker[] = [];
  private readonly all = new Set<Worker>();
  private readonly waiting: Job[] = [];
  private readonly running = new Map<Worker, Job>();
  private next = 0;

  constructor(
    private readonly grammarDir: string,
    private readonly size = cores(),
  ) {}

  parse(path: string, content: string, language: string | undefined): Promise<FlatTree | null | typeof ALONE> {
    if (this.ended) return Promise.resolve(ALONE);
    return new Promise((settle) => {
      this.waiting.push({ id: this.next++, path, content, ...(language === undefined ? {} : { language }), settle });
      this.started = true;
      poolBusy(() => this.end());
      this.pump();
    });
  }

  private pump(): void {
    while (this.waiting.length > 0) {
      const worker = this.idle.pop() ?? (this.all.size < this.size ? this.start() : null);
      if (worker === null) return;
      const job = this.waiting.shift()!;
      this.running.set(worker, job);
      job.timer = setTimeout(() => void this.end(), PARSE_MS);
      worker.postMessage({ id: job.id, path: job.path, content: job.content, language: job.language });
    }
  }

  private start(): Worker {
    const worker = new Worker(new URL('./parse.js', import.meta.url), { workerData: { grammarDir: this.grammarDir }, stdout: false, stderr: false });
    this.all.add(worker);
    worker.on('message', (message: { id: number; tree: FlatTree | null }) => {
      const job = this.running.get(worker);
      if (job === undefined || job.id !== message.id) return;
      clearTimeout(job.timer);
      this.running.delete(worker);
      this.idle.push(worker);
      alive();
      job.settle(message.tree);
      if (this.running.size === 0 && this.waiting.length === 0) poolIdle();
      else this.pump();
    });
    worker.on('error', () => void this.end());
    worker.on('exit', () => {
      if (!this.ended) void this.end();
    });
    // After the listeners, since a listener for messages holds the process again: an idle pool must not keep a finished command from ending.
    worker.unref();
    return worker;
  }

  // Ends every thread and gives each file still in the pool back to its caller.
  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    const left = [...this.running.values(), ...this.waiting];
    for (const job of left) clearTimeout(job.timer);
    this.running.clear();
    this.waiting.length = 0;
    await Promise.all([...this.all].map((worker) => worker.terminate().catch(() => undefined)));
    this.all.clear();
    poolIdle();
    for (const job of left) job.settle(ALONE);
  }
}
