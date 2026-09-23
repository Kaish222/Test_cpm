"use strict";

// Shared display vocabulary. These are preferences, not scheduling scores.
window.AvailabilityPreferences = Object.freeze({
  labels: Object.freeze({ preferred: "Preferred", available: "Available", possible: "Possible", unavailable: "Unavailable" }),
  symbols: Object.freeze({ preferred: "★", available: "●", possible: "◇", unavailable: "" }),
  normalize(value) {
    return ["preferred", "available", "possible"].includes(value) ? value : "available";
  },
  // Deterministic display rule for overlapping legacy rows belonging to one person.
  combine(current, incoming) {
    const order = ["preferred", "available", "possible"];
    const next = this.normalize(incoming);
    return !current || order.indexOf(next) < order.indexOf(current) ? next : current;
  }
});
