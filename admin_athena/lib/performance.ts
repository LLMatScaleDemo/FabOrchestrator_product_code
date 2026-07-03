/**
 * Performance utilities for optimizing React components and data operations
 */

import { useCallback, useRef, useEffect, useState } from "react"

/**
 * Debounce a function call
 * @param fn Function to debounce
 * @param delay Delay in milliseconds
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

/**
 * Throttle a function call
 * @param fn Function to throttle
 * @param limit Time limit in milliseconds
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * Hook for debounced value
 * @param value Value to debounce
 * @param delay Delay in milliseconds
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

/**
 * Hook for debounced callback
 * @param callback Callback function
 * @param delay Delay in milliseconds
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => callback(...args), delay)
    },
    [callback, delay]
  )
}

/**
 * Hook for throttled callback
 * @param callback Callback function
 * @param limit Time limit in milliseconds
 */
export function useThrottledCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  limit: number
): (...args: Parameters<T>) => void {
  const inThrottleRef = useRef(false)

  return useCallback(
    (...args: Parameters<T>) => {
      if (!inThrottleRef.current) {
        callback(...args)
        inThrottleRef.current = true
        setTimeout(() => (inThrottleRef.current = false), limit)
      }
    },
    [callback, limit]
  )
}

/**
 * Hook to track if component is mounted
 * Useful for avoiding state updates on unmounted components
 */
export function useIsMounted(): () => boolean {
  const isMountedRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  return useCallback(() => isMountedRef.current, [])
}

/**
 * Hook for previous value tracking
 * @param value Value to track
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>(undefined)

  useEffect(() => {
    ref.current = value
  }, [value])

  return ref.current
}

/**
 * Shallow comparison for arrays
 */
export function shallowEqualArray<T>(a: T[], b: T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Shallow comparison for objects
 */
export function shallowEqualObject<T extends Record<string, unknown>>(
  a: T,
  b: T
): boolean {
  if (a === b) return true
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (a[key] !== b[key]) return false
  }
  return true
}

/**
 * Memoize a function with a simple cache
 * @param fn Function to memoize
 */
export function memoize<T extends (...args: unknown[]) => unknown>(
  fn: T
): T {
  const cache = new Map<string, ReturnType<T>>()
  return ((...args: Parameters<T>) => {
    const key = JSON.stringify(args)
    if (cache.has(key)) {
      return cache.get(key)
    }
    const result = fn(...args) as ReturnType<T>
    cache.set(key, result)
    return result
  }) as T
}

/**
 * Create a memoized selector for derived state
 */
export function createSelector<T, R>(
  selector: (state: T) => R
): (state: T) => R {
  let lastState: T | undefined
  let lastResult: R | undefined

  return (state: T) => {
    if (state === lastState) {
      return lastResult as R
    }
    lastState = state
    lastResult = selector(state)
    return lastResult
  }
}

/**
 * Batch multiple state updates
 * Uses requestIdleCallback for non-critical updates
 */
export function batchUpdates(callback: () => void): void {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(callback)
  } else {
    setTimeout(callback, 0)
  }
}

/**
 * Hook for lazy initialization
 * Only runs initializer once
 */
export function useLazyInit<T>(initializer: () => T): T {
  const ref = useRef<{ value: T; initialized: boolean }>({
    value: undefined as T,
    initialized: false,
  })

  if (!ref.current.initialized) {
    ref.current.value = initializer()
    ref.current.initialized = true
  }

  return ref.current.value
}

/**
 * Measure performance of a function
 */
export function measurePerformance<T extends (...args: unknown[]) => unknown>(
  fn: T,
  name: string
): T {
  return ((...args: Parameters<T>) => {
    const start = performance.now()
    const result = fn(...args)
    const end = performance.now()
    console.debug(`[Performance] ${name}: ${(end - start).toFixed(2)}ms`)
    return result
  }) as T
}

/**
 * Request animation frame loop with cleanup
 */
export function useAnimationFrame(callback: (deltaTime: number) => void): void {
  const requestRef = useRef<number>(undefined)
  const previousTimeRef = useRef<number>(undefined)

  useEffect(() => {
    const animate = (time: number) => {
      if (previousTimeRef.current !== undefined) {
        const deltaTime = time - previousTimeRef.current
        callback(deltaTime)
      }
      previousTimeRef.current = time
      requestRef.current = requestAnimationFrame(animate)
    }

    requestRef.current = requestAnimationFrame(animate)
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
      }
    }
  }, [callback])
}

/**
 * Virtualization helper for large lists
 * Returns only visible items based on scroll position
 */
export function getVisibleItems<T>(
  items: T[],
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  overscan: number = 3
): { startIndex: number; endIndex: number; visibleItems: T[] } {
  const totalItems = items.length
  if (totalItems === 0) {
    return { startIndex: 0, endIndex: 0, visibleItems: [] }
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = Math.ceil(containerHeight / itemHeight) + 2 * overscan
  const endIndex = Math.min(totalItems, startIndex + visibleCount)

  return {
    startIndex,
    endIndex,
    visibleItems: items.slice(startIndex, endIndex),
  }
}
