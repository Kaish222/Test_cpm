"use strict";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const FIRST_SLOT = 11 * 60 + 40;
const LAST_SLOT = 19 * 60 - 20;
const SLOT_LENGTH = 20;
const SLOT_COUNT = (LAST_SLOT - FIRST_SLOT) / SLOT_LENGTH + 1;
const selectedSlots = new Map();
const preferences = window.AvailabilityPreferences;
let activeMode = "available";
const modeInputs = Array.from(document.querySelectorAll('input[name="availability-mode"]'));
modeInputs.forEach(input => input.addEventListener("change", () => {
  if (input.checked) activeMode = input.value;
}));
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
const nameStatus = document.querySelector("#name-status");
let nameReady = false;
let nameRequest = null;
let nameTimer;

function lockAvailability(locked) {
  roleInput.disabled = locked;
  submitButton.disabled = locked;
  document.querySelector("#clear-all").disabled = locked;
  slotButtons.flat().forEach(button => { button.disabled = locked; });
  modeInputs.forEach(input => { input.disabled = locked; });
}

function resetSelection() {
  slotButtons.flat().forEach(button => setSlot(button, "unavailable"));
  selectionChanged();
}

async function loadSavedName() {
  if (!nameInput.value.trim() || isSubmitting) return;
  nameRequest?.abort();
  const request = new AbortController();
  nameRequest = request;
  nameReady = false;
  lockAvailability(true);
  nameStatus.textContent = "Looking up your saved availability...";
  const timeout = setTimeout(() => request.abort(), 20000);
  try {
    const person = await window.availabilityStorage.fetchPersonAvailability(nameInput.value.trim(), request.signal);
    if (nameRequest !== request) return;
    if (request.signal.aborted) throw new Error("Name lookup timed out");
    resetSelection();
    if (person) {
      roleInput.value = person.role;
      for (const range of person.ranges) {
        const day = DAYS.indexOf(range.day);
        const minutes = time => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
        for (let slot = 0; day >= 0 && slot < SLOT_COUNT; slot++) {
          const start = FIRST_SLOT + slot * SLOT_LENGTH;
          if (minutes(range.start_time) <= start && start + SLOT_LENGTH <= minutes(range.end_time)) {
            setSlot(slotButtons[slot][day], preferences.combine(selectedSlots.get(slotKey(day, slot)), range.preference));
          }
        }
      }
      selectionChanged();
      nameStatus.textContent = `Loaded availability for ${person.name}. Submit to replace it with your changes.`;
      const needsConversion = person.ranges.some(range => {
        const start = Number(range.start_time.slice(0, 2)) * 60 + Number(range.start_time.slice(3, 5));
        const end = Number(range.end_time.slice(0, 2)) * 60 + Number(range.end_time.slice(3, 5));
        return start < FIRST_SLOT || end > LAST_SLOT + SLOT_LENGTH || start % SLOT_LENGTH !== 0 || end % SLOT_LENGTH !== 0;
      });
      if (needsConversion) nameStatus.textContent += " Your old schedule includes times outside the new grid or between its boundaries. Only fully covered 20-minute slots are shown. Review them: saving replaces the old schedule with these slots.";
    } else {
      nameStatus.textContent = "New name. Choose your role and availability, then submit.";
    }
    roleInput.dispatchEvent(new Event("change"));
    nameReady = true;
    lockAvailability(false);
  } catch (error) {
    if (nameRequest !== request) return;
    console.error("Name lookup failed:", error);
    nameStatus.textContent = error.code === "PGRST202"
      ? "Database setup is incomplete: run supabase-unique-names.sql in Supabase SQL Editor. The name lookup function is missing, so we cannot yet check new or existing names. Reload this page after setup succeeds."
      : "Could not check this name. This does not mean the name already exists. Check your connection, then leave the name field to retry.";
  } finally {
    clearTimeout(timeout);
    if (nameRequest === request) nameRequest = null;
  }
}

