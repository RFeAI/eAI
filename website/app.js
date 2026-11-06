(() => {
  const $ = (selector) => document.querySelector(selector);
  const commands = {
    git: ['git --version'],
    dev: ['node --version', 'npm --version', 'python --version'],
    windows: ['Windows/PowerShell nicht verfügbar'],
  };
  let token = null;
  let apiOrigin = '';
  let sessionOrigin = null;

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
    let url;
    try { url = new URL($('#api-origin').value.trim()); } catch { throw new Error('Bitte eine gültige API-Adresse eingeben.'); }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
      throw new Error('Bitte eine HTTPS-API-Origin ohne Pfad eingeben (HTTP nur für localhost).');
    }
    apiOrigin = url.origin;
    if (token && apiOrigin !== sessionOrigin) throw new Error('Für einen anderen API-Server bitte erst abmelden.');
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
    $('#guest-panel').hidden = true;
    $('#extension-controls').hidden = false;
    $('#workspace-panel').hidden = false;
    $('#terminal-form').hidden = false;
    loadDirectory('').catch((error) => { $('#workspace-message').textContent = error.message; });
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
      sessionOrigin = apiOrigin;
      $('#api-origin').disabled = true;
      showAccount(result.user);
    } else {
      $('#auth-message').textContent = 'Registrierung erfolgreich. Bitte jetzt anmelden.';
    }
    $('#password').value = '';
    $('#genesis-password').value = '';
  }

  const guestLog = $('#guest-log');
  const guestInput = $('#guest-input');
  let guestStep = null;

  function guestPrint(text, className) {
    const line = document.createElement('div');
    if (className) line.className = className;
    line.textContent = text;
    guestLog.append(line);
    guestLog.scrollTop = guestLog.scrollHeight;
  }

  function guestAsk(step, label, secret) {
    guestStep = step;
    guestInput.type = secret ? 'password' : 'text';
    guestInput.autocomplete = 'off';
    guestPrint(label);
  }

  function guestReset() {
    guestStep = null;
    guestInput.type = 'text';
  }

  async function guestFinish(mode, data) {
    try {
      $('#username').value = data.username;
      $('#password').value = data.password;
      $('#genesis-password').value = data.genesisPassword || '';
      await authenticate(mode);
      guestPrint(mode === 'login' ? 'Angemeldet.' : 'Registriert. Jetzt "login" eingeben.');
    } catch (error) {
      guestPrint(error.message, 'err');
    } finally {
      $('#password').value = '';
      $('#genesis-password').value = '';
    }
  }

  async function guestCommand(line) {
    const [name, ...args] = line.trim().split(/\s+/);
    const command = (name || '').toLowerCase();
    if (command === 'help') {
      guestPrint('connect <https://adresse>  Backend verbinden\nstatus                    Backend prüfen\nregister <name>           Konto anlegen\nlogin <name>              Anmelden\nAlles andere ist erst nach der Anmeldung verfügbar.');
    } else if (command === 'connect') {
      $('#api-origin').value = args[0] || '';
      guestPrint(`API-Adresse gesetzt. "status" prüft die Verbindung.`);
    } else if (command === 'status') {
      try {
        const result = await request('/api/health');
        guestPrint(`Backend erreichbar: ${result.status}`);
      } catch (error) {
        guestPrint(`Backend nicht erreichbar: ${error.message}`, 'err');
      }
    } else if (command === 'login' || command === 'register') {
      if (!args[0]) { guestPrint(`Benutzung: ${command} <name>`, 'err'); return; }
      guestStep = { mode: command, username: args[0] };
      guestAsk(guestStep, 'Passwort:', true);
    } else if (command) {
      guestPrint('Nicht angemeldet: nur help, connect, status, login, register.', 'err');
    }
  }

  $('#guest-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = guestInput.value;
    guestInput.value = '';
    if (guestStep && !guestStep.password) {
      guestPrint('Passwort: ********', 'cmd');
      guestStep.password = value;
      if (guestStep.mode === 'register' && guestStep.username === 'RFOF-NETWORK') {
        guestAsk(guestStep, 'Genesis-Passwort:', true);
        return;
      }
    } else if (guestStep) {
      guestPrint('Genesis-Passwort: ********', 'cmd');
      guestStep.genesisPassword = value;
    } else {
      guestPrint(`eai> ${value}`, 'cmd');
      await guestCommand(value);
      return;
    }
    const data = guestStep;
    guestReset();
    await guestFinish(data.mode, data);
  });
  guestPrint('eAI Anmelde-Konsole. "help" zeigt die Befehle.');

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
    sessionOrigin = null;
    $('#api-origin').disabled = false;
    $('#account-state').hidden = false;
    $('#account-details').hidden = true;
    $('#logout').hidden = true;
    $('#account-state').textContent = 'Abgemeldet. Sitzungen bleiben nur im Arbeitsspeicher dieser Seite.';
    $('#terminal-output').textContent = 'Warte auf Anmeldung…';
    $('#guest-panel').hidden = false;
    $('#workspace-panel').hidden = true;
    $('#terminal-form').hidden = true;
    $('#extension-controls').hidden = true;
    $('#editor-path').value = '';
    $('#editor-content').value = '';
    $('#file-list').replaceChildren();
    $('#extension-message').textContent = '';
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
      const account = await request('/api/account');
      $('#account-tokens').textContent = String(account.user.tokenBalance);
    } catch (error) {
      $('#terminal-output').textContent = error.message;
    }
  });
  $('#create-extension').addEventListener('click', async () => {
    const button = $('#create-extension');
    button.disabled = true;
    $('#extension-message').textContent = 'Workspace wird gestartet…';
    try {
      const result = await request('/api/extensions', { method: 'POST', body: '{}' });
      $('#extension-message').textContent = result.created ? 'Workspace gestartet.' : 'Workspace ist bereits eingerichtet.';
      $('#account-tokens').textContent = String(result.tokenBalance);
      await loadDirectory('');
    } catch (error) {
      $('#extension-message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  let currentDirectory = '';
  function joinPath(directory, name) {
    return directory ? `${directory}/${name}` : name;
  }
  function updateDirectoryLabel() {
    $('#workspace-path').textContent = currentDirectory ? `/${currentDirectory}` : '/';
  }
  async function loadDirectory(directory = currentDirectory) {
    const result = await request(`/api/workspace/tree?path=${encodeURIComponent(directory)}`);
    currentDirectory = directory;
    updateDirectoryLabel();
    const list = $('#file-list');
    list.replaceChildren();
    for (const entry of result.entries) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file-entry';
      button.textContent = `${entry.type === 'directory' ? '▸ ' : '· '}${entry.name}`;
      if (entry.type === 'directory') {
        button.addEventListener('click', () => loadDirectory(entry.path).catch(showWorkspaceError));
      } else if (entry.type === 'file') {
        button.addEventListener('click', () => openFile(entry.path));
      } else {
        button.disabled = true;
      }
      item.append(button);
      list.append(item);
    }
  }
  async function openFile(filePath) {
    $('#workspace-message').textContent = '';
    try {
      const result = await request(`/api/workspace/file?path=${encodeURIComponent(filePath)}`);
      $('#editor-path').value = filePath;
      $('#editor-content').value = result.content;
      $('#workspace-message').textContent = 'Datei geladen.';
    } catch (error) {
      showWorkspaceError(error);
    }
  }
  function showWorkspaceError(error) {
    $('#workspace-message').textContent = error.message;
  }
  $('#refresh-files').addEventListener('click', () => loadDirectory().catch(showWorkspaceError));
  $('#workspace-up').addEventListener('click', () => {
    currentDirectory = currentDirectory.includes('/')
      ? currentDirectory.slice(0, currentDirectory.lastIndexOf('/'))
      : '';
    loadDirectory().catch(showWorkspaceError);
  });
  $('#new-file').addEventListener('click', () => {
    $('#editor-path').value = joinPath(currentDirectory, 'untitled.txt');
    $('#editor-content').value = '';
    $('#workspace-message').textContent = 'Dateipfad festlegen und speichern.';
  });
  $('#save-file').addEventListener('click', async () => {
    try {
      await request('/api/workspace/file', {
        method: 'POST',
        body: JSON.stringify({ path: $('#editor-path').value, content: $('#editor-content').value }),
      });
      $('#workspace-message').textContent = 'Datei gespeichert.';
      const parent = $('#editor-path').value.includes('/')
        ? $('#editor-path').value.slice(0, $('#editor-path').value.lastIndexOf('/'))
        : '';
      await loadDirectory(parent);
    } catch (error) {
      showWorkspaceError(error);
    }
  });
  $('#delete-file').addEventListener('click', async () => {
    const filePath = $('#editor-path').value;
    if (!filePath || !window.confirm(`Datei oder leeren Ordner "${filePath}" löschen?`)) return;
    try {
      await request('/api/workspace/delete', { method: 'POST', body: JSON.stringify({ path: filePath }) });
      $('#editor-path').value = '';
      $('#editor-content').value = '';
      $('#workspace-message').textContent = 'Datei oder leerer Ordner gelöscht.';
      await loadDirectory(currentDirectory);
    } catch (error) {
      showWorkspaceError(error);
    }
  });
  $('#folder-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await request('/api/workspace/folder', {
        method: 'POST',
        body: JSON.stringify({ path: joinPath(currentDirectory, $('#folder-name').value.trim()) }),
      });
      $('#folder-name').value = '';
      $('#workspace-message').textContent = 'Ordner erstellt.';
      await loadDirectory(currentDirectory);
    } catch (error) {
      showWorkspaceError(error);
    }
  });
  setCommands();
  $('#terminal-form').hidden = true;
})();
