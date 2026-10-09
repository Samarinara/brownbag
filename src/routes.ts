import { defaultPlannerUrl } from './features/planner/navigation';

export const recipeUrl = (uri: string) => `/recipe?uri=${encodeURIComponent(uri)}`;
export const currentUri = () => new URLSearchParams(location.search).get('uri');
export const currentPlannerRoute = () =>
  /^\/meal-planner(?:\/day|\/shopping-list)?$/.test(location.pathname)
    ? location.pathname === '/meal-planner' && !location.search
      ? defaultPlannerUrl()
      : location.pathname + location.search
    : null;
export const currentEditorRoute = () =>
  location.pathname === '/editor-preview' ||
  /^\/recipe\/(new|edit|adapt|draft)$/.test(location.pathname)
    ? location.pathname + location.search
    : null;
