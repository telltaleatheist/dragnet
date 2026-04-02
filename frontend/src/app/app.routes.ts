import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'feed',
    pathMatch: 'full',
  },
  {
    path: 'feed',
    loadComponent: () =>
      import('./pages/feed/feed.component').then((m) => m.FeedComponent),
  },
  {
    path: 'sources',
    loadComponent: () =>
      import('./pages/sources/sources.component').then((m) => m.SourcesComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
  },
];
