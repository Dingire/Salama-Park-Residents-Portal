/**
 * Salama Park street names for the registration form dropdown.
 *
 * The association has not yet supplied its official street list, so this is
 * intentionally empty: while it is empty the registration form falls back to a
 * free-text field, so residents are never blocked from applying.
 *
 * To turn on the dropdown, append the official street names below. The form
 * switches to a strict selector as soon as this array is non-empty, and always
 * offers "Other (not listed)" so a missing street can never block an
 * application.
 *
 * Keep the list sorted by name.
 */
export const SALAMA_PARK_STREETS: string[] = [];

/**
 * Get all available streets. This function allows for future expansion
 * (e.g. fetching from the API) without changing the form component.
 */
export function getSalamaParkStreets(): string[] {
  return SALAMA_PARK_STREETS;
}

/**
 * True once the association has supplied at least one real street name, which
 * is what switches the form from free text to a dropdown.
 */
export const SALAMA_PARK_STREET_LIST_READY = SALAMA_PARK_STREETS.length > 0;
