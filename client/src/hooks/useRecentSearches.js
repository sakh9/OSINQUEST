import { useState, useCallback } from 'react';

const STORAGE_KEY = 'osint_nexus_recent_searches';
const MAX_ITEMS = 8;

// Pure reducer-style function, exported separately so the dedup/ordering
// logic is testable without touching localStorage or mounting a component.
// Moves an existing entry to the front instead of duplicating it, and
// caps the list length.
export function updateRecentList(prev, query, maxItems = MAX_ITEMS) {
  const deduped = [query, ...prev.filter((q) => q.toLowerCase() !== query.toLowerCase())];
  return deduped.slice(0, maxItems);
}

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // localStorage can throw in private/incognito mode on some browsers,
    // or the stored value could be corrupted JSON from a previous version
    // of this app - fail safe to an empty list rather than crashing the page.
    return [];
  }
}

function writeToStorage(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full, disabled, or unavailable - the feature just silently
    // stops persisting rather than breaking the actual search flow.
  }
}

export function useRecentSearches() {
  const [recent, setRecent] = useState(readFromStorage);

  const addSearch = useCallback((query) => {
    setRecent((prev) => {
      const updated = updateRecentList(prev, query);
      writeToStorage(updated);
      return updated;
    });
  }, []);

  return { recent, addSearch };
}