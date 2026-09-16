"use strict";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const FIRST_SLOT = 8 * 60;
const LAST_SLOT = 22 * 60;
const SLOT_LENGTH = 30;
const SLOT_COUNT = (LAST_SLOT - FIRST_SLOT) / SLOT_LENGTH + 1;
const selectedSlots = new Set();
const slotButtons = [];
const form = document.querySelector("#availability-form");
const grid = document.querySelector("#availability-grid");
const nameInput = document.querySelector("#person-name");
const roleInput = document.querySelector("#person-role");
const statusMessage = document.querySelector("#form-status");
let drag = null;
let focusedSlot = null;
let validationShown = false;
let isSubmitting = false;
const submitButton = form.querySelector('button[type="submit"]');
const submitButtonLabel = submitButton.innerHTML;

function formatTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function slotKey(dayIndex, slotIndex) {
  return `${dayIndex}:${slotIndex}`;
}

function buildGrid() {
  const fragment = document.createDocumentFragment();
  for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    const row = document.createElement("tr");
    if (slotIndex % 2 === 0) row.className = "hour-start";
    const start = FIRST_SLOT + slotIndex * SLOT_LENGTH;
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = formatTime(start);
    row.append(label);
    slotButtons[slotIndex] = [];

    DAYS.forEach((day, dayIndex) => {
      const cell = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot";
      button.dataset.day = dayIndex;
      button.dataset.slot = slotIndex;
      button.setAttribute("aria-label", `${day[0].toUpperCase() + day.slice(1)}, ${formatTime(start)} to ${formatTime(start + SLOT_LENGTH)}`);
      button.setAttribute("aria-pressed", "false");
      button.tabIndex = -1;
      slotButtons[slotIndex][dayIndex] = button;
      cell.append(button);
      row.append(cell);
    });
    fragment.append(row);
  }
  document.querySelector("#time-slots").append(fragment);
  focusedSlot = slotButtons[0][0];
  focusedSlot.tabIndex = 0;
}

function focusSlot(button) {
  focusedSlot.tabIndex = -1;
  focusedSlot = button;
  button.tabIndex = 0;
  button.focus({ preventScroll: true });
}

function setSlot(button, available) {
  const key = slotKey(button.dataset.day, button.dataset.slot);
  if (available) selectedSlots.add(key);
  else selectedSlots.delete(key);
  button.setAttribute("aria-pressed", String(available));
}

function selectionChanged() {
  const count = selectedSlots.size;
  const hours = count / 2;
  document.querySelector("#selection-summary").textContent = count
    ? `${count} slot${count === 1 ? "" : "s"} selected · ${hours} hour${hours === 1 ? "" : "s"} per week`
    : "No availability selected yet";
  statusMessage.textContent = "";
  if (validationShown) validateForm();
}

function paintSlot(button) {
  const key = slotKey(button.dataset.day, button.dataset.slot);
  // Each gesture has one paint mode; revisiting a cell never toggles it again.
  if (drag.visited.has(key)) return;
  drag.visited.add(key);
  setSlot(button, drag.available);
  selectionChanged();
}

grid.addEventListener("pointerdown", (event) => {
  const button = event.target.closest(".slot");
  if (!button || isSubmitting || event.button !== 0 || !event.isPrimary || drag) return;
  event.preventDefault();
  focusSlot(button);
  drag = { pointerId: event.pointerId, available: button.getAttribute("aria-pressed") !== "true", visited: new Set(), x: event.clientX, y: event.clientY };
  grid.setPointerCapture(event.pointerId);
  paintSlot(button);
});

grid.addEventListener("pointermove", (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  // Sample the path so fast movement does not skip cells between pointer events.
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
  for (let step = 1; step <= steps; step++) {
    const element = document.elementFromPoint(drag.x + dx * step / steps, drag.y + dy * step / steps);
    const button = element?.closest(".slot");
    if (button && grid.contains(button)) paintSlot(button);
  }
  drag.x = event.clientX;
  drag.y = event.clientY;
});

function endDrag(event) {
  if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
  const pointerId = drag.pointerId;
  drag = null;
  if (grid.hasPointerCapture(pointerId)) grid.releasePointerCapture(pointerId);
}

grid.addEventListener("pointerup", endDrag);
grid.addEventListener("pointercancel", endDrag);
grid.addEventListener("lostpointercapture", endDrag);
window.addEventListener("blur", endDrag);

