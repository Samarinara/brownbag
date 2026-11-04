import { App } from '../NetworkApp';
import { Bag } from '../components';
import { installDemoApi, sampleRecipes } from './api';
import { recipeUrl } from '../routes';

const demos = [
  {
    href: '/recipe-preview',
    title: 'Recipe',
    description: 'Read a recipe, save it, and add it to your meal plan.',
  },
  {
    href: '/editor-preview',
    title: 'Recipe editor',
    description: 'Edit a sample recipe, add ingredients, and try the publishing flow.',
  },
  {
    href: '/cookbook-preview',
    title: 'Cookbook',
    description: 'Browse sample recipes and drafts, filter tags, and search.',
  },
  {
    href: '/feed-preview',
    title: 'Recipe feed',
    description: 'Move between recipes using the existing feed controls.',
  },
  {
    href: '/planner-preview',
    title: 'Meal Planner',
    description: 'Choose recipes, move meals, write notes, and switch week or day views.',
  },
  {
    href: '/shopping-preview',
    title: 'Shopping list',
    description: 'Adjust your shopping range and check off ingredients.',
  },
  {
    href: '/account-preview',
    title: 'Account',
    description: 'Try appearance settings, meal preferences, and sample assistant keys.',
  },
];
const destinations: Record<string, string> = {
  '/recipe-preview': recipeUrl(sampleRecipes[0].uri),
  '/editor-preview': `/recipe/edit?uri=${encodeURIComponent(sampleRecipes[0].uri)}`,
  '/cookbook-preview': '/cookbook',
  '/feed-preview': '/feed',
  '/planner-preview': '/meal-planner',
  '/shopping-preview': '/meal-planner/shopping-list',
  '/account-preview': '/account',
};
const index = location.pathname === '/ui-preview';
if (!index) {
  installDemoApi();
  const destination = destinations[location.pathname];
  if (destination) history.replaceState(null, '', `/preview${destination}`);
}
export default function DemoApp() {
  return (
    <div className="polli-root">
      <aside className="demo-banner" aria-label="Sample kitchen">
        <span>Sample kitchen · changes stay in this tab and reset when you reload.</span>
        <a href={index ? '/' : '/ui-preview'}>{index ? 'Back to Brownbag' : 'All UI previews'}</a>
      </aside>
      {index ? (
        <main className="demo-index">
          <a href="/" className="network-brand">
            <Bag small />
            <span>
              brownbag<span className="brand-period">.</span>
            </span>
          </a>
          <h1>Try the new kitchen</h1>
          <p>Explore Brownbag’s Polli interface with interactive sample data. No sign-in needed.</p>
          <nav aria-label="UI previews">
            {demos.map((demo) => (
              <a key={demo.href} href={demo.href}>
                <strong>{demo.title}</strong>
                <span>{demo.description}</span>
              </a>
            ))}
          </nav>
        </main>
      ) : (
        <App demo />
      )}
    </div>
  );
}
