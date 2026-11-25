import { parentPort, workerData } from 'node:worker_threads';
import { flatten, parserHost } from './flat.js';

// One thread of the pool that parses the trees script rules ask for (src/trees.ts): it parses one file at a time, as the tool itself does, and gives the tree back without a copy.
const host = parserHost((workerData as { grammarDir: string }).grammarDir);

parentPort!.on('message', (job: { id: number; path: string; content: string; language?: string }) => {
  host.withParsedFile(job.path, job.content, flatten, job.language).then(
    (tree) => parentPort!.postMessage({ id: job.id, tree }, [tree.nodes.buffer as ArrayBuffer]),
    () => parentPort!.postMessage({ id: job.id, tree: null }),
  );
});
