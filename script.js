/* Posta Yönlendirme Yöneticisi - Vanilla JS, modüler yapı */
(() => {
  'use strict';

  // ---------- Storage abstraction ----------
  const Storage = (() => {
    const NS = 'pys:';
    let mode = 'local';

    const backend = () => {
      if (mode === 'session') return sessionStorage;
      if (mode === 'memory') return MemoryStore;
      return localStorage;
    };

    const MemoryStore = (() => {
      const m = new Map();
      return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
      };
    })();

    return {
      setMode(m) { mode = m; },
      get(key) {
        try {
          const raw = backend().getItem(NS + key);
          return raw ? JSON.parse(raw) : null;
        } catch (e) { Log.warn('storage.read.fail', e); return null; }
      },
      set(key, val) {
        try { backend().setItem(NS + key, JSON.stringify(val)); return true; }
        catch (e) { Log.error('storage.write.fail', e); return false; }
      },
      remove(key) {
        try { backend().removeItem(NS + key); } catch (e) { Log.warn('storage.remove.fail', e); }
      },
    };
  })();

  // ---------- Logger ----------
  const Log = (() => {
    const KEY = 'logs';
    const MAX = 500;

    const read = () => Storage.get(KEY) || [];
    const write = (level, msg, meta) => {
      if (!Config.current.logEnabled && level !== 'error') return;
      const entry = {
        t: Date.now(),
        level,
        msg,
        meta: meta ? String(meta).slice(0, 200) : '',
      };
      const logs = read();
      logs.unshift(entry);
      const cutoff = Date.now() - Config.current.logRetention * 86400000;
      const trimmed = logs.filter((l) => l.t >= cutoff).slice(0, MAX);
      Storage.set(KEY, trimmed);
      if (UI.panels.logs) UI.renderLogs();
    };

    return {
      info: (m, e) => write('info', m, e),
      success: (m, e) => write('success', m, e),
      warn: (m, e) => write('warn', m, e),
      error: (m, e) => write('error', m, e),
      all: () => read(),
      clear() { Storage.set(KEY, []); UI.renderLogs(); },
    };
  })();

  // ---------- Config ----------
  const Config = (() => {
    const KEY = 'config';
    const DEFAULTS = {
      domain: '',
      routerPrefix: 'router',
      logEnabled: true,
      logRetention: 30,
      fallbackEnabled: false,
      fallback: '',
      rateLimit: 5,
      sanitize: true,
      confirmRedirect: true,
      storage: 'local',
      formsubmit: 'hamdiuludag@gmail.com',
      publicAlias: 'info@alanadi.com',
    };

    let current = { ...DEFAULTS };

    const load = () => {
      const saved = Storage.get(KEY);
      current = { ...DEFAULTS, ...(saved || {}) };
      Storage.setMode(current.storage);
      return current;
    };

    return {
      DEFAULTS,
      get current() { return current; },
      load,
      save(patch) {
        current = { ...current, ...patch };
        Storage.setMode(current.storage);
        const ok = Storage.set(KEY, current);
        Log.info('config.saved');
        return ok;
      },
      reset() {
        current = { ...DEFAULTS };
        Storage.setMode(current.storage);
        Storage.set(KEY, current);
        Log.info('config.reset');
      },
    };
  })();

  // ---------- Rules engine ----------
  const Rules = (() => {
    const KEY = 'rules';

    const uid = () => 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

    const all = () => Storage.get(KEY) || [];

    const patternToRegex = (pattern) => {
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return new RegExp('^' + escaped + '$', 'i');
    };

    const match = (address) => {
      const list = all().filter((r) => r.enabled);
      for (const r of list) {
        try {
          if (patternToRegex(r.pattern).test(address)) return r;
        } catch (e) {
          Log.warn('rules.pattern.invalid', r.pattern);
        }
      }
      return null;
    };

    return {
      all,
      add(rule) {
        const list = all();
        const item = { id: uid(), enabled: true, createdAt: Date.now(), ...rule };
        list.push(item);
        Storage.set(KEY, list);
        Log.info('rules.add', item.name);
        return item;
      },
      update(id, patch) {
        const list = all();
        const i = list.findIndex((r) => r.id === id);
        if (i === -1) return null;
        list[i] = { ...list[i], ...patch };
        Storage.set(KEY, list);
        Log.info('rules.update', list[i].name);
        return list[i];
      },
      remove(id) {
        const list = all();
        const item = list.find((r) => r.id === id);
        const next = list.filter((r) => r.id !== id);
        Storage.set(KEY, next);
        Log.info('rules.delete', item ? item.name : id);
      },
      toggle(id) {
        const r = all().find((x) => x.id === id);
        if (!r) return;
        Rules.update(id, { enabled: !r.enabled });
      },
      match,
      validate(rule) {
        const errors = [];
        if (!rule.name || !rule.name.trim()) errors.push('Etiket gerekli');
        if (!rule.pattern || !rule.pattern.trim()) errors.push('Desen gerekli');
        if (!rule.target || !rule.target.trim()) errors.push('Hedef gerekli');
        if (rule.target && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rule.target)) errors.push('Hedef e-posta geçersiz');
        if (rule.pattern) {
          try { patternToRegex(rule.pattern); }
          catch (e) { errors.push('Desen sözdizimi hatalı'); }
        }
        return errors;
      },
    };
  })();

  // ---------- Router core ----------
  const Router = (() => {
    let lastHit = 0;

    const sanitize = (s) => {
      if (!Config.current.sanitize) return s;
      return String(s).replace(/[<>"'`]/g, '').trim();
    };

    const normalize = (input) => {
      let v = String(input || '').trim();
      if (v.toLowerCase().startsWith('mailto:')) v = v.slice(7);
      return v;
    };

    const resolve = (input) => {
      const now = Date.now();
      if (now - lastHit < 1000 / Math.max(1, Config.current.rateLimit)) {
        throw new Error('Hız sınırı aşıldı, biraz bekleyin');
      }
      lastHit = now;

      const address = sanitize(normalize(input));
      if (!address) throw new Error('Adres boş');

      const rule = Rules.match(address);
      if (rule) {
        const target = sanitize(rule.target);
        Log.success('router.match', `${address} → ${target}`);
        return { ok: true, target, rule, mailto: `mailto:${target}` };
      }

      if (Config.current.fallbackEnabled && Config.current.fallback) {
        const fb = sanitize(Config.current.fallback);
        Log.warn('router.fallback', `${address} → ${fb}`);
        return { ok: true, target: fb, fallback: true, mailto: `mailto:${fb}` };
      }

      Log.warn('router.noMatch', address);
      return { ok: false, address };
    };

    return { resolve, normalize, sanitize };
  })();

  // ---------- FormSubmit integration ----------
  const FormSubmit = (() => {
    const ENDPOINT = 'https://formsubmit.co/ajax/';

    const send = async (target, payload) => {
      const url = ENDPOINT + encodeURIComponent(target);
      const body = new URLSearchParams();
      Object.entries(payload).forEach(([k, v]) => body.append(k, v));

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json().catch(() => ({}));
      if (data && data.success === false) {
        throw new Error(data.message || 'Gönderim başarısız');
      }
      return data;
    };

    return { send };
  })();

  // ---------- UI layer ----------
  const UI = (() => {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    const panels = { rules: null, config: null, logs: null, router: null };
    const toastEl = () => $('#toast');
    let toastTimer;

    const toast = (msg, kind = 'info') => {
      const el = toastEl();
      if (!el) return;
      el.textContent = msg;
      el.dataset.kind = kind;
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add('is-visible'));
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        el.classList.remove('is-visible');
        setTimeout(() => { el.hidden = true; }, 200);
      }, 2200);
    };

    const switchTab = (name) => {
      $$('.tabs__btn').forEach((b) => {
        const on = b.dataset.tab === name;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      $$('.panel').forEach((p) => {
        const on = p.id === 'tab-' + name;
        p.classList.toggle('is-active', on);
        p.hidden = !on;
      });
      if (name === 'logs') renderLogs();
      if (name === 'rules') renderRules();
      if (name === 'config') renderConfig();
      history.replaceState(null, '', '#' + name);
    };

    const renderRules = () => {
      const list = $('#rulesList');
      const empty = $('#rulesEmpty');
      const q = ($('#ruleSearch').value || '').toLowerCase();
      const rules = Rules.all().filter((r) =>
        !q || r.name.toLowerCase().includes(q) || r.pattern.toLowerCase().includes(q) || r.target.toLowerCase().includes(q)
      );

      if (!rules.length) {
        list.innerHTML = '';
        empty.hidden = false;
        return;
      }
      empty.hidden = true;

      list.innerHTML = rules.map((r) => `
        <article class="rule" data-id="${r.id}">
          <div>
            <div class="rule__name">${escapeHtml(r.name)}</div>
            <div class="rule__pattern">${escapeHtml(r.pattern)}</div>
            <div class="rule__target">→ ${escapeHtml(r.target)}</div>
          </div>
          <div class="rule__meta">
            <span class="badge ${r.enabled ? 'badge--on' : 'badge--off'}">
              <span class="badge__dot"></span>${r.enabled ? 'Açık' : 'Kapalı'}
            </span>
            <div class="rule__actions">
              <button class="rule__btn" data-action="toggle" title="${r.enabled ? 'Kapat' : 'Aç'}" aria-label="Aç/Kapat">⏻</button>
              <button class="rule__btn" data-action="edit" title="Düzenle" aria-label="Düzenle">✎</button>
              <button class="rule__btn" data-action="delete" title="Sil" aria-label="Sil">🗑</button>
            </div>
          </div>
        </article>
      `).join('');
    };

    const renderLogs = () => {
      const list = $('#logList');
      const empty = $('#logsEmpty');
      if (!list) return;
      const logs = Log.all();
      if (!logs.length) {
        list.innerHTML = '';
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      list.innerHTML = logs.map((l) => `
        <div class="log__item" data-level="${l.level}">
          <span class="log__time">${new Date(l.t).toLocaleString('tr-TR')}</span>
          <span class="log__msg">${escapeHtml(l.msg)}${l.meta ? ' · ' + escapeHtml(l.meta) : ''}</span>
          <span class="log__level">${l.level}</span>
        </div>
      `).join('');
    };

    const renderConfig = () => {
      const c = Config.current;
      $('#cfg-domain').value = c.domain;
      $('#cfg-prefix').value = c.routerPrefix;
      $('#cfg-logEnabled').checked = c.logEnabled;
      $('#cfg-fallbackEnabled').checked = c.fallbackEnabled;
      $('#cfg-fallback').value = c.fallback;
      $('#cfg-rateLimit').value = c.rateLimit;
      $('#cfg-sanitize').checked = c.sanitize;
      $('#cfg-confirmRedirect').checked = c.confirmRedirect;
      $('#cfg-storage').value = c.storage;
      $('#cfg-retention').value = c.logRetention;
      $('#cfg-formsubmit').value = c.formsubmit || '';
      $('#cfg-alias').value = c.publicAlias || '';
    };

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    // Modal
    const openModal = (rule = null) => {
      const m = $('#ruleModal');
      $('#ruleId').value = rule ? rule.id : '';
      $('#ruleName').value = rule ? rule.name : '';
      $('#rulePattern').value = rule ? rule.pattern : '';
      $('#ruleTarget').value = rule ? rule.target : '';
      $('#ruleEnabled').checked = rule ? rule.enabled : true;
      $('#modalTitle').textContent = rule ? 'Kuralı Düzenle' : 'Yeni Kural';
      m.showModal();
      $('#ruleName').focus();
    };
    const closeModal = () => { $('#ruleModal').close(); };

    const saveRuleFromForm = () => {
      const rule = {
        name: $('#ruleName').value.trim(),
        pattern: $('#rulePattern').value.trim(),
        target: $('#ruleTarget').value.trim(),
        enabled: $('#ruleEnabled').checked,
      };
      const errors = Rules.validate(rule);
      if (errors.length) {
        toast(errors[0], 'error');
        Log.warn('rule.validate.fail', errors.join('; '));
        return;
      }
      const id = $('#ruleId').value;
      if (id) Rules.update(id, rule);
      else Rules.add(rule);
      closeModal();
      renderRules();
      toast(id ? 'Kural güncellendi' : 'Kural eklendi', 'success');
    };

    const onRulesClick = (e) => {
      const btn = e.target.closest('.rule__btn');
      if (!btn) return;
      const el = btn.closest('.rule');
      const id = el.dataset.id;
      const action = btn.dataset.action;
      if (action === 'toggle') { Rules.toggle(id); renderRules(); }
      else if (action === 'edit') {
        const r = Rules.all().find((x) => x.id === id);
        if (r) openModal(r);
      } else if (action === 'delete') {
        if (confirm('Bu kural silinsin mi?')) { Rules.remove(id); renderRules(); toast('Kural silindi'); }
      }
    };

    const onConfigInput = () => {
      Config.save({
        domain: $('#cfg-domain').value.trim(),
        routerPrefix: $('#cfg-prefix').value.trim() || 'router',
        logEnabled: $('#cfg-logEnabled').checked,
        fallbackEnabled: $('#cfg-fallbackEnabled').checked,
        fallback: $('#cfg-fallback').value.trim(),
        rateLimit: Math.max(1, parseInt($('#cfg-rateLimit').value, 10) || 5),
        sanitize: $('#cfg-sanitize').checked,
        confirmRedirect: $('#cfg-confirmRedirect').checked,
        storage: $('#cfg-storage').value,
        logRetention: Math.max(1, parseInt($('#cfg-retention').value, 10) || 30),
        formsubmit: $('#cfg-formsubmit').value.trim() || 'hamdiuludag@gmail.com',
        publicAlias: $('#cfg-alias').value.trim() || 'info@alanadi.com',
      });
      UI.updateSubmitTarget();
    };

    const exportData = () => {
      const data = { version: 1, exportedAt: new Date().toISOString(), config: Config.current, rules: Rules.all(), logs: Log.all() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'posta-yonlendirme-yedek.json';
      a.click();
      URL.revokeObjectURL(url);
      Log.info('export.done');
      toast('Yedek indirildi', 'success');
    };

    const importData = (file) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || typeof data !== 'object') throw new Error('Geçersiz dosya');
          if (Array.isArray(data.rules)) Storage.set('rules', data.rules);
          if (data.config) Config.save(data.config);
          if (Array.isArray(data.logs)) Storage.set('logs', data.logs);
          renderRules(); renderConfig(); renderLogs();
          Log.info('import.done');
          toast('İçe aktarım başarılı', 'success');
        } catch (e) {
          Log.error('import.fail', e.message);
          toast('İçe aktarım başarısız', 'error');
        }
      };
      reader.readAsText(file);
    };

    const onRouterSubmit = (e) => {
      e.preventDefault();
      const out = $('#routerResult');
      try {
        const res = Router.resolve($('#routerTo').value);
        if (res.ok) {
          out.dataset.ok = 'true';
          out.textContent = `Eşleşti: ${res.target}${res.fallback ? ' (varsayılan)' : ''}`;
          if (Config.current.confirmRedirect) {
            out.textContent += ' — onay bekleniyor';
            const go = confirm(`Yönlendir: ${res.target}?`);
            if (go) window.location.href = res.mailto;
          } else {
            window.location.href = res.mailto;
          }
        } else {
          out.dataset.ok = 'false';
          out.textContent = `Eşleşme yok: ${res.address}`;
        }
      } catch (err) {
        out.dataset.ok = 'false';
        out.textContent = 'Hata: ' + err.message;
        Log.error('router.fail', err.message);
      }
    };

    const onRouterCopy = async () => {
      const val = $('#routerTo').value;
      if (!val) { toast('Önce adres girin', 'error'); return; }
      const prefix = Config.current.routerPrefix || 'router';
      const domain = Config.current.domain ? `https://${Config.current.domain}` : '';
      const link = `${domain}/${prefix}?to=${encodeURIComponent(Router.normalize(val))}`;
      try {
        await navigator.clipboard.writeText(link);
        toast('Bağlantı kopyalandı', 'success');
      } catch (e) { toast('Kopyalama başarısız', 'error'); }
    };

    const applyTheme = (t) => {
      document.documentElement.dataset.theme = t;
      $('#themeToggle').textContent = t === 'dark' ? '☀' : '☾';
      Storage.set('theme', t);
    };

    const initTheme = () => {
      const saved = Storage.get('theme');
      const prefers = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      applyTheme(saved || prefers);
    };

    const init = () => {
      panels.rules = $('#tab-rules');
      panels.config = $('#tab-config');
      panels.logs = $('#tab-logs');
      panels.router = $('#tab-router');
      panels.submit = $('#tab-submit');

      $$('.tabs__btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
      $('#themeToggle').addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
      });

      $('#addRuleBtn').addEventListener('click', () => openModal());
      $('[data-add-first]').addEventListener('click', () => openModal());
      $('#rulesList').addEventListener('click', onRulesClick);
      $('#ruleSearch').addEventListener('input', renderRules);
      $('#ruleForm').addEventListener('submit', saveRuleFromForm);
      $$('[data-close-modal]').forEach((b) => b.addEventListener('click', closeModal));

      $('#configForm').addEventListener('input', onConfigInput);
      $('#resetConfigBtn').addEventListener('click', () => {
        if (confirm('Ayarlar varsayılana döndürülsün mü?')) { Config.reset(); renderConfig(); toast('Ayarlar sıfırlandı'); }
      });

      $('#exportBtn').addEventListener('click', exportData);
      $('#importBtn').addEventListener('click', () => $('#importFile').click());
      $('#importFile').addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (f) importData(f);
        e.target.value = '';
      });

      $('#clearLogsBtn').addEventListener('click', () => {
        if (confirm('Tüm günlük kayıtları silinsin mi?')) Log.clear();
      });

      $('#routerForm').addEventListener('submit', onRouterSubmit);
      $('#routerCopy').addEventListener('click', onRouterCopy);

      $('#submitForm').addEventListener('submit', onSubmitForm);

      const hash = location.hash.slice(1);
      switchTab(['rules', 'submit', 'config', 'logs', 'router'].includes(hash) ? hash : 'rules');
      renderRules(); renderConfig(); renderLogs(); updateSubmitTarget();
    };

    const onSubmitForm = async (e) => {
      e.preventDefault();
      const form = $('#submitForm');
      const status = $('#submitStatus');
      const btn = $('#submitBtn');
      const target = Config.current.formsubmit || 'hamdiuludag@gmail.com';
      const alias = Config.current.publicAlias || 'info@alanadi.com';

      if (!form.checkValidity()) {
        status.dataset.ok = 'false'; status.dataset.busy = 'false';
        status.textContent = 'Lütfen tüm alanları doldurun.';
        return;
      }

      const payload = {
        name: $('#sfName').value.trim(),
        email: $('#sfEmail').value.trim(),
        _subject: `[${alias}] ${$('#sfSubject').value.trim()}`,
        message: $('#sfMessage').value.trim(),
        _template: 'table',
        _captcha: 'false',
      };

      btn.disabled = true;
      status.dataset.ok = ''; status.dataset.busy = 'true';
      status.textContent = 'Gönderiliyor...';
      Log.info('submit.start', target);

      try {
        const data = await FormSubmit.send(target, payload);
        status.dataset.ok = 'true'; status.dataset.busy = 'false';
        status.textContent = 'Gönderildi. Teşekkürler!';
        form.reset();
        Log.success('submit.done', target);
        UI.toast('Form gönderildi', 'success');
      } catch (err) {
        status.dataset.ok = 'false'; status.dataset.busy = 'false';
        status.textContent = 'Hata: ' + err.message;
        Log.error('submit.fail', err.message);
        UI.toast('Gönderim başarısız', 'error');
      } finally {
        btn.disabled = false;
      }
    };

    const updateSubmitTarget = () => {
      const t = $('#submitTargetDisplay');
      if (t) t.textContent = Config.current.formsubmit || 'hamdiuludag@gmail.com';
      const a = $('#submitAliasDisplay');
      if (a) a.textContent = Config.current.publicAlias || 'info@alanadi.com';
    };

    return { init, switchTab, renderRules, renderLogs, renderConfig, toast, panels, updateSubmitTarget };
  })();

  // ---------- Boot ----------
  Config.load();
  UI.initTheme();
  document.addEventListener('DOMContentLoaded', () => {
    Config.load();
    UI.init();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((e) => Log.warn('sw.register.fail', e.message));
    }
    Log.info('app.boot');
  });
})();
