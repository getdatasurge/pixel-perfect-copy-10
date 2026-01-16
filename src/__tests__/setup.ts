/**
 * Vitest Test Setup
 * 
 * Mocks and global configuration for tests.
 */

import { vi, beforeEach } from 'vitest';

// ============================================
// Persistent localStorage Mock
// ============================================

// Use a Map to simulate actual localStorage behavior with persistence
const storage = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storage.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    storage.delete(key);
  }),
  clear: vi.fn(() => {
    storage.clear();
  }),
  get length() {
    return storage.size;
  },
  key: vi.fn((i: number) => [...storage.keys()][i] ?? null),
};

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Also define on window for browser-like environments
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// ============================================
// Window Mocks
// ============================================

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
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

// Mock ResizeObserver
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});

// ============================================
// Environment Variables
// ============================================

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key');
vi.stubEnv('VITE_SUPABASE_PROJECT_ID', 'test-project');

// ============================================
// Global Test Hooks
// ============================================

// Clear localStorage before each test to ensure isolation
beforeEach(() => {
  storage.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
});

// ============================================
// Console Filtering (Optional)
// ============================================

// Suppress expected console warnings during tests
const originalConsoleWarn = console.warn;
console.warn = (...args: unknown[]) => {
  // Filter out expected warnings
  const message = String(args[0]);
  if (message.includes('ScenarioComposer')) {
    return; // Expected warning for alarm category mismatch
  }
  originalConsoleWarn.apply(console, args);
};