nameInput.addEventListener("input", () => {
  clearTimeout(nameTimer);
  nameRequest?.abort();
  nameRequest = null;
  nameReady = false;
  endDrag({});
  resetSelection();
  roleInput.value = "";
  roleInput.dispatchEvent(new Event("change"));
  lockAvailability(true);
  nameStatus.textContent = nameInput.value.trim() ? "Checking name..." : "Enter your unique name to load your saved availability.";
  if (nameInput.value.trim()) nameTimer = setTimeout(loadSavedName, 500);
});
nameInput.addEventListener("blur", () => {
  if (!nameReady && !nameRequest) { clearTimeout(nameTimer); loadSavedName(); }
});

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
    if ((FIRST_SLOT + slotIndex * SLOT_LENGTH) % 60 === 0) row.className = "hour-start";
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
      button.dataset.label = `${day[0].toUpperCase() + day.slice(1)}, ${formatTime(start)} to ${formatTime(start + SLOT_LENGTH)}`;
      setSlot(button, "unavailable");
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

function setSlot(button, preference) {
  const key = slotKey(button.dataset.day, button.dataset.slot);
  const state = preference === "unavailable" ? "unavailable" : preferences.normalize(preference);
  if (state !== "unavailable") selectedSlots.set(key, state);
  else selectedSlots.delete(key);
  button.dataset.preference = state;
  button.className = `slot slot-${state}`;
  button.setAttribute("aria-pressed", String(state !== "unavailable"));
  button.setAttribute("aria-label", `${button.dataset.label}: ${preferences.labels[state]}`);
  button.title = `${button.dataset.label}: ${preferences.labels[state]}`;
  button.textContent = preferences.symbols[state];
}

function selectionChanged() {
  const count = selectedSlots.size;
  const totalMinutes = count * SLOT_LENGTH;
  document.querySelector("#selection-summary").textContent = count
    ? `${count} slot${count === 1 ? "" : "s"} selected · ${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min per week`
    : "No availability selected yet";
  statusMessage.textContent = "";
  if (validationShown) validateForm();
}

function paintSlot(button) {
  const key = slotKey(button.dataset.day, button.dataset.slot);
  // Each gesture has one paint mode; revisiting a cell never toggles it again.
  if (drag.visited.has(key)) return;
  drag.visited.add(key);
  setSlot(button, drag.preference);
  selectionChanged();
}

grid.addEventListener("pointerdown", (event) => {
  const button = event.target.closest(".slot");
  if (!button || !nameReady || isSubmitting || event.button !== 0 || !event.isPrimary || drag) return;
  event.preventDefault();
  focusSlot(button);
  drag = { pointerId: event.pointerId, preference: activeMode, visited: new Set(), x: event.clientX, y: event.clientY };
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
  if (!button || !nameReady || isSubmitting || event.detail !== 0) return;
  focusSlot(button);
  setSlot(button, activeMode);
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
  if (!nameReady) return;
  endDrag({});
  resetSelection();
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
      const preference = preferences.normalize(selection.get(slotKey(dayIndex, slot)));
      const start = FIRST_SLOT + slot * SLOT_LENGTH;
      const end = start + SLOT_LENGTH;
      const previous = ranges[ranges.length - 1];
      if (previous && previous.end === formatTime(start) && previous.preference === preference) previous.end = formatTime(end);
      else ranges.push({ start: formatTime(start), end: formatTime(end), preference });
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
  if (!nameReady) { nameStatus.textContent = "Enter your name and wait for its saved availability to load before submitting."; return; }
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
    window.dispatchEvent(new Event("availability-saved"));
  } catch (error) {
    console.error("Availability submission failed:", error);
    statusMessage.classList.add("is-error");
    statusMessage.textContent = error.code === "PGRST202"
      ? "Database setup needs updating: run supabase-preferences.sql in Supabase SQL Editor, then retry. Your preferences are still here."
      : "We couldn't confirm your save. Your selections are still here. Check your connection and retry; saving the same name replaces its availability.";
  } finally {
    controls.forEach((control, index) => { control.disabled = disabledStates[index]; });
    submitButton.innerHTML = submitButtonLabel;
    form.removeAttribute("aria-busy");
    isSubmitting = false;
  }
});

buildGrid();
lockAvailability(true);
if (nameInput.value.trim()) loadSavedName();
