"use strict";

window.availabilityStorage = (() => {
  let client;

  function getClient() {
    if (client) return client;
    if (typeof SUPABASE_URL !== "string" || typeof SUPABASE_ANON_KEY !== "string" ||
        !SUPABASE_URL.startsWith("https://") || SUPABASE_ANON_KEY.startsWith("YOUR_")) {
      throw new Error("Configure SUPABASE_URL and SUPABASE_ANON_KEY in supabase-config.js.");
    }
    let isPublicKey = SUPABASE_ANON_KEY.startsWith("sb_publishable_");
    if (!isPublicKey) {
      try {
        const payload = SUPABASE_ANON_KEY.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        isPublicKey = JSON.parse(atob(payload)).role === "anon";
      } catch {
        isPublicKey = false;
      }
    }
    if (!isPublicKey) throw new Error("Use only a publishable or legacy anon key. Secret keys are not allowed.");
    if (!window.supabase?.createClient) throw new Error("The Supabase browser library could not load. Check your connection or CDN blocking.");
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return client;
  }

  function buildAvailabilityRows(availability) {
    return Object.entries(availability).flatMap(([day, ranges]) => ranges.map(({ start, end }) => ({
      day,
      start_time: start,
      end_time: end
    })));
  }

  async function submitAvailability(person) {
    const supabaseClient = getClient();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      // Both inserts share a transaction; return only the new UUID without table SELECT.
      const { data, error } = await supabaseClient.rpc("submit_availability", {
        p_name: person.name,
        p_role: person.role,
        p_ranges: buildAvailabilityRows(person.availability)
      }).abortSignal(controller.signal);
      if (error) throw error;
      if (typeof data !== "string" || !data) throw new Error("Supabase did not return the new person's ID.");
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchAllAvailability(signal) {
    const supabaseClient = getClient();
    const rows = [];
    let lastId = null;
    // Page by a unique key so the API's default row limit does not truncate results.
    while (true) {
      if (signal?.aborted) throw new Error("Availability loading was cancelled.");
      let query = supabaseClient.from("availability")
        .select("id, person_id, day, start_time, end_time, people(name, role)")
        .order("id", { ascending: true }).limit(500);
      if (lastId) query = query.gt("id", lastId);
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Unexpected availability response.");
      if (data.length === 0) break;
      for (const row of data) {
        if (!row.people) throw new Error("Related person is unreadable. Check SELECT policies on people.");
        rows.push({ id: row.id, person_id: row.person_id, name: row.people.name, role: row.people.role,
          day: row.day, start_time: row.start_time, end_time: row.end_time });
      }
      lastId = data[data.length - 1].id;
    }
    return rows;
  }

  return { submitAvailability, fetchAllAvailability };
})();
