import { Injectable, signal, effect } from '@angular/core';

export type DesktopTheme = 'light' | 'dark' | 'system';

@Injectable({
  providedIn: 'root'
})
export class DesktopThemeService {
  private readonly STORAGE_KEY = 'creamsicle-desktop-theme';

  currentTheme = signal<DesktopTheme>('system');
  resolvedTheme = signal<'light' | 'dark'>('light');

  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    // Listen for system theme changes
    this.mediaQuery.addEventListener('change', (e) => {
      if (this.currentTheme() === 'system') {
        this.resolvedTheme.set(e.matches ? 'dark' : 'light');
        this.applyTheme();
      }
    });

    // Apply theme whenever it changes
    effect(() => {
      this.applyTheme();
    });
  }

  initializeTheme() {
    const stored = localStorage.getItem(this.STORAGE_KEY) as DesktopTheme | null;
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      this.currentTheme.set(stored);
    }
    this.updateResolvedTheme();
    this.applyTheme();
  }

  setTheme(theme: DesktopTheme) {
    this.currentTheme.set(theme);
    localStorage.setItem(this.STORAGE_KEY, theme);
    this.updateResolvedTheme();
  }

  toggleTheme() {
    const current = this.currentTheme();
    if (current === 'light') {
      this.setTheme('dark');
    } else if (current === 'dark') {
      this.setTheme('system');
    } else {
      this.setTheme('light');
    }
  }

  private updateResolvedTheme() {
    const theme = this.currentTheme();
    if (theme === 'system') {
      this.resolvedTheme.set(this.mediaQuery.matches ? 'dark' : 'light');
    } else {
      this.resolvedTheme.set(theme);
    }
  }

  private applyTheme() {
    const resolved = this.resolvedTheme();
    document.documentElement.setAttribute('data-theme', resolved);
  }
}
