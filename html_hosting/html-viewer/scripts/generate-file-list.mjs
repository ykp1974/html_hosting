import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../'); // html_hosting folder
const docsDir = path.join(rootDir, 'Docs');
const outputFile = path.join(__dirname, '../public/files.json');

async function scanDocs(dir) {
  const results = [];
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await scanDocs(fullPath);
      results.push(...subFiles);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      // Store path relative to rootDir
      results.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return results;
}

async function main() {
  try {
    console.log('Scanning Docs directory:', docsDir);
    if (!fs.existsSync(docsDir)) {
      console.error('Docs directory not found!');
      process.exit(1);
    }
    const files = await scanDocs(docsDir);
    await fsPromises.writeFile(outputFile, JSON.stringify(files, null, 2), 'utf-8');
    console.log(`Successfully generated ${outputFile} with ${files.length} files.`);
  } catch (err) {
    console.error('Error generating file list:', err);
    process.exit(1);
  }
}

main();
