/**
 * Map en mémoire qui oublie les plus anciennes entrées au-delà de `max` :
 * les caches de photos / d'essais grossissaient sans limite tant que le process tournait.
 */
export const boundedMap = (max = 5000) => {
  const map = new Map();
  const set = map.set.bind(map);
  map.set = (key, value) => {
    map.delete(key); // une clé réécrite redevient « récente »
    set(key, value);
    if (map.size > max) map.delete(map.keys().next().value);
    return map;
  };
  return map;
};
