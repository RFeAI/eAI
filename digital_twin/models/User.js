const bcrypt = require('bcryptjs');

const COST = 12;

function createUserModel(db) {
  const findByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
  const createStatement = db.prepare(`
    INSERT INTO users (username, password_hash, is_genesis, is_registered, genesis_locked, token_balance)
    VALUES (@username, @passwordHash, @isGenesis, 1, @genesisLocked, 0)
  `);

  return {
    findByUsername: (username) => findByUsername.get(username),
    create: (username, passwordHash, isGenesis = 0) => createStatement.run({
        username,
        passwordHash,
        isGenesis,
        genesisLocked: isGenesis ? 1 : 0,
      }),
    hashPassword: (password) => bcrypt.hash(password, COST),
    verifyPassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
  };
}

module.exports = { createUserModel };
