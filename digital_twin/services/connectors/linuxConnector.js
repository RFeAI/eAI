const { spawn } = require('node:child_process');

function runReadOnly(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-16_384);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4_096);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `Command exited with code ${code}.`));
      resolve(stdout.trim());
    });
  });
}

module.exports = { runReadOnly };
