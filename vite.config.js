import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// 開発時のみ: 描画結果の PNG を受け取って保存する（見た目の確認用）
const shotPlugin = {
  name: 'dev-shot',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      if (req.method !== 'POST') return res.end();
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url, 'http://x');
        const name = (url.searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
        const dir = process.env.SHOT_DIR || path.resolve('.shots');
        fs.mkdirSync(dir, { recursive: true });
        const b64 = Buffer.concat(chunks).toString().replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(b64, 'base64'));
        res.end('ok');
      });
    });
  },
};

export default defineConfig({
  plugins: [shotPlugin],
});
