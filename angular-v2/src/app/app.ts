import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import {
  WindowChromeComponent,
  StatusBarComponent,
  StatusBarItem,
  DesktopButtonComponent,
  DesktopThemeService
} from './creamsicle-desktop';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    WindowChromeComponent,
    StatusBarComponent,
    DesktopButtonComponent
  ],
  template: `
    <div class="app-container" [attr.data-theme]="themeService.resolvedTheme()">
      <desktop-window
        title="Creamsicle Desktop"
        [showTitlebar]="true"
        [showToolbar]="true"
        [showStatusBar]="true"
        [frameless]="true"
      >
        <!-- Titlebar Left (for macOS-style placement) -->
        <ng-container titlebar-left>
          <div class="titlebar-spacer"></div>
        </ng-container>

        <!-- Titlebar Right -->
        <ng-container titlebar-right>
          <desktop-button variant="ghost" size="xs" (click)="toggleTheme()">
            {{ themeService.resolvedTheme() === 'dark' ? '☀' : '☾' }}
          </desktop-button>
        </ng-container>

        <!-- Toolbar -->
        <ng-container toolbar>
          <div class="app-toolbar">
            <nav class="toolbar-nav">
              <a
                routerLink="/home"
                routerLinkActive="active"
                class="nav-link"
              >
                <span class="nav-icon">🏠</span>
                <span class="nav-label">Home</span>
              </a>
              <a
                routerLink="/components"
                routerLinkActive="active"
                class="nav-link"
              >
                <span class="nav-icon">🧩</span>
                <span class="nav-label">Components</span>
              </a>
            </nav>

            <div class="toolbar-spacer"></div>

            <div class="toolbar-actions">
              <desktop-button variant="primary" size="sm" icon="✚">
                New
              </desktop-button>
            </div>
          </div>
        </ng-container>

        <!-- Router Outlet -->
        <router-outlet />

        <!-- Status Bar -->
        <ng-container statusbar>
          <desktop-status-bar
            [leftItems]="statusLeftItems"
            [rightItems]="statusRightItems"
            centerText="Ready"
          />
        </ng-container>
      </desktop-window>
    </div>
  `,
  styles: [`
    @use './creamsicle-desktop/styles/variables' as *;

    .app-container {
      height: 100vh;
      width: 100vw;
      display: flex;
      background: var(--bg-base);
      overflow: hidden;
    }

    desktop-window {
      width: 100%;
      height: 100%;
    }

    .titlebar-spacer {
      width: 70px; // Space for traffic lights on macOS
    }

    .app-toolbar {
      display: flex;
      align-items: center;
      width: 100%;
      height: 100%;
      padding: 0 $spacing-3;
      gap: $spacing-3;
    }

    .toolbar-nav {
      display: flex;
      gap: $spacing-1;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: $spacing-1-5;
      padding: $spacing-1-5 $spacing-3;
      border-radius: $radius-md;
      text-decoration: none;
      color: var(--text-secondary);
      font-family: $font-body;
      font-size: $font-size-sm;
      font-weight: $font-weight-medium;
      transition: all $duration-fast $ease-out;

      &:hover {
        background: var(--hover-bg);
        color: var(--text-primary);
      }

      &.active {
        background: var(--selected-bg-muted);
        color: var(--text-accent);
      }
    }

    .nav-icon {
      font-size: 14px;
      line-height: 1;
    }

    .toolbar-spacer {
      flex: 1;
    }

    .toolbar-actions {
      display: flex;
      gap: $spacing-2;
    }
  `]
})
export class App implements OnInit {
  themeService = inject(DesktopThemeService);
  private router = inject(Router);

  statusLeftItems: StatusBarItem[] = [
    { id: 'version', text: 'v1.0.0' },
  ];

  statusRightItems: StatusBarItem[] = [
    { id: 'theme', text: 'System', icon: '🎨', clickable: true },
  ];

  ngOnInit() {
    this.themeService.initializeTheme();
  }

  toggleTheme() {
    this.themeService.toggleTheme();
  }
}
