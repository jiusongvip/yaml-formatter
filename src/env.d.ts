/// <reference types="astro/client" />

declare global {
  interface Window {
    dataLayer: any[];
  }
  function gtag(...args: any[]): void;
}

export {};
