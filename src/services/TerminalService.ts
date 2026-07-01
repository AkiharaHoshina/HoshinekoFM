export const TerminalService = {
  open: async () => {
    if (window.electron && window.electron.terminalOpen) {
      await window.electron.terminalOpen();
    }
  },

  async cd(path: string) {
    if (window.electron && window.electron.cdTerminal) {
      await window.electron.cdTerminal(path);
    }
  }
};
