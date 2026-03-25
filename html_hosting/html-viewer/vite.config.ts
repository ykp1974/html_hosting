import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'local-html-api',
      configureServer(server) {
        const rootDir = path.resolve(process.cwd(), '..');
        const statusFile = path.join(rootDir, 'checked_status.json');

        server.middlewares.use(async (req, res, next) => {
          try {
            if (!req.url) return next();
            const parsedUrl = parse(req.url, true);
            const pathname = parsedUrl.pathname;

            if (pathname === '/api/files' && req.method === 'GET') {
              const htmlFiles: string[] = [];
              
              async function scanDir(dir: string) {
                const entries = await fsPromises.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const fullPath = path.join(dir, entry.name);
                  if (entry.isDirectory()) {
                    // Skip node_modules, .git, public, src, html-viewer
                    if (!['node_modules', '.git', 'public', 'src', 'html-viewer'].includes(entry.name)) {
                      await scanDir(fullPath);
                    }
                  } else if (entry.isFile() && entry.name.endsWith('.html')) {
                    // Store route relative to rootDir
                    htmlFiles.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
                  }
                }
              }
              
              await scanDir(rootDir);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(htmlFiles));
              return;
            }

            if (pathname === '/api/status' && req.method === 'GET') {
              let status = {};
              if (fs.existsSync(statusFile)) {
                status = JSON.parse(await fsPromises.readFile(statusFile, 'utf-8'));
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(status));
              return;
            }

            if (pathname === '/api/status' && req.method === 'POST') {
              let body = '';
              req.on('data', chunk => { body += chunk.toString(); });
              req.on('end', async () => {
                const data = JSON.parse(body); // { filePath: string, checked: boolean }
                let status: Record<string, boolean> = {};
                if (fs.existsSync(statusFile)) {
                  status = JSON.parse(await fsPromises.readFile(statusFile, 'utf-8'));
                }
                status[data.filePath] = data.checked;
                await fsPromises.writeFile(statusFile, JSON.stringify(status, null, 2), 'utf-8');
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              });
              return;
            }

            if (pathname === '/api/serve-html' && req.method === 'GET') {
              const fileParam = parsedUrl.query.file as string;
              if (!fileParam) {
                res.statusCode = 400;
                res.end('Missing file parameter');
                return;
              }
              const fullPath = path.join(rootDir, fileParam);
              const normalizedRootDir = path.normalize(rootDir);
              const normalizedFullPath = path.normalize(fullPath);
              
              // Security check - ensure the file is within rootDir and is an HTML file
              if (!normalizedFullPath.startsWith(normalizedRootDir) || !normalizedFullPath.endsWith('.html')) {
                 res.statusCode = 403;
                 res.end('Forbidden');
                 return;
              }
              if (fs.existsSync(fullPath)) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                fs.createReadStream(fullPath).pipe(res);
              } else {
                res.statusCode = 404;
                res.end('Not found');
              }
              return;
            }

            next();
          } catch (err: any) {
            console.error('API Error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      }
    }
  ],
})
