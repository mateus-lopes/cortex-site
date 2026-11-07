// Tema claro/escuro e data de hoje (calculada no navegador, para o site não precisar ser gerado todo dia)
const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');

function setupThemeToggle(button) {
  const paint = () => {
    const dark = currentTheme() === 'dark';
    button.innerHTML = dark ? ICONS.sun : ICONS.moon;
    button.setAttribute('aria-label', dark ? 'Usar tema claro' : 'Usar tema escuro');
  };
  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('tema', next); } catch {}
    paint();
  });
  systemDark.addEventListener('change', paint);
  paint();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-theme-toggle]').forEach(setupThemeToggle);
  document.querySelectorAll('[data-hoje]').forEach((el) => {
    el.textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  });
});
