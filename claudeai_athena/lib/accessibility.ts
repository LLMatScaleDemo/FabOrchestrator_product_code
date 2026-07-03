/**
 * Accessibility utilities for keyboard navigation and ARIA support
 */

/**
 * Focus the first focusable element within a container
 */
export function focusFirstFocusable(container: HTMLElement | null): void {
  if (!container) return;

  const focusableElements = getFocusableElements(container);
  if (focusableElements.length > 0) {
    focusableElements[0].focus();
  }
}

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(', ');

  return Array.from(container.querySelectorAll(focusableSelectors)) as HTMLElement[];
}

/**
 * Trap focus within a container (for modals, dialogs)
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableElements = getFocusableElements(container);
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;

    if (event.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);

  // Focus first element
  firstElement?.focus();

  // Return cleanup function
  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Announce a message to screen readers
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): void {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only';
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement is made
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}

/**
 * Generate a unique ID for ARIA relationships
 */
let idCounter = 0;
export function generateAriaId(prefix: string = 'aria'): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Check if user prefers high contrast
 */
export function prefersHighContrast(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-contrast: high)').matches;
}

/**
 * ARIA label generators for common patterns
 */
export const ariaLabels = {
  close: 'Close',
  menu: 'Menu',
  expand: 'Expand',
  collapse: 'Collapse',
  loading: 'Loading...',
  required: '(required)',
  optional: '(optional)',
  error: (field: string) => `Error in ${field}`,
  characterCount: (current: number, max: number) => `${current} of ${max} characters`,
  page: (current: number, total: number) => `Page ${current} of ${total}`,
  selected: (item: string) => `${item}, selected`,
  notSelected: (item: string) => `${item}, not selected`,
};

/**
 * Create keyboard event handler for common patterns
 */
export function createKeyboardHandler(handlers: {
  onEnter?: () => void;
  onSpace?: () => void;
  onEscape?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  onHome?: () => void;
  onEnd?: () => void;
}) {
  return (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'Enter':
        handlers.onEnter?.();
        break;
      case ' ':
        handlers.onSpace?.();
        break;
      case 'Escape':
        handlers.onEscape?.();
        break;
      case 'ArrowUp':
        event.preventDefault();
        handlers.onArrowUp?.();
        break;
      case 'ArrowDown':
        event.preventDefault();
        handlers.onArrowDown?.();
        break;
      case 'ArrowLeft':
        handlers.onArrowLeft?.();
        break;
      case 'ArrowRight':
        handlers.onArrowRight?.();
        break;
      case 'Home':
        event.preventDefault();
        handlers.onHome?.();
        break;
      case 'End':
        event.preventDefault();
        handlers.onEnd?.();
        break;
    }
  };
}

/**
 * Props for accessible interactive elements
 */
export function getButtonProps(label: string, isPressed?: boolean) {
  return {
    role: 'button',
    'aria-label': label,
    'aria-pressed': isPressed,
    tabIndex: 0,
  };
}

export function getMenuButtonProps(label: string, isExpanded: boolean, menuId: string) {
  return {
    'aria-label': label,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': isExpanded,
    'aria-controls': menuId,
  };
}

export function getTabProps(
  label: string,
  isSelected: boolean,
  tabId: string,
  panelId: string
) {
  return {
    role: 'tab',
    'aria-label': label,
    'aria-selected': isSelected,
    id: tabId,
    'aria-controls': panelId,
    tabIndex: isSelected ? 0 : -1,
  };
}

export function getTabPanelProps(tabId: string, panelId: string) {
  return {
    role: 'tabpanel',
    id: panelId,
    'aria-labelledby': tabId,
    tabIndex: 0,
  };
}
