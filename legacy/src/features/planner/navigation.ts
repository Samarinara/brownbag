import { dateObject, localDate, plannerUrl } from '../../../shared/planner';

export const displayDate = (
  date: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' },
) => dateObject(date).toLocaleDateString(undefined, options);
export const defaultPlannerUrl = () =>
  plannerUrl(localDate(), window.matchMedia('(max-width: 700px)').matches);
