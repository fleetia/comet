const root = document.documentElement;
const themeButton = document.querySelector('.theme-toggle');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

function currentTheme() {
  return root.dataset.theme || (systemTheme.matches ? 'dark' : 'light');
}

function updateThemeLabel() {
  const isDark = currentTheme() === 'dark';
  themeButton.setAttribute('aria-label', `현재 테마 ${isDark ? '밤' : '낮'}, ${isDark ? '낮' : '밤'}으로 바꾸기`);
}

if (themeButton) {
  updateThemeLabel();
  themeButton.addEventListener('click', () => {
    const theme = currentTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = theme;
    try {
      localStorage.setItem('guide-theme', theme);
    } catch {}
    updateThemeLabel();
  });
  systemTheme.addEventListener('change', updateThemeLabel);
}

const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')];
const headings = [...document.querySelectorAll('.content h2[id]')];

if ('IntersectionObserver' in window && headings.length > 0 && tocLinks.length > 0) {
  const visibleHeadings = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        visibleHeadings.add(entry.target);
      } else {
        visibleHeadings.delete(entry.target);
      }
    }
    const current = headings.find((heading) => visibleHeadings.has(heading));
    if (!current) {
      return;
    }
    for (const link of tocLinks) {
      if (decodeURIComponent(link.hash.slice(1)) === current.id) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-56px 0px -70% 0px' });
  for (const heading of headings) {
    observer.observe(heading);
  }
}
