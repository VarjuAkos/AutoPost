import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['tests/**/*.test.ts'], fileParallelism: false, env: { AUTOPOST_DATA_DIR: path.resolve(__dirname, '.test-data/unit') } },
});
