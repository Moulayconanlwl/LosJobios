import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'LosJobios — Job Application Autopilot',
  version: pkg.version,
  description:
    'Auto-apply to LinkedIn Easy Apply and Indeed Apply jobs, autofill any career site, and track every application.',

  // Deliberately narrow. Universal autofill runs through activeTab + a user
  // gesture rather than <all_urls>, so the extension never has standing access
  // to every site you visit.
  // `sidePanel` is a UI-surface permission: it lets the extension own a panel
  // beside the page. It grants no access to page content or user data — the
  // review flow simply cannot live in a popup, which closes the moment you
  // click the form you are trying to check.
  permissions: ['storage', 'tabs', 'scripting', 'alarms', 'activeTab', 'sidePanel'],
  // `*.indeed.com` covers the country sites too — Indeed serves France as
  // fr.indeed.com and redirects indeed.fr to it — and, importantly,
  // smartapply.indeed.com, which is where the Apply button lands. A run can't
  // finish an Indeed application without standing access to that host,
  // because the form is a separate page load rather than a modal.
  host_permissions: ['https://www.linkedin.com/*', 'https://*.indeed.com/*'],

  // Requested at runtime only when you turn on AI question answering, so the
  // extension has no network reach at all until you opt in.
  optional_host_permissions: ['https://generativelanguage.googleapis.com/*'],

  action: {
    default_popup: 'src/ui/popup/index.html',
    default_icon: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },

  options_page: 'src/ui/options/index.html',

  side_panel: {
    default_path: 'src/ui/sidepanel/index.html',
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  content_scripts: [
    {
      matches: ['https://www.linkedin.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      // LinkedIn's authenticated job search renders entirely inside a
      // same-origin iframe (linkedin.com/preload/?_bprMode=vanilla) — the
      // top-level document is an empty shell. Without this, the content
      // script only ever sees that shell and never the real job list.
      // See background/frames.ts for how the background picks the frame
      // that actually has content out of the several this now injects into.
      all_frames: true,
    },
    {
      matches: ['https://*.indeed.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      // The hosted apply form has historically been served inside an iframe
      // as well as as its own page; injecting into both means the wizard is
      // reachable either way. See background/frames.ts for how the background
      // picks which frame to actually address.
      all_frames: true,
    },
  ],

  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
})
