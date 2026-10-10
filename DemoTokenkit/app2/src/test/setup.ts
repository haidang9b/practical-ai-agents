import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

afterEach(() => cleanup());

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});