grid.addEventListener("click", (event) => {
  const button = event.target.closest(".slot");
  // Pointer gestures already painted; zero-detail clicks come from keyboard/assistive activation.
  if (!button || isSubmitting || event.detail !== 0) return;
  focusSlot(button);
  setSlot(button, button.getAttribute("aria-pressed") !== "true");
  selectionChanged();
});

grid.addEventListener("keydown", (event) => {
  const button = event.target.closest(".slot");
  if (!button) return;
  let day = Number(button.dataset.day);
  let slot = Number(button.dataset.slot);
  switch (event.key) {
    case "ArrowRight": day++; break;
    case "ArrowLeft": day--; break;
    case "ArrowDown": slot++; break;
    case "ArrowUp": slot--; break;
    default: return;
  }
  event.preventDefault();
  const next = slotButtons[Math.max(0, Math.min(SLOT_COUNT - 1, slot))][Math.max(0, Math.min(DAYS.length - 1, day))];
  focusSlot(next);
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
});

document.querySelector("#clear-all").addEventListener("click", () => {
  if (isSubmitting) return;
  endDrag({});
  selectedSlots.clear();
  slotButtons.flat().forEach((button) => button.setAttribute("aria-pressed", "false"));
  selectionChanged();
});

function validateForm() {
  const errors = {
    name: !nameInput.value.trim() ? "Please enter your name." : nameInput.value.trim().length > 120 ? "Please keep your name to 120 characters or fewer." : "",
    role: ["student", "coach"].includes(roleInput.value) ? "" : "Please choose Student or Coach.",
    availability: selectedSlots.size ? "" : "Select at least one time slot that works for you."
  };
  Object.entries(errors).forEach(([field, message]) => {
    document.querySelector(`#${field}-error`).textContent = message;
  });
  nameInput.setAttribute("aria-invalid", String(Boolean(errors.name)));
  roleInput.setAttribute("aria-invalid", String(Boolean(errors.role)));
  return errors;
}

// This pure conversion stays independent of the UI and database transport.
function buildAvailabilityData(name, role, selection) {
  const availability = {};
  DAYS.forEach((day, dayIndex) => {
    const ranges = [];
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      if (!selection.has(slotKey(dayIndex, slot))) continue;
      const start = FIRST_SLOT + slot * SLOT_LENGTH;
      const end = start + SLOT_LENGTH;
      const previous = ranges[ranges.length - 1];
      if (previous && previous.end === formatTime(start)) previous.end = formatTime(end);
      else ranges.push({ start: formatTime(start), end: formatTime(end) });
    }
    if (ranges.length) availability[day] = ranges;
  });
  return { name: name.trim(), role, availability };
}

[nameInput, roleInput].forEach((input) => input.addEventListener("input", () => {
  statusMessage.textContent = "";
  if (validationShown) validateForm();
}));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSubmitting) return;
  validationShown = true;
  const errors = validateForm();
  const invalid = Object.values(errors).some(Boolean);
  statusMessage.classList.toggle("is-error", invalid);
  if (invalid) {
    statusMessage.textContent = "A few details are missing. Please check the fields above.";
    if (errors.name) nameInput.focus();
    else if (errors.role) roleInput.focus();
    else focusSlot(focusedSlot);
    return;
  }
  const data = buildAvailabilityData(nameInput.value, roleInput.value, selectedSlots);
  endDrag({});
  isSubmitting = true;
  const controls = Array.from(form.querySelectorAll("input, select, button"));
  const disabledStates = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  form.setAttribute("aria-busy", "true");
  submitButton.textContent = "Saving...";
  statusMessage.textContent = "Saving your availability...";
  try {
    await window.availabilityStorage.submitAvailability(data);
    statusMessage.textContent = "Availability saved successfully.";
  } catch (error) {
    console.error("Availability submission failed:", error);
    statusMessage.classList.add("is-error");
    statusMessage.textContent = "We couldn't confirm your save. Your selections are still here. Check your connection or ask the site owner to check setup. If the connection dropped, check the database before retrying to avoid duplicates.";
  } finally {
    controls.forEach((control, index) => { control.disabled = disabledStates[index]; });
    submitButton.innerHTML = submitButtonLabel;
    form.removeAttribute("aria-busy");
    isSubmitting = false;
  }
});

buildGrid();
