/**
 * Salama Park street names for the registration form dropdown.
 * 
 * Start with streets we know exist from applications and can add to.
 * To add more streets in the future, just append them to this array.
 * Keep them sorted for better UX.
 */
export const SALAMA_PARK_STREETS: string[] = [
  "Test Street",
].sort((a, b) => a.localeCompare(b));

/**
 * Get all available streets. This function allows for future expansion
 * (e.g., fetching from API, merging with OSM data) without changing
 * the form component.
 */
export function getSalamaParkStreets(): string[] {
  return SALAMA_PARK_STREETS;
}

/**
 * Check if the street list is ready to use as a dropdown.
 * Set to true once we have real streets from the community.
 */
export const SALAMA_PARK_STREET_LIST_READY = SALAMA_PARK_STREETS.length > 0;
