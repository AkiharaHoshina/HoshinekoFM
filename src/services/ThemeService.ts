export const ThemeService = {
  async loadTheme() {
    try {
      if (window.electron && window.electron.getThemeCss) {
        const css = await window.electron.getThemeCss();
        if (css) {
          const styleId = 'matugen-theme';
          let styleTag = document.getElementById(styleId);
          if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleId;
            document.head.appendChild(styleTag);
          }
          styleTag.textContent = css;
          console.log('Loaded Matugen theme');
          return true;
        }
      }
    } catch (e) {
      console.error('Failed to load theme', e);
    }
    return false;
  },

  init() {
    const updateIcon = () => {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (window.electron && window.electron.setIcon) {
        window.electron.setIcon(isDark ? 'dark' : 'light');
      }
    };

    // Initial call
    updateIcon();

    // Listen for changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateIcon);
  }
};
