// RIFT ARENA — auth screen (login / register / admin bootstrap)
import { h, toast } from '../components/ui.js';
import { api, errText, connectWs } from '../network/api.js';
import { state, setToken } from '../state.js';
import { buildShell } from '../app.js';

export function renderAuth(el) {
  document.title = 'RIFT ARENA — Connexion';
  const wrap = h('div', { class: 'auth-wrap' });
  wrap.append(h('div', { class: 'rift-bg' }), h('div', { class: 'auth-deco' },
    h('div', { class: 'rift-ring r1' }), h('div', { class: 'rift-ring r2' })));

  const panel = h('div', { class: 'auth-panel' });
  panel.append(h('div', { class: 'auth-logo' },
    h('div', { class: 'l1', html: 'RIFT <span class="accent">ARENA</span>' }),
    h('div', { class: 'l2', text: 'par TB_games' }),
  ));

  const err = h('div', { class: 'auth-error' });
  const tabs = h('div', { class: 'auth-tabs' });
  const form = h('div', { class: 'auth-form' });
  let mode = 'login';

  const uInput = h('input', { placeholder: 'Nom de joueur', maxlength: 16, autocomplete: 'username' });
  const pInput = h('input', { placeholder: 'Mot de passe', type: 'password', autocomplete: 'current-password' });
  const keyInput = h('input', { placeholder: 'Colle la valeur de ADMIN_BOOTSTRAP_KEY', type: 'password' });
  const keyRow = h('div', { class: 'form-row hidden' },
    h('label', { text: 'Clé d\'amorçage admin (variable d\'env ADMIN_BOOTSTRAP_KEY sur Render)' }),
    keyInput,
    h('div', { class: 'faint', style: { fontSize: '11px', lineHeight: 1.5 } },
      'Première installation sans shell : inscris d\'abord ton compte (onglet Inscription), puis reviens ici, saisis la clé et valide. Fonctionne tant qu\'aucun admin n\'existe.'),
  );
  const submit = h('button', { class: 'btn primary', text: 'Se connecter' });

  const btnLogin = h('button', { class: 'tab active', text: 'Connexion' });
  const btnReg = h('button', { class: 'tab', text: 'Inscription' });
  tabs.append(btnLogin, btnReg);

  btnLogin.onclick = () => setMode('login');
  btnReg.onclick = () => setMode('register');
  function setMode(m) {
    mode = m;
    btnLogin.classList.toggle('active', m === 'login');
    btnReg.classList.toggle('active', m === 'register');
    submit.textContent = m === 'login' ? 'Se connecter' : 'Créer mon compte';
    err.textContent = '';
  }

  // Visible, no-shell admin bootstrap (Render free: no terminal access)
  const bootLink = h('button', {
    class: 'btn small ghost', style: { marginTop: '10px', width: '100%' },
    text: 'Première installation admin — aucune clé nécessaire après ça',
    onClick: () => {
      keyRow.classList.toggle('hidden');
      err.textContent = '';
    },
  });

  submit.onclick = async () => {
    err.textContent = '';
    submit.disabled = true;
    const username = uInput.value.trim();
    try {
      const bootstrapRequested = !keyRow.classList.contains('hidden') && !!keyInput.value.trim();
      if (mode === 'register' && !bootstrapRequested) {
        // plain account creation: the register endpoint returns the session directly
        const reg = await api.post('/api/auth/register', { username, password: pInput.value });
        setToken(reg.token);
        state.profile = reg.profile;
        connectWs();
        toast('Bienvenue dans RIFT ARENA', 'success');
        buildShell();
        return;
      }
      if (mode === 'register') {
        // admin bootstrap: ensure the account exists first, then promote it
        try { await api.post('/api/auth/register', { username, password: pInput.value }); }
        catch (e) { if (e.code !== 'USERNAME_TAKEN') throw e; }
      }
      if (bootstrapRequested) {
        try {
          const bres = await api.post('/api/auth/bootstrap-admin', {
            username, password: pInput.value, bootstrapKey: keyInput.value.trim(),
          });
          toast(`Compte admin créé (${bres.role}) — connexion en cours`, 'success');
        } catch (e) {
          if (e.code === 'USER_NOT_FOUND') throw new Error('Ce compte n\'existe pas : inscris-le d\'abord (onglet Inscription), puis réessaie.');
          if (e.code === 'ADMIN_EXISTS') toast('Un admin existe déjà — connecte-toi simplement.', 'gold');
          else throw e;
        }
        mode = 'login';
      }
      const { token, profile } = await api.post('/api/auth/login', { username, password: pInput.value });
      setToken(token);
      state.profile = profile;
      connectWs();
      if (mode === 'register') toast('Bienvenue dans RIFT ARENA', 'success');
      buildShell();
    } catch (e) {
      err.textContent = typeof e.message === 'string' && !e.code ? e.message : errText(e);
    } finally {
      submit.disabled = false;
    }
  };
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });

  form.append(uInput, pInput, keyRow, err, submit);
  panel.append(tabs, form, bootLink);
  panel.append(h('div', { class: 'auth-foot', text: 'Nom d\'utilisateur + mot de passe — aucune donnée externe requise' }));
  wrap.append(panel);
  el.append(wrap);
}
