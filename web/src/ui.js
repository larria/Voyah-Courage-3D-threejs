// Presentation is independent of the calibrated three.js scene.
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function installLoadingGuard() {
  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    document.getElementById('loader').classList.remove('hide');
    document.getElementById('load-title').textContent = '展车暂时未能加载';
    document.getElementById('load-detail').textContent = '请检查网络连接，再重新加载。';
    document.getElementById('load-pct').textContent = '加载中断';
    document.getElementById('retry').hidden = false;
    document.querySelectorAll('#panel-content button, #views button, #speed').forEach(b => b.disabled = true);
  };
  window.addEventListener('error', fail);
  window.addEventListener('unhandledrejection', fail);
  document.getElementById('retry').onclick = () => location.reload();
  return { ready() { if (!failed) { document.getElementById('loader').classList.add('hide'); document.querySelectorAll('#panel-content button, #views button, #speed').forEach(b => b.disabled = false); } } };
}
export function setupNavigation() {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const activate = tab => {
    tabs.forEach(t => { const selected = t === tab; t.setAttribute('aria-selected', String(selected)); t.tabIndex = selected ? 0 : -1; document.getElementById(t.getAttribute('aria-controls')).hidden = !selected; });
  };
  tabs.forEach((tab, index) => {
    tab.onclick = () => activate(tab);
    tab.onkeydown = event => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next]); tabs[next].focus();
    };
  });
  const toggle = document.getElementById('sheet-toggle');
  toggle.onclick = () => { const collapsed = document.querySelector('.workspace').classList.toggle('sheet-collapsed'); toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.querySelector('span').textContent = collapsed ? '展开' : '收起'; };
}
export function button(parent, label, action, className = '') {
  const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${className}`; b.textContent = label; b.disabled = true; b.onclick = action; parent.appendChild(b); return b;
}
export function pressed(button, value) { button.setAttribute('aria-pressed', String(value)); }
