(function requireLogin() {
  const token = localStorage.getItem('bookMyShowToken');
  if (token) return;

  const currentPage = `${window.location.pathname.split('/').pop()}${window.location.search}`;
  const returnTo = encodeURIComponent(currentPage || 'user-dashboard.html');
  window.location.replace(`login.html?returnTo=${returnTo}`);
})();
