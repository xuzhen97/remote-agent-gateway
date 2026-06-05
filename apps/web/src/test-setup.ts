import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// jsdom polyfills needed by Ant Design
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const originalGetComputedStyle = window.getComputedStyle.bind(window);
Object.defineProperty(window, 'getComputedStyle', {
  writable: true,
  value: (elt: Element, pseudoElt?: string) => {
    if (pseudoElt) {
      return {
        getPropertyValue: () => '',
        overflow: 'auto',
        overflowX: 'auto',
        overflowY: 'auto',
      } as unknown as CSSStyleDeclaration;
    }
    return originalGetComputedStyle(elt);
  },
});
