/**
 * Read an optional property without treating its value as validated input.
 * Keep JavaScript boxing, key coercion, getters and nullish short-circuiting.
 * @param {unknown} value
 * @param {unknown} key
 * @returns {unknown}
 */
export function optionalProperty(value, key) {
  return /** @type {Record<PropertyKey, unknown> | null | undefined} */ (value)?.[
    /** @type {PropertyKey} */ (key)
  ];
}
