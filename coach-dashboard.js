"use strict";

(() => {
  const roleSelector = document.querySelector("#person-role");
  const section = document.querySelector("#coach-dashboard");
  const refreshButton = document.querySelector("#refresh-availability");
  const status = document.querySelector("#dashboard-status");
  const results = document.querySelector("#dashboard-results");
  const tableBody = document.querySelector("#dashboard-rows");
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const nameOrder = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  let activeRequest = null;

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
    results.hidden = true;
    tableBody.replaceChildren();
    try {
      const rows = await window.availabilityStorage.fetchAllAvailability(request.signal);
      // Ignore a response from a previous Coach visit after switching roles.
      if (activeRequest !== request || roleSelector.value !== "coach") return;
      if (request.signal.aborted) throw new Error("Dashboard request timed out.");
      renderAvailabilityTable(rows);
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
      results.hidden = true;
      tableBody.replaceChildren();
    }
  }

  roleSelector.addEventListener("change", updateDashboardVisibility);
  refreshButton.addEventListener("click", loadCoachDashboard);
  updateDashboardVisibility();
})();
