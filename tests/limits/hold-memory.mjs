// Holds the megabytes it is given, every page written, until it is ended, and says when it holds them.
const megabytes = Number(process.argv[2]);
const held = [];
for (let i = 0; i < megabytes; i++) held.push(Buffer.alloc(1024 * 1024, 1));
process.send('holding');
setInterval(() => held.length, 1_000_000);
