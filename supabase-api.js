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

  return { submitAvailability };
})();
