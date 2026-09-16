"use strict";

(() => {
  const roleSelector = document.querySelector("#person-role");
  const section = document.querySelector("#coach-dashboard");
  const refreshButton = document.querySelector("#refresh-availability");
  const status = document.querySelector("#dashboard-status");
  const results = document.querySelector("#dashboard-results");
  const tableBody = document.querySelector("#dashboard-rows");
  const calendarBody = document.querySelector("#calendar-rows");
  const legend = document.querySelector("#calendar-legend");
  const slotDialog = document.querySelector("#slot-dialog");
  const slotDialogTitle = document.querySelector("#slot-dialog-title");
  const slotDialogPeople = document.querySelector("#slot-dialog-people");
  const palette = ["#dceafb", "#dcefe3", "#f9e5d0", "#eee1f7", "#f6dfe5", "#d8eeee", "#f3edce", "#e5e7f6", "#e7eddb", "#f4e3d9", "#e0eced", "#efe3eb"];
  const firstMinute = 8 * 60;
  const lastMinute = 22 * 60;
  const interval = 30;
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const nameOrder = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  let activeRequest = null;

  function getColorForPerson(personId) {
    // FNV-1a produces the same palette index for a UUID across refreshes/browsers.
    let hash = 2166136261;
    for (const character of personId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return palette[(hash >>> 0) % palette.length];
  }

  function comparePeople(a, b) {
    return Number(b.role === "coach") - Number(a.role === "coach")
      || nameOrder.compare(a.name, b.name) || a.id.localeCompare(b.id);
  }

  function toMinutes(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function displayTime(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function buildCalendarData(records) {
    const people = new Map();
    const slots = Object.fromEntries(weekdays.map(day => [day, Array.from(
      { length: (lastMinute - firstMinute) / interval + 1 }, () => new Set())]));
    for (const record of records) {
      if (!slots[record.day]) continue;
      people.set(record.person_id, { id: record.person_id, name: record.name, role: record.role });
      const start = toMinutes(record.start_time);
      const end = toMinutes(record.end_time);
      for (let minute = firstMinute; minute <= lastMinute; minute += interval) {
        // End is exclusive; include only half-hour cells fully covered by the range.
        if (start <= minute && minute + interval <= end) {
          slots[record.day][(minute - firstMinute) / interval].add(record.person_id);
        }
      }
    }
    const sortedPeople = [...people.values()].sort(comparePeople);
    return { people: sortedPeople, slots: Object.fromEntries(weekdays.map(day => [day,
      slots[day].map(ids => [...ids].map(id => people.get(id)).sort(comparePeople))])) };
  }

  function personLabel(person) {
    const pill = document.createElement("span");
    pill.className = `person-pill${person.role === "coach" ? " person-coach" : ""}`;
    pill.style.backgroundColor = getColorForPerson(person.id);
    pill.title = `${person.name} — ${person.role === "coach" ? "Coach" : "Student"}`;
    const name = document.createElement("span");
    name.className = "person-name";
    name.textContent = person.name;
    pill.append(name);
    if (person.role === "coach") {
      const badge = document.createElement("span");
      badge.className = "coach-badge";
      badge.textContent = "C";
      badge.setAttribute("aria-label", "Coach");
      pill.append(badge);
    }
    return pill;
  }

  function renderLegend(people) {
    const fragment = document.createDocumentFragment();
    for (const person of people) {
      const item = document.createElement("li");
      item.append(personLabel(person));
      const role = document.createElement("span");
      role.className = "hint";
      role.textContent = person.role === "coach" ? "Coach" : "Student";
      item.append(role);
      fragment.append(item);
    }
    legend.replaceChildren(fragment);
  }

  function renderSlotPeople(cell, people, day, minute) {
    const content = document.createElement("div");
    content.className = "calendar-cell-content";
    people.slice(0, 3).forEach(person => content.append(personLabel(person)));
    if (people.length > 3) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "slot-more";
      more.textContent = `+${people.length - 3} more`;
      const label = `${day[0].toUpperCase() + day.slice(1)}, ${displayTime(minute)}–${displayTime(minute + interval)}`;
      more.setAttribute("aria-label", `Show all ${people.length} people: ${label}`);
      more.addEventListener("click", () => {
        slotDialogTitle.textContent = label;
        const fragment = document.createDocumentFragment();
        for (const person of people) {
          const item = document.createElement("li");
          item.append(personLabel(person));
          fragment.append(item);
        }
        slotDialogPeople.replaceChildren(fragment);
        slotDialog.showModal();
      });
      content.append(more);
    }
    cell.append(content);
  }

  function renderAvailabilityCalendar(data) {
    const fragment = document.createDocumentFragment();
    for (let minute = firstMinute; minute <= lastMinute; minute += interval) {
      const row = document.createElement("tr");
      const time = document.createElement("th");
      time.scope = "row";
      time.textContent = displayTime(minute);
      row.append(time);
      for (const day of weekdays) {
        const cell = document.createElement("td");
        renderSlotPeople(cell, data.slots[day][(minute - firstMinute) / interval], day, minute);
        row.append(cell);
      }
      fragment.append(row);
    }
    calendarBody.replaceChildren(fragment);
    renderLegend(data.people);
  }

  function clearDashboardResults() {
    results.hidden = true;
    tableBody.replaceChildren();
    calendarBody.replaceChildren();
    legend.replaceChildren();
    slotDialog.close();
    slotDialogPeople.replaceChildren();
    document.querySelector("#dashboard-details").open = false;
  }

  function sortAvailability(rows) {
    return [...rows].sort((a, b) => weekdays.indexOf(a.day) - weekdays.indexOf(b.day)
      || a.start_time.localeCompare(b.start_time)
      || nameOrder.compare(a.name, b.name)
      || a.id.localeCompare(b.id));
  }

  function renderAvailabilityTable(rows) {
    const fragment = document.createDocumentFragment();
    for (const record of sortAvailability(rows)) {
      const row = document.createElement("tr");
      const values = [record.name, record.role, record.day[0].toUpperCase() + record.day.slice(1),
        record.start_time.slice(0, 5), record.end_time.slice(0, 5)];
      for (const value of values) {
        const cell = document.createElement("td");
        // Names are user-submitted content, never HTML.
        cell.textContent = value;
        row.append(cell);
      }
      fragment.append(row);
    }
    tableBody.replaceChildren(fragment);
    results.hidden = rows.length === 0;
    status.textContent = rows.length
      ? `${rows.length} availability range${rows.length === 1 ? "" : "s"}.`
      : "No availability has been submitted yet.";
  }

  async function loadCoachDashboard() {
    if (roleSelector.value !== "coach" || activeRequest) return;
    const request = new AbortController();
    activeRequest = request;
    const timeout = setTimeout(() => request.abort(), 30000);
    refreshButton.disabled = true;
    refreshButton.textContent = "Loading...";
    section.setAttribute("aria-busy", "true");
    status.classList.remove("is-error");
    status.textContent = "Loading submitted availability...";
    clearDashboardResults();
    try {
      const rows = await window.availabilityStorage.fetchAllAvailability(request.signal);
      // Ignore a response from a previous Coach visit after switching roles.
      if (activeRequest !== request || roleSelector.value !== "coach") return;
      if (request.signal.aborted) throw new Error("Dashboard request timed out.");
      renderAvailabilityTable(rows);
      renderAvailabilityCalendar(buildCalendarData(rows));
    } catch (error) {
      if (activeRequest !== request || roleSelector.value !== "coach") return;
      console.error("Coach dashboard loading failed:", error);
      status.classList.add("is-error");
      status.textContent = "We couldn't load availability. Check your connection and try Refresh. If this continues, ask the site owner to check the dashboard read permissions.";
    } finally {
      clearTimeout(timeout);
      if (activeRequest === request) {
        activeRequest = null;
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh";
        section.removeAttribute("aria-busy");
      }
    }
  }

  function updateDashboardVisibility() {
    const isCoach = roleSelector.value === "coach";
    section.hidden = !isCoach;
    if (isCoach) {
      loadCoachDashboard();
    } else {
      activeRequest?.abort();
      activeRequest = null;
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
      section.removeAttribute("aria-busy");
      status.textContent = "";
      clearDashboardResults();
    }
  }

  roleSelector.addEventListener("change", updateDashboardVisibility);
  refreshButton.addEventListener("click", loadCoachDashboard);
  updateDashboardVisibility();
})();
