export type ErrorNoticeTone = 'error' | 'warning';

export type ErrorNotice = {
  title: string;
  detail: string;
  hint?: string;
  technical?: string;
  tone: ErrorNoticeTone;
};

export function cleanErrorMessage(raw: unknown): string;
export function describeErrorNotice(raw: unknown): ErrorNotice;
