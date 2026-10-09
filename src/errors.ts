export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export const retryMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Please try again.';
