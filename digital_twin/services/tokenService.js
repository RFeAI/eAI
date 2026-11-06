function createTokenService(db) {
  const balance = db.prepare('SELECT token_balance FROM users WHERE id = ? AND is_registered = 1');
  const mint = db.prepare(`
    UPDATE users SET token_balance = token_balance + ?
    WHERE id = ? AND is_registered = 1
  `);
  const burn = db.prepare(`
    UPDATE users SET token_balance = token_balance - ?
    WHERE id = ? AND is_registered = 1 AND token_balance >= ?
  `);

  function getBalance(userId) {
    const user = balance.get(userId);
    if (!user) throw Object.assign(new Error('Account not found.'), { status: 401 });
    return user.token_balance;
  }

  function mintTokens(userId, action) {
    if (!['extension', 'terminal'].includes(action)) throw new Error('Unsupported token action.');
    if (Number(mint.run(10, userId).changes) !== 1) {
      throw Object.assign(new Error('Account not found.'), { status: 401 });
    }
    return getBalance(userId);
  }

  function burnTokens(userId, amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid token amount.');
    if (Number(burn.run(amount, userId, amount).changes) !== 1) {
      getBalance(userId);
      throw Object.assign(new Error('Insufficient token balance.'), { status: 402 });
    }
    return getBalance(userId);
  }

  return { getBalance, mintTokens, burnTokens };
}

module.exports = { createTokenService };
