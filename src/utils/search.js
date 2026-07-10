'use strict';

/**
 * Find the first item in an iterable where a field equals a value.
 *
 * @param {any[]} items
 * @param {string} field - Field name (supports camelCase and snake_case).
 * @param {any} value - Value to match.
 * @param {Function} [accessor] - Optional function to extract data from each item.
 * @returns {any|null}
 */
function findByField(items, field, value, accessor) {
  const get = accessor || ((x) => x);
  for (const item of items) {
    const itemData = get(item);
    if (itemData && typeof itemData === 'object') {
      if (itemData[field] === value) return item;
      // Also try snake_case ↔ camelCase conversion
      const camel = snakeToCamel(field);
      if (camel !== field && itemData[camel] === value) return item;
      const snake = camelToSnake(field);
      if (snake !== field && itemData[snake] === value) return item;
    }
  }
  return null;
}

/**
 * Find all items in an iterable where a field equals a value.
 *
 * @param {any[]} items
 * @param {string} field - Field name.
 * @param {any} value - Value to match.
 * @param {Function} [accessor] - Optional function to extract data from each item.
 * @returns {any[]}
 */
function findAllByField(items, field, value, accessor) {
  const get = accessor || ((x) => x);
  return items.filter((item) => {
    const itemData = get(item);
    if (!itemData || typeof itemData !== 'object') return false;
    if (itemData[field] === value) return true;
    const camel = snakeToCamel(field);
    if (camel !== field && itemData[camel] === value) return true;
    const snake = camelToSnake(field);
    if (snake !== field && itemData[snake] === value) return true;
    return false;
  });
}

/** @param {string} s */
function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** @param {string} s */
function camelToSnake(s) {
  return s.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
}

module.exports = { findByField, findAllByField };
