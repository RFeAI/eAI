const COMMANDS = Object.freeze({
  git: [
    { pattern: /^git --version$/, args: ['--version'] },
  ],
  dev: [
    { pattern: /^node --version$/, args: ['--version'] },
    { pattern: /^npm --version$/, args: ['--version'] },
    { pattern: /^python --version$/, args: ['--version'] },
  ],
});

function validateCommand(systemType, command) {
  if (typeof command !== 'string' || command.length > 160) return null;
  const rules = COMMANDS[systemType];
  if (!rules) return null;
  for (const rule of rules) {
    if (rule.pattern.test(command)) {
      return { executable: systemType === 'git' ? 'git' : command.split(' ')[0], args: rule.args };
    }
  }
  return null;
}

module.exports = { validateCommand };
