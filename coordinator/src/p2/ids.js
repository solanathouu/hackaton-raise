export function createIdFactory(prefix) {
  let next = 1;
  return {
    next() {
      return `${prefix}_${next++}`;
    },
    reset() {
      next = 1;
    },
    observe(id) {
      const match = String(id || "").match(new RegExp(`^${prefix}_(\\d+)$`));
      if (!match) return;
      next = Math.max(next, Number(match[1]) + 1);
    }
  };
}

