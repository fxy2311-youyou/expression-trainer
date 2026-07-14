#!/usr/bin/env node
/**
 * Launch Electron without ELECTRON_RUN_AS_NODE.
 * Cursor terminals inject that env var, which makes require('electron').app undefined.
 */
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
