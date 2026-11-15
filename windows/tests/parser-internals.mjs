// Instrument actual pure parser source in tests only; production exports stay unchanged.
import fs from 'node:fs/promises';
export async function parserInternals(path = new URL('../src/core.js', import.meta.url)) {
  const source = await fs.readFile(path, 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { fields, values };').toString('base64'));
}
