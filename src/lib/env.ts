const DEFAULT_PRESENTER_URL =
  "https://cdn.perxona.ai/asia/prod/latest/widget/entry/presenter.js";

export interface AppEnvironment {
  presenterUrl: string;
}

export function getAppEnvironment(): AppEnvironment {
  return {
    presenterUrl:
      (import.meta.env.VITE_PRESENTER_URL as string | undefined) ||
      DEFAULT_PRESENTER_URL,
  };
}

export function getPresenterUrl(): string {
  return getAppEnvironment().presenterUrl;
}
