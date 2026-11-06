(() => {
  const $ = (selector) => document.querySelector(selector);
  const commands = {
    git: ['git --version'],
    dev: ['node --version', 'npm --version', 'python --version'],
    windows: ['Windows/PowerShell nicht verfügbar'],
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
    $('#workspace-panel').hidden = true;
    $('#terminal-form').hidden = true;
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
