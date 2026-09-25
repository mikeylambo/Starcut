declare const __STARCUT_VERSION__: string;

/** Build version (package version + git sha), injected by vite.config.ts. Shown in the BETA watermark and sent with every feedback/report. */
export const VERSION: string = typeof __STARCUT_VERSION__ !== "undefined" ? __STARCUT_VERSION__ : "dev";
