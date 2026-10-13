export const isDemoPath = (path: string) =>
  path === '/ui-preview' ||
  path === '/preview' ||
  path.startsWith('/preview/') ||
  /^\/(editor|recipe|planner|shopping|account|cookbook|feed)-preview$/.test(path);
export const appPath = () =>
  location.pathname === '/preview'
    ? '/'
    : location.pathname.startsWith('/preview/')
      ? location.pathname.slice('/preview'.length)
      : location.pathname;
export const appUrl = (url: string) =>
  location.pathname === '/preview' || location.pathname.startsWith('/preview/')
    ? `/preview${url}`
    : url;
import { defaultPlannerUrl } from './features/planner/navigation';

export const recipeUrl = (uri: string) => `/recipe?uri=${encodeURIComponent(uri)}`;
export const currentUri = () => new URLSearchParams(location.search).get('uri');
export const isPlainNavigation = (event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
export const currentPlannerRoute = () =>
  /^\/meal-planner(?:\/day|\/shopping-list)?$/.test(appPath())
    ? appPath() === '/meal-planner' && !location.search
      ? defaultPlannerUrl()
      : appPath() + location.search
    : null;
export const currentEditorRoute = () =>
  appPath() === '/editor-preview' || /^\/recipe\/(new|edit|adapt|draft)$/.test(appPath())
    ? appPath() + location.search
    : null;
