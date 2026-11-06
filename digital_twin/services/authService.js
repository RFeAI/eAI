const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;

function safeEqual(left, right) {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createAuthService({ users, db, genesisPassword, jwtSecret }) {
  const markGenesisClaimed = db.prepare(`
    UPDATE users SET password_hash = ?, is_registered = 1, genesis_locked = 1
    WHERE username = ? AND is_genesis = 1 AND is_registered = 0 AND genesis_locked = 0
  `);

  async function register(username, password, suppliedGenesisPassword) {
    if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
      throw Object.assign(new Error('Invalid username.'), { status: 400 });
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw Object.assign(new Error('Password must be between 12 and 128 characters.'), { status: 400 });
    }
    if (username.toUpperCase() === 'RFOF-NETWORK' && username !== 'RFOF-NETWORK') {
      throw Object.assign(new Error('The Genesis username is reserved.'), { status: 409 });
    }

    if (username === 'RFOF-NETWORK') {
      if (!safeEqual(String(suppliedGenesisPassword || ''), genesisPassword)) {
        throw Object.assign(new Error('Genesis authorization failed.'), { status: 403 });
      }
      const passwordHash = await users.hashPassword(password);
      const result = markGenesisClaimed.run(passwordHash, username);
      if (Number(result.changes) !== 1) {
        throw Object.assign(new Error('The Genesis account has already been claimed or is unavailable.'), { status: 409 });
      }
      return users.findByUsername(username);
    }

    if (users.findByUsername(username)) {
      throw Object.assign(new Error('Username is unavailable.'), { status: 409 });
    }
    const passwordHash = await users.hashPassword(password);
    try {
      users.create(username, passwordHash);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed: users\.username/.test(error.message))) {
        throw Object.assign(new Error('Username is unavailable.'), { status: 409 });
      }
      throw error;
    }
    return users.findByUsername(username);
  }

  async function login(username, password) {
    if (typeof username !== 'string' || username.length > 32 || typeof password !== 'string' || password.length > 128) {
      throw Object.assign(new Error('Invalid username or password.'), { status: 401 });
    }
    const user = users.findByUsername(username);
    if (!user || !user.is_registered || !(await users.verifyPassword(password, user.password_hash))) {
      throw Object.assign(new Error('Invalid username or password.'), { status: 401 });
    }
    const token = jwt.sign(
      { sub: String(user.id), username: user.username },
      jwtSecret,
      { expiresIn: '15m', issuer: 'eai-digital-twin', audience: 'eai-ui' },
    );
    return { token, user: publicUser(user) };
  }

  function verifyToken(token) {
    return jwt.verify(token, jwtSecret, {
      issuer: 'eai-digital-twin',
      audience: 'eai-ui',
    });
  }

  return { register, login, verifyToken };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    isGenesis: Boolean(user.is_genesis),
    tokenBalance: user.token_balance,
  };
}

module.exports = { createAuthService, publicUser };
