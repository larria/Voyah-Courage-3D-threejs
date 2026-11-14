export async function setupOffline() {
  document.getElementById('version-label').textContent = `VOYAH · v${__APP_VERSION__}`;
  let installPrompt;
  const install = document.getElementById('install');
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; install.hidden = false;
  });
  install.onclick = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt(); await installPrompt.userChoice;
    installPrompt = null; install.hidden = true;
  };
  window.addEventListener('appinstalled', () => { install.hidden = true; installPrompt = null; });
  const status = document.getElementById('offline-status');
  if (import.meta.env.DEV) { status.textContent = '开发预览'; return; }
  if (!isSecureContext || !('serviceWorker' in navigator)) { status.textContent = '在线展厅'; return; }
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) location.reload(); });
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'CACHE_READY') status.textContent = '离线可用';
  });
  try {
    status.textContent = '正在准备离线资源';
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    function updateNotice() { if (registration.waiting && navigator.serviceWorker.controller) document.getElementById('update-notice').hidden = false; }
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') updateNotice();
        if (worker.state === 'redundant') status.textContent = '离线缓存未完成';
      });
    });
    updateNotice();
    document.getElementById('apply-update').onclick = () => {
      if (!registration.waiting) return;
      refreshing = true; registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
    };
    document.getElementById('defer-update').onclick = () => { document.getElementById('update-notice').hidden = true; };
    await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'CACHE_STATUS' });
    // Check when returning to the page; an update never interrupts an interaction.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) registration.update().then(updateNotice).catch(() => {});
    });
  } catch { status.textContent = '在线展厅 · 离线缓存不可用'; }
}
