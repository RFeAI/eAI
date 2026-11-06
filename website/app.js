(() => {
  const $ = (selector) => document.querySelector(selector);
  const commands = {
    git: ['git status --short', 'git log -5 --oneline'],
    dev: ['node --version', 'npm --version', 'python --version'],
  };
  let token = null;
  let apiOrigin = '';

  try {
    const savedOrigin = sessionStorage.getItem('eai-api-origin');
    if (savedOrigin) $('#api-origin').value = savedOrigin;
  } catch {
    // The origin is optional; browser storage may be disabled.
  }

  function setCommands() {
    $('#command').replaceChildren(...commands[$('#system-type').value].map((command) => {
      const option = document.createElement('option');
      option.value = command;
      option.textContent = command;
      return option;
    }));
  }

  async function request(path, options = {}) {
    apiOrigin = $('#api-origin').value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(apiOrigin)) throw new Error('Bitte eine gültige API-Adresse eingeben.');
    try { sessionStorage.setItem('eai-api-origin', apiOrigin); } catch { /* Optional, non-secret preference. */ }
    const response = await fetch(`${apiOrigin}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Anfrage fehlgeschlagen (${response.status}).`);
    return body;
  }

  function showAccount(user) {
    $('#account-state').hidden = true;
    $('#account-details').hidden = false;
    $('#logout').hidden = false;
    $('#account-name').textContent = user.username;
    $('#account-tokens').textContent = String(user.tokenBalance);
  }

  async function authenticate(mode) {
    const username = $('#username').value.trim();
    const payload = { username, password: $('#password').value };
    if (mode === 'register' && username === 'RFOF-NETWORK') {
      payload.genesisPassword = $('#genesis-password').value;
    }
    const result = await request(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
    if (mode === 'login') {
      token = result.token;
      showAccount(result.user);
    } else {
      $('#auth-message').textContent = 'Registrierung erfolgreich. Bitte jetzt anmelden.';
    }
    $('#password').value = '';
    $('#genesis-password').value = '';
  }

  $('#system-type').addEventListener('change', setCommands);
  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#auth-message').textContent = '';
    try { await authenticate('register'); } catch (error) { $('#auth-message').textContent = error.message; }
  });
  $('#login').addEventListener('click', async () => {
    $('#auth-message').textContent = '';
    try { await authenticate('login'); } catch (error) { $('#auth-message').textContent = error.message; }
  });
  $('#logout').addEventListener('click', () => {
    token = null;
    $('#account-state').hidden = false;
    $('#account-details').hidden = true;
    $('#logout').hidden = true;
    $('#account-state').textContent = 'Abgemeldet. Sitzungen bleiben nur im Arbeitsspeicher dieser Seite.';
    $('#terminal-output').textContent = 'Warte auf Anmeldung…';
  });
  $('#terminal-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#terminal-output').textContent = 'Befehl wird ausgeführt…';
    try {
      const result = await request('/api/terminal', {
        method: 'POST',
        body: JSON.stringify({ systemType: $('#system-type').value, command: $('#command').value }),
      });
      $('#terminal-output').textContent = result.output || '(keine Ausgabe)';
    } catch (error) {
      $('#terminal-output').textContent = error.message;
    }
  });
  setCommands();
})();
