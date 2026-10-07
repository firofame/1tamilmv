import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { DEFAULT_URL, scrape } from './scraper.js';

try {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: DEFAULT_URL },
      output: { type: 'string', short: 'o' },
      concurrency: { type: 'string', default: '3' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write('Usage: node cli.js [--url URL] [--output movies.json] [--concurrency 3]\n');
  } else {
    const result = await scrape({
      url: values.url,
      concurrency: Number(values.concurrency),
    });
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (values.output) await writeFile(values.output, json, 'utf8');
    else process.stdout.write(json);
    if (result.errors.length) {
      for (const error of result.errors) process.stderr.write(`${error.url}: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